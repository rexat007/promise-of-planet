import { describe, expect, it } from 'vitest';
import { InMemoryAdminRepository } from '../../functions/src/admin/inMemoryAdminRepository';
import { AdminRole, type AdminUser } from '../../functions/src/shared/adminContract';
import { AuditAction, AuditTargetType } from '../../functions/src/shared/auditContract';
import { createEditorialImageAssetRecord } from '../../functions/src/shared/editorialImageAssetContract';
import type { EditorialImageAssetMetadata } from '../../functions/src/types/editorialImageAsset';
import type {
  EditorialImageFirestoreCollectionRef,
  EditorialImageFirestoreDatabase,
  EditorialImageFirestoreDocumentRef,
  EditorialImageFirestoreDocumentSnapshot,
  EditorialImageFirestoreTransaction,
} from '../../functions/src/news/firestoreEditorialImageAssetRepository';
import {
  EDITORIAL_IMAGE_ASSET_COLLECTION,
  INITIAL_EDITORIAL_IMAGE_ASSET_REVISION,
  serializeEnvelopeForPersistence,
} from '../../functions/src/news/editorialImageAssetRepository';
import {
  CANONICAL_EVIDENCE_SOURCE_KINDS,
  CANONICAL_EVIDENCE_STATUSES,
  CANONICAL_RIGHTS_REVIEW_STATUSES,
  EDITORIAL_IMAGE_ADMINS_COLLECTION,
  EDITORIAL_IMAGE_AUDIT_TARGET_TYPE,
  EDITORIAL_IMAGE_RIGHTS_AUDIT_COLLECTION,
  EDITORIAL_IMAGE_RIGHTS_EVIDENCE_COLLECTION,
  EDITORIAL_IMAGE_RIGHTS_REVIEW_REQUEST_COLLECTION,
  EditorialImageRightsReviewError,
  EditorialImageRightsReviewService,
  FirestoreEditorialImageRightsReviewRunner,
  InMemoryEditorialImageRightsReviewRunner,
  isAllowedRightsTransition,
  serializeEvidenceRecordForPersistence,
  validateEditorialImageRightsEvidenceRecord,
  validateEvidenceId,
  validatePersistedEvidenceRecord,
  type EditorialImageRightsDecisionInput,
  type EditorialImageRightsEvidenceRecord,
} from '../../functions/src/news/editorialImageRightsReviewService';

const VALID_SHA256 =
  'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0';

function createPendingCanonicalAsset(
  overrides: {
    assetId?: string;
    createdByUid?: string;
    createdAtIso?: string;
    updatedAtIso?: string;
  } = {}
): EditorialImageAssetMetadata {
  const assetId = overrides.assetId ?? 'asset_001';
  const createdAtIso = overrides.createdAtIso ?? '2026-10-21T08:00:00.000Z';
  const updatedAtIso = overrides.updatedAtIso ?? createdAtIso;

  return createEditorialImageAssetRecord({
    assetId,
    createdByUid: overrides.createdByUid ?? 'creator_uid_1',
    createdAtIso,
    updatedAtIso,
    origin: 'news_article',
    originalFilename: 'solar-array.webp',
    mimeType: 'image/webp',
    originalSizeBytes: 240_000,
    originalWidth: 1600,
    originalHeight: 900,
    sha256Checksum: VALID_SHA256,
    variants: {
      article_cover: {
        variantKey: 'article_cover',
        storagePath: `editorial_images/private/${assetId}/article_cover.webp`,
        mimeType: 'image/webp',
        width: 1600,
        height: 900,
        sizeBytes: 180_000,
        sha256Checksum: VALID_SHA256,
      },
    },
    altAr: 'محطة طاقة شمسية في الصحراء',
    altEn: 'Solar power station in the desert',
  });
}

function buildValidApprovalFields(
  overrides: Partial<EditorialImageRightsDecisionInput> = {}
): Omit<
  EditorialImageRightsDecisionInput,
  'assetId' | 'expectedRevision' | 'targetStatus'
> {
  return {
    reviewReason:
      overrides.reviewReason ??
      'Verified signed photographer license and attribution metadata.',
    licenseType: overrides.licenseType ?? 'DirectLicense',
    licenseDetails:
      overrides.licenseDetails ??
      'Signed direct editorial license agreement #DL-2026-09',
    rightsHolder: overrides.rightsHolder ?? 'Promise Environmental Press',
    sourceAttributionAr:
      overrides.sourceAttributionAr ?? 'عدسة: وكالة وعد الصحفية البيئية',
    sourceAttributionEn:
      overrides.sourceAttributionEn ?? 'Photo: Promise Environmental Press',
    evidenceRefs: overrides.evidenceRefs ?? ['ev_contract_2026_001'],
    usageScope: overrides.usageScope ?? {
      scopeType: 'GeneralEditorial',
    },
    ...(overrides.documentedException !== undefined
      ? { documentedException: overrides.documentedException }
      : {}),
    ...(overrides.reviewRequestId !== undefined
      ? { reviewRequestId: overrides.reviewRequestId }
      : {}),
  };
}

interface CollectionBoundDocRef extends EditorialImageFirestoreDocumentRef {
  readonly __collectionName?: string;
}

class TransactionalMockFirestoreDb implements EditorialImageFirestoreDatabase {
  private readonly collections = new Map<string, Map<string, unknown>>();
  private readonly docVersions = new Map<string, number>();
  public failOnAuditCreate = false;
  public failOnRequestCreate = false;
  public failOnRequestSet = false;
  public failOnAssetSet = false;
  public failOnEvidenceCreate = false;
  public failOnEvidenceSet = false;
  public maxTransactionAttempts = 5;
  public lastTransactionAttemptCount = 0;
  public onBeforeCommitAttempt:
    | ((attempt: number) => Promise<void> | void)
    | null = null;

  private getCollectionMap(name: string): Map<string, unknown> {
    let col = this.collections.get(name);
    if (!col) {
      col = new Map<string, unknown>();
      this.collections.set(name, col);
    }
    return col;
  }

  private getDocKey(collectionName: string, docId: string): string {
    return `${collectionName}/${docId}`;
  }

  private getDocVersion(collectionName: string, docId: string): number {
    return this.docVersions.get(this.getDocKey(collectionName, docId)) ?? 0;
  }

  private bumpDocVersion(collectionName: string, docId: string): void {
    const key = this.getDocKey(collectionName, docId);
    this.docVersions.set(key, (this.docVersions.get(key) ?? 0) + 1);
  }

  public seedDocument(
    collectionName: string,
    docId: string,
    data: unknown
  ): void {
    this.getCollectionMap(collectionName).set(
      docId,
      JSON.parse(JSON.stringify(data))
    );
    this.bumpDocVersion(collectionName, docId);
  }

  public deleteDocument(collectionName: string, docId: string): void {
    const col = this.collections.get(collectionName);
    if (col) {
      col.delete(docId);
    }
    this.bumpDocVersion(collectionName, docId);
  }

  public readRawDocument(collectionName: string, docId: string): unknown {
    const col = this.collections.get(collectionName);
    if (!col || !col.has(docId)) {
      return undefined;
    }
    return JSON.parse(JSON.stringify(col.get(docId)));
  }

  public listCollectionDocuments(collectionName: string): unknown[] {
    const col = this.collections.get(collectionName);
    if (!col) return [];
    return Array.from(col.values()).map((v) => JSON.parse(JSON.stringify(v)));
  }

  collection(collectionName: string): EditorialImageFirestoreCollectionRef {
    return {
      doc: (documentId: string): EditorialImageFirestoreDocumentRef => {
        const ref: CollectionBoundDocRef = {
          id: documentId,
          __collectionName: collectionName,
        };
        return ref;
      },
    };
  }

  private resolveCollectionForDoc(
    docRef: EditorialImageFirestoreDocumentRef
  ): string {
    const bound = (docRef as CollectionBoundDocRef).__collectionName;
    if (typeof bound === 'string' && bound.length > 0) {
      return bound;
    }
    const docId = docRef.id;
    if (docId.startsWith('img_audit_')) {
      return EDITORIAL_IMAGE_RIGHTS_AUDIT_COLLECTION;
    }
    if (docId.startsWith('img_req_') || docId.startsWith('req_')) {
      return EDITORIAL_IMAGE_RIGHTS_REVIEW_REQUEST_COLLECTION;
    }
    if (docId.startsWith('ev_')) {
      return EDITORIAL_IMAGE_RIGHTS_EVIDENCE_COLLECTION;
    }
    return EDITORIAL_IMAGE_ASSET_COLLECTION;
  }

  async runTransaction<T>(
    updateFunction: (
      transaction: EditorialImageFirestoreTransaction
    ) => Promise<T>
  ): Promise<T> {
    this.lastTransactionAttemptCount = 0;

    for (let attempt = 1; attempt <= this.maxTransactionAttempts; attempt++) {
      this.lastTransactionAttemptCount = attempt;

      // Take deep snapshot of all collections and versions before executing transaction attempt
      const snapshot = new Map<string, Map<string, unknown>>();
      for (const [colName, colMap] of this.collections.entries()) {
        const clonedMap = new Map<string, unknown>();
        for (const [k, v] of colMap.entries()) {
          clonedMap.set(k, JSON.parse(JSON.stringify(v)));
        }
        snapshot.set(colName, clonedMap);
      }
      const versionSnapshot = new Map<string, number>(this.docVersions);

      const readVersions = new Map<string, number>();
      const stagedWrites: Array<() => void> = [];

      const tx: EditorialImageFirestoreTransaction = {
        get: async (
          docRef: EditorialImageFirestoreDocumentRef
        ): Promise<EditorialImageFirestoreDocumentSnapshot> => {
          if (stagedWrites.length > 0) {
            throw new Error(
              'Firestore transactions require all reads to be executed before all writes.'
            );
          }
          const colName = this.resolveCollectionForDoc(docRef);
          const docKey = this.getDocKey(colName, docRef.id);
          if (!readVersions.has(docKey)) {
            readVersions.set(docKey, this.getDocVersion(colName, docRef.id));
          }
          const colMap = this.getCollectionMap(colName);
          const exists = colMap.has(docRef.id);
          const raw = exists
            ? JSON.parse(JSON.stringify(colMap.get(docRef.id)))
            : undefined;
          return {
            exists,
            id: docRef.id,
            data: () => raw,
          };
        },
        create: (
          docRef: EditorialImageFirestoreDocumentRef,
          data: Record<string, unknown>
        ) => {
          const colName = this.resolveCollectionForDoc(docRef);
          stagedWrites.push(() => {
            if (
              colName === EDITORIAL_IMAGE_RIGHTS_AUDIT_COLLECTION &&
              this.failOnAuditCreate
            ) {
              this.failOnAuditCreate = false;
              throw new Error('Simulated Firestore audit create failure.');
            }
            if (
              colName === EDITORIAL_IMAGE_RIGHTS_REVIEW_REQUEST_COLLECTION &&
              this.failOnRequestCreate
            ) {
              this.failOnRequestCreate = false;
              throw new Error(
                'Simulated Firestore review request create failure.'
              );
            }
            if (
              colName === EDITORIAL_IMAGE_RIGHTS_EVIDENCE_COLLECTION &&
              this.failOnEvidenceCreate
            ) {
              this.failOnEvidenceCreate = false;
              throw new Error('Simulated Firestore evidence create failure.');
            }
            const colMap = this.getCollectionMap(colName);
            if (colMap.has(docRef.id)) {
              const err = new Error(
                `Document ${docRef.id} already exists`
              ) as Error & {
                code?: string;
              };
              err.code = 'ALREADY_EXISTS';
              throw err;
            }
            colMap.set(docRef.id, JSON.parse(JSON.stringify(data)));
            this.bumpDocVersion(colName, docRef.id);
          });
        },
        set: (
          docRef: EditorialImageFirestoreDocumentRef,
          data: Record<string, unknown>
        ) => {
          const colName = this.resolveCollectionForDoc(docRef);
          stagedWrites.push(() => {
            if (
              colName === EDITORIAL_IMAGE_ASSET_COLLECTION &&
              this.failOnAssetSet
            ) {
              this.failOnAssetSet = false;
              throw new Error('Simulated Firestore asset set failure.');
            }
            if (
              colName === EDITORIAL_IMAGE_RIGHTS_REVIEW_REQUEST_COLLECTION &&
              this.failOnRequestSet
            ) {
              this.failOnRequestSet = false;
              throw new Error(
                'Simulated Firestore review request consumption set failure.'
              );
            }
            if (
              colName === EDITORIAL_IMAGE_RIGHTS_EVIDENCE_COLLECTION &&
              this.failOnEvidenceSet
            ) {
              this.failOnEvidenceSet = false;
              throw new Error('Simulated Firestore evidence set failure.');
            }
            const colMap = this.getCollectionMap(colName);
            colMap.set(docRef.id, JSON.parse(JSON.stringify(data)));
            this.bumpDocVersion(colName, docRef.id);
          });
        },
      };

      try {
        const result = await updateFunction(tx);

        if (this.onBeforeCommitAttempt) {
          await this.onBeforeCommitAttempt(attempt);
        }

        // Check for concurrent read-set modifications before committing staged writes
        let hasReadSetConflict = false;
        for (const [docKey, readVersion] of readVersions.entries()) {
          const currentVersion = this.docVersions.get(docKey) ?? 0;
          if (currentVersion !== readVersion) {
            hasReadSetConflict = true;
            break;
          }
        }

        if (hasReadSetConflict) {
          if (attempt < this.maxTransactionAttempts) {
            continue;
          }
          throw new EditorialImageRightsReviewError(
            'CONFLICT',
            'Firestore transaction aborted after maximum retry attempts due to concurrent modification.'
          );
        }

        // Snapshot state immediately before applying stagedWrites so any write fault rolls back only the staged writes
        const preWriteSnapshot = new Map<string, Map<string, unknown>>();
        for (const [colName, colMap] of this.collections.entries()) {
          const clonedMap = new Map<string, unknown>();
          for (const [k, v] of colMap.entries()) {
            clonedMap.set(k, JSON.parse(JSON.stringify(v)));
          }
          preWriteSnapshot.set(colName, clonedMap);
        }
        const preWriteVersions = new Map<string, number>(this.docVersions);

        try {
          for (const applyWrite of stagedWrites) {
            applyWrite();
          }
        } catch (writeErr) {
          this.collections.clear();
          for (const [colName, colMap] of preWriteSnapshot.entries()) {
            this.collections.set(colName, colMap);
          }
          this.docVersions.clear();
          for (const [k, v] of preWriteVersions.entries()) {
            this.docVersions.set(k, v);
          }
          throw writeErr;
        }

        return result;
      } catch (err) {
        this.collections.clear();
        for (const [colName, colMap] of snapshot.entries()) {
          this.collections.set(colName, colMap);
        }
        this.docVersions.clear();
        for (const [k, v] of versionSnapshot.entries()) {
          this.docVersions.set(k, v);
        }
        throw err;
      }
    }

    throw new EditorialImageRightsReviewError(
      'CONFLICT',
      'Transaction retry loop exhausted.'
    );
  }
}

describe('IMG-F3-03 — EditorialImageRightsReviewService & Atomic Audit Boundary', () => {
  async function setupFixture(initialClockIso = '2026-10-21T09:00:00.000Z') {
    const adminRepo = new InMemoryAdminRepository();
    const runner = new InMemoryEditorialImageRightsReviewRunner(
      undefined,
      adminRepo
    );
    let currentClockIso = initialClockIso;

    const ownerUser: AdminUser = {
      id: 'owner_uid_1',
      name: 'Dr. Layla Al-Mansoor',
      email: 'owner@promise.org',
      role: AdminRole.Owner,
      isActive: true,
    };
    const reviewerOne: AdminUser = {
      id: 'reviewer_uid_1',
      name: 'Karim Haddad',
      email: 'reviewer1@promise.org',
      role: AdminRole.RightsReviewer,
      isActive: true,
    };
    const reviewerTwo: AdminUser = {
      id: 'reviewer_uid_2',
      name: 'Nadia Farouk',
      email: 'reviewer2@promise.org',
      role: AdminRole.RightsReviewer,
      isActive: true,
    };
    const contentEditor: AdminUser = {
      id: 'editor_uid_1',
      name: 'Sami Editor',
      email: 'editor@promise.org',
      role: AdminRole.ContentEditor,
      isActive: true,
    };
    const inactiveReviewer: AdminUser = {
      id: 'inactive_reviewer_uid',
      name: 'Inactive Reviewer',
      email: 'inactive@promise.org',
      role: AdminRole.RightsReviewer,
      isActive: false,
    };
    const aiAssistant: AdminUser = {
      id: 'ai_assistant_uid',
      name: 'Automated Assistant',
      email: 'ai@promise.org',
      role: AdminRole.AIAssistant,
      isActive: true,
    };

    await adminRepo.saveAdmin(ownerUser);
    await adminRepo.saveAdmin(reviewerOne);
    await adminRepo.saveAdmin(reviewerTwo);
    await adminRepo.saveAdmin(contentEditor);
    await adminRepo.saveAdmin(inactiveReviewer);
    await adminRepo.saveAdmin(aiAssistant);

    // Automatically seed default active evidence 'ev_contract_2026_001' when an asset is seeded in baseline tests
    const originalSeedInitialPendingAsset =
      runner.seedInitialPendingAsset.bind(runner);
    runner.seedInitialPendingAsset = async (
      asset: EditorialImageAssetMetadata
    ) => {
      const rec = await originalSeedInitialPendingAsset(asset);
      const existingDefault = await runner.getEvidenceRecord(
        'ev_contract_2026_001'
      );
      if (!existingDefault) {
        await runner.seedEvidenceRecord({
          evidenceId: 'ev_contract_2026_001',
          assetId: asset.assetId,
          status: 'Active',
          sourceKind: 'SignedLicenseAgreement',
          sourceReference: `LIC-${asset.assetId}`,
          summary: `Default signed license evidence for ${asset.assetId}.`,
          recordedByUid: reviewerOne.id,
          recordedAtIso: asset.createdAtIso,
        });
      }
      return rec;
    };

    const seedActiveEvidence = async (
      assetId: string,
      evidenceId: string,
      recordedAtIso = '2026-10-21T08:00:00.000Z',
      recordedByUid = reviewerOne.id
    ) => {
      return runner.seedEvidenceRecord({
        evidenceId,
        assetId,
        status: 'Active',
        sourceKind: 'SignedLicenseAgreement',
        sourceReference: `REF-${evidenceId}`,
        summary: `Registered active evidence ${evidenceId} for ${assetId}.`,
        recordedByUid,
        recordedAtIso,
      });
    };

    const service = new EditorialImageRightsReviewService({
      adminRepository: adminRepo,
      transactionRunner: runner,
      clock: () => currentClockIso,
    });

    return {
      adminRepo,
      runner,
      service,
      seedActiveEvidence,
      setClock: (nextIso: string) => {
        currentClockIso = nextIso;
      },
      users: {
        ownerUser,
        reviewerOne,
        reviewerTwo,
        contentEditor,
        inactiveReviewer,
        aiAssistant,
      },
    };
  }

  describe('1. Trusted Human Authentication & Role Authorization', () => {
    it('rejects unauthenticated callers (missing context, missing auth, blank or malformed UID)', async () => {
      const { runner, service } = await setupFixture();
      const asset = createPendingCanonicalAsset({ assetId: 'asset_auth_1' });
      await runner.seedInitialPendingAsset(asset);

      const decision: EditorialImageRightsDecisionInput = {
        assetId: 'asset_auth_1',
        expectedRevision: 1,
        targetStatus: 'Approved',
        ...buildValidApprovalFields(),
      };

      await expect(
        service.transitionEditorialImageRights({} as any, decision)
      ).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });

      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: '   ' } },
          decision
        )
      ).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });

      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: 'bad uid with spaces' } },
          decision
        )
      ).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });

    it('rejects unregistered, inactive, invalid-role, AI assistant, and non-ManageRights callers', async () => {
      const { adminRepo, runner, service, users } = await setupFixture();
      const asset = createPendingCanonicalAsset({ assetId: 'asset_auth_2' });
      await runner.seedInitialPendingAsset(asset);

      const decision: EditorialImageRightsDecisionInput = {
        assetId: 'asset_auth_2',
        expectedRevision: 1,
        targetStatus: 'Approved',
        ...buildValidApprovalFields(),
      };

      // Unregistered UID
      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: 'unregistered_uid_99' } },
          decision
        )
      ).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });

      // Inactive RightsReviewer
      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: users.inactiveReviewer.id } },
          decision
        )
      ).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });

      // ContentEditor lacks ManageRights
      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: users.contentEditor.id } },
          decision
        )
      ).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });

      // AIAssistant is explicitly forbidden
      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: users.aiAssistant.id } },
          decision
        )
      ).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });

      // Corrupted raw admin role in repository
      adminRepo.setRawAdmin('corrupted_admin_uid', {
        id: 'corrupted_admin_uid',
        name: 'Corrupted Role User',
        email: 'corrupt@promise.org',
        role: 'SuperReviewer',
        isActive: true,
      });

      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: 'corrupted_admin_uid' } },
          decision
        )
      ).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });

      // Verify asset was never modified by any rejected attempt
      const stored = await runner.getAssetRecord('asset_auth_2');
      expect(stored?.revision).toBe(1);
      expect(stored?.asset.rights.status).toBe('PendingReview');
    });
  });

  describe('2. Self-Approval Policy (Owner Allowed, RightsReviewer Denied, UID-Based Only)', () => {
    it('denies self-approval when a RightsReviewer created the asset (admin.id === asset.createdByUid)', async () => {
      const { runner, service, users } = await setupFixture();
      const asset = createPendingCanonicalAsset({
        assetId: 'asset_self_reviewer',
        createdByUid: users.reviewerOne.id,
      });
      await runner.seedInitialPendingAsset(asset);

      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: users.reviewerOne.id } },
          {
            assetId: 'asset_self_reviewer',
            expectedRevision: 1,
            targetStatus: 'Approved',
            ...buildValidApprovalFields(),
          }
        )
      ).rejects.toMatchObject({
        code: 'SELF_APPROVAL_FORBIDDEN',
      });

      const stored = await runner.getAssetRecord('asset_self_reviewer');
      expect(stored?.revision).toBe(1);
      expect(stored?.asset.rights.status).toBe('PendingReview');
      expect(await runner.listAuditEventsForAsset('asset_self_reviewer')).toHaveLength(
        0
      );
    });

    it('permits self-approval ONLY when the verified reviewer role is Owner, and marks selfApprovedByOwner: true in audit', async () => {
      const { runner, service, users } = await setupFixture(
        '2026-10-21T09:15:00.000Z'
      );
      const asset = createPendingCanonicalAsset({
        assetId: 'asset_self_owner',
        createdByUid: users.ownerUser.id,
      });
      await runner.seedInitialPendingAsset(asset);

      const result = await service.transitionEditorialImageRights(
        { auth: { uid: users.ownerUser.id } },
        {
          assetId: 'asset_self_owner',
          expectedRevision: 1,
          targetStatus: 'Approved',
          ...buildValidApprovalFields(),
        }
      );

      expect(result.record.revision).toBe(2);
      expect(result.record.asset.rights.status).toBe('Approved');
      expect(result.record.asset.rights.reviewedByUid).toBe(users.ownerUser.id);
      expect(result.record.asset.rights.reviewedAtIso).toBe(
        '2026-10-21T09:15:00.000Z'
      );
      expect(result.auditEvent.selfApprovedByOwner).toBe(true);
      expect(result.auditEvent.actorUserId).toBe(users.ownerUser.id);
      expect(result.auditEvent.actorRole).toBe(AdminRole.Owner);
    });

    it('permits a distinct RightsReviewer to approve an asset even if display name and email match the creator', async () => {
      const { adminRepo, runner, service } = await setupFixture(
        '2026-10-21T09:20:00.000Z'
      );
      // Reviewer has identical name and email to creator_uid_1, but a distinct UID
      await adminRepo.saveAdmin({
        id: 'distinct_reviewer_uid',
        name: 'Same Display Name',
        email: 'same@promise.org',
        role: AdminRole.RightsReviewer,
        isActive: true,
      });

      const asset = createPendingCanonicalAsset({
        assetId: 'asset_distinct_reviewer',
        createdByUid: 'creator_uid_1',
      });
      await runner.seedInitialPendingAsset(asset);

      const result = await service.transitionEditorialImageRights(
        { auth: { uid: 'distinct_reviewer_uid' } },
        {
          assetId: 'asset_distinct_reviewer',
          expectedRevision: 1,
          targetStatus: 'Approved',
          ...buildValidApprovalFields(),
        }
      );

      expect(result.record.revision).toBe(2);
      expect(result.record.asset.rights.status).toBe('Approved');
      expect(result.record.asset.rights.reviewedByUid).toBe(
        'distinct_reviewer_uid'
      );
      expect(result.auditEvent.selfApprovedByOwner).toBe(false);
    });
  });

  describe('3. Exact Four-State Rights Transition Matrix & Fail-Closed Vocabulary', () => {
    it('enforces the exact four-state vocabulary (PendingReview, Approved, Rejected, Revoked) and rejects Unverified', () => {
      expect(CANONICAL_RIGHTS_REVIEW_STATUSES).toEqual([
        'PendingReview',
        'Approved',
        'Rejected',
        'Revoked',
      ]);
      expect(CANONICAL_RIGHTS_REVIEW_STATUSES).not.toContain('Unverified');

      // Permitted transitions
      expect(isAllowedRightsTransition('PendingReview', 'Approved')).toBe(true);
      expect(isAllowedRightsTransition('PendingReview', 'Rejected')).toBe(true);
      expect(isAllowedRightsTransition('Approved', 'Revoked')).toBe(true);
      expect(isAllowedRightsTransition('Rejected', 'Approved')).toBe(true);
      expect(isAllowedRightsTransition('Revoked', 'Approved')).toBe(true);

      // All other transitions fail closed
      expect(isAllowedRightsTransition('PendingReview', 'PendingReview')).toBe(
        false
      );
      expect(isAllowedRightsTransition('PendingReview', 'Revoked')).toBe(false);
      expect(isAllowedRightsTransition('Approved', 'Approved')).toBe(false);
      expect(isAllowedRightsTransition('Approved', 'PendingReview')).toBe(
        false
      );
      expect(isAllowedRightsTransition('Approved', 'Rejected')).toBe(false);
      expect(isAllowedRightsTransition('Rejected', 'Rejected')).toBe(false);
      expect(isAllowedRightsTransition('Rejected', 'PendingReview')).toBe(
        false
      );
      expect(isAllowedRightsTransition('Rejected', 'Revoked')).toBe(false);
      expect(isAllowedRightsTransition('Revoked', 'Revoked')).toBe(false);
      expect(isAllowedRightsTransition('Revoked', 'PendingReview')).toBe(false);
      expect(isAllowedRightsTransition('Revoked', 'Rejected')).toBe(false);
      expect(isAllowedRightsTransition('Unverified', 'Approved')).toBe(false);
      expect(isAllowedRightsTransition('PendingReview', 'Unverified')).toBe(
        false
      );
    });

    it('executes PendingReview -> Rejected and Approved -> Revoked, and rejects all forbidden transitions', async () => {
      const { runner, service, seedActiveEvidence, setClock, users } =
        await setupFixture('2026-10-21T09:00:00.000Z');

      const assetA = createPendingCanonicalAsset({ assetId: 'asset_matrix_a' });
      const assetB = createPendingCanonicalAsset({ assetId: 'asset_matrix_b' });
      await runner.seedInitialPendingAsset(assetA);
      await runner.seedInitialPendingAsset(assetB);
      await seedActiveEvidence('asset_matrix_b', 'ev_contract_2026_001');

      // Forbidden: PendingReview -> Revoked
      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: users.reviewerOne.id } },
          {
            assetId: 'asset_matrix_a',
            expectedRevision: 1,
            targetStatus: 'Revoked',
            reviewReason: 'Cannot revoke before approval.',
          }
        )
      ).rejects.toMatchObject({
        code: 'INVALID_TRANSITION',
      });

      // Forbidden: PendingReview -> PendingReview
      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: users.reviewerOne.id } },
          {
            assetId: 'asset_matrix_a',
            expectedRevision: 1,
            targetStatus: 'PendingReview' as any,
            reviewReason: 'Cannot transition to PendingReview.',
          }
        )
      ).rejects.toMatchObject({
        code: 'INVALID_TRANSITION',
      });

      // Forbidden: Unverified target status
      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: users.reviewerOne.id } },
          {
            assetId: 'asset_matrix_a',
            expectedRevision: 1,
            targetStatus: 'Unverified' as any,
            reviewReason: 'Unverified is not in canonical vocabulary.',
          }
        )
      ).rejects.toMatchObject({
        code: 'INVALID_TRANSITION',
      });

      // Valid: PendingReview -> Rejected on asset_matrix_a
      const rejectedRes = await service.transitionEditorialImageRights(
        { auth: { uid: users.reviewerOne.id } },
        {
          assetId: 'asset_matrix_a',
          expectedRevision: 1,
          targetStatus: 'Rejected',
          reviewReason: 'Missing signed release from copyright holder.',
        }
      );
      expect(rejectedRes.record.revision).toBe(2);
      expect(rejectedRes.record.asset.rights.status).toBe('Rejected');
      expect(rejectedRes.record.asset.status).toBe('active');

      // Forbidden: Rejected -> Revoked
      setClock('2026-10-21T09:05:00.000Z');
      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: users.reviewerOne.id } },
          {
            assetId: 'asset_matrix_a',
            expectedRevision: 2,
            targetStatus: 'Revoked',
            reviewReason: 'Rejected cannot transition to Revoked.',
          }
        )
      ).rejects.toMatchObject({
        code: 'INVALID_TRANSITION',
      });

      // Valid: PendingReview -> Approved -> Revoked on asset_matrix_b
      const approvedRes = await service.transitionEditorialImageRights(
        { auth: { uid: users.reviewerOne.id } },
        {
          assetId: 'asset_matrix_b',
          expectedRevision: 1,
          targetStatus: 'Approved',
          ...buildValidApprovalFields(),
        }
      );
      expect(approvedRes.record.revision).toBe(2);
      expect(approvedRes.record.asset.rights.status).toBe('Approved');

      // Forbidden: Approved -> Rejected
      setClock('2026-10-21T09:10:00.000Z');
      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: users.reviewerOne.id } },
          {
            assetId: 'asset_matrix_b',
            expectedRevision: 2,
            targetStatus: 'Rejected',
            reviewReason: 'Approved must be Revoked, not Rejected.',
          }
        )
      ).rejects.toMatchObject({
        code: 'INVALID_TRANSITION',
      });

      // Valid: Approved -> Revoked
      const revokedRes = await service.transitionEditorialImageRights(
        { auth: { uid: users.reviewerOne.id } },
        {
          assetId: 'asset_matrix_b',
          expectedRevision: 2,
          targetStatus: 'Revoked',
          reviewReason:
            'Rights holder notified editorial desk of license expiration.',
        }
      );
      expect(revokedRes.record.revision).toBe(3);
      expect(revokedRes.record.asset.rights.status).toBe('Revoked');
      expect(revokedRes.auditEvent.previousRightsStatus).toBe('Approved');
      expect(revokedRes.auditEvent.newRightsStatus).toBe('Revoked');
    });
  });

  describe('4. Documented Review Requests & Replay Protection for Rejected/Revoked Reapproval', () => {
    it('denies Rejected -> Approved and Revoked -> Approved when reviewRequestId is omitted, fake, cross-asset, stale, or lacks new evidence', async () => {
      const { runner, service, seedActiveEvidence, setClock, users } =
        await setupFixture('2026-10-21T09:00:00.000Z');

      const rejectedAsset = createPendingCanonicalAsset({
        assetId: 'asset_reapprove_rej',
      });
      const otherRejectedAsset = createPendingCanonicalAsset({
        assetId: 'asset_other_rej',
      });
      await runner.seedInitialPendingAsset(rejectedAsset);
      await runner.seedInitialPendingAsset(otherRejectedAsset);

      await seedActiveEvidence(
        'asset_reapprove_rej',
        'ev_initial_1',
        '2026-10-21T08:00:00.000Z'
      );
      await seedActiveEvidence(
        'asset_other_rej',
        'ev_other_1',
        '2026-10-21T08:00:00.000Z'
      );
      await seedActiveEvidence(
        'asset_reapprove_rej',
        'ev_new_2',
        '2026-10-21T09:10:00.000Z'
      );
      await seedActiveEvidence(
        'asset_other_rej',
        'ev_other_2',
        '2026-10-21T09:10:00.000Z'
      );

      // Transition both to Rejected with initial evidence ['ev_initial_1']
      await service.transitionEditorialImageRights(
        { auth: { uid: users.reviewerOne.id } },
        {
          assetId: 'asset_reapprove_rej',
          expectedRevision: 1,
          targetStatus: 'Rejected',
          reviewReason: 'Initial evidence insufficient.',
          evidenceRefs: ['ev_initial_1'],
        }
      );
      await service.transitionEditorialImageRights(
        { auth: { uid: users.reviewerOne.id } },
        {
          assetId: 'asset_other_rej',
          expectedRevision: 1,
          targetStatus: 'Rejected',
          reviewReason: 'Other asset rejected.',
          evidenceRefs: ['ev_other_1'],
        }
      );

      setClock('2026-10-21T09:30:00.000Z');

      // 1. Denied without reviewRequestId
      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: users.reviewerTwo.id } },
          {
            assetId: 'asset_reapprove_rej',
            expectedRevision: 2,
            targetStatus: 'Approved',
            ...buildValidApprovalFields({
              evidenceRefs: ['ev_initial_1', 'ev_new_2'],
            }),
          }
        )
      ).rejects.toMatchObject({
        code: 'REVIEW_REQUEST_REQUIRED',
      });

      // 2. Denied with fake/non-existent reviewRequestId
      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: users.reviewerTwo.id } },
          {
            assetId: 'asset_reapprove_rej',
            expectedRevision: 2,
            targetStatus: 'Approved',
            ...buildValidApprovalFields({
              reviewRequestId: 'req_nonexistent_999',
              evidenceRefs: ['ev_initial_1', 'ev_new_2'],
            }),
          }
        )
      ).rejects.toMatchObject({
        code: 'INVALID_REVIEW_REQUEST',
      });

      // 3. Denied when submitting a review request without any NEW evidence reference
      await expect(
        service.submitRightsReviewRequest(
          { auth: { uid: users.reviewerOne.id } },
          {
            requestId: 'req_no_new_ev',
            assetId: 'asset_reapprove_rej',
            expectedRevision: 2,
            rationale: 'Re-submitting same evidence.',
            submittedEvidenceRefs: ['ev_initial_1'],
          }
        )
      ).rejects.toMatchObject({
        code: 'INVALID_REVIEW_REQUEST',
      });

      // 4. Denied when submitting a review request with timestamp not strictly > priorReviewedAtIso
      setClock('2026-10-21T09:00:00.000Z');
      await expect(
        service.submitRightsReviewRequest(
          { auth: { uid: users.reviewerOne.id } },
          {
            requestId: 'req_same_timestamp',
            assetId: 'asset_reapprove_rej',
            expectedRevision: 2,
            rationale: 'Submitted at exact same timestamp as rejection.',
            submittedEvidenceRefs: ['ev_new_2'],
          }
        )
      ).rejects.toMatchObject({
        code: 'INVALID_REVIEW_REQUEST',
      });

      // 5. Submit valid request on asset_other_rej, then try to use it on asset_reapprove_rej (cross-asset)
      setClock('2026-10-21T09:35:00.000Z');
      const otherReq = await service.submitRightsReviewRequest(
        { auth: { uid: users.reviewerOne.id } },
        {
          requestId: 'req_for_other_asset',
          assetId: 'asset_other_rej',
          expectedRevision: 2,
          rationale: 'New evidence for other asset.',
          submittedEvidenceRefs: ['ev_other_2'],
        }
      );

      setClock('2026-10-21T09:40:00.000Z');
      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: users.reviewerTwo.id } },
          {
            assetId: 'asset_reapprove_rej',
            expectedRevision: 2,
            targetStatus: 'Approved',
            ...buildValidApprovalFields({
              reviewRequestId: otherReq.requestId,
              evidenceRefs: ['ev_initial_1', 'ev_other_2'],
            }),
          }
        )
      ).rejects.toMatchObject({
        code: 'INVALID_REVIEW_REQUEST',
      });
    });

    it('accepts Rejected -> Approved and Revoked -> Approved with a fresh persisted request and new evidence, and blocks replay', async () => {
      const { runner, service, seedActiveEvidence, setClock, users } =
        await setupFixture('2026-10-21T10:00:00.000Z');

      const asset = createPendingCanonicalAsset({
        assetId: 'asset_full_lifecycle',
        createdByUid: 'author_uid_50',
      });
      await runner.seedInitialPendingAsset(asset);
      await seedActiveEvidence(
        'asset_full_lifecycle',
        'ev_unsigned_01',
        '2026-10-21T08:00:00.000Z'
      );

      // Step 1: PendingReview -> Rejected (rev 1 -> 2)
      await service.transitionEditorialImageRights(
        { auth: { uid: users.reviewerOne.id } },
        {
          assetId: 'asset_full_lifecycle',
          expectedRevision: 1,
          targetStatus: 'Rejected',
          reviewReason: 'Initial agency release was unsigned.',
          evidenceRefs: ['ev_unsigned_01'],
        }
      );

      // Step 2: Register new post-rejection evidence and submit documented review request
      await seedActiveEvidence(
        'asset_full_lifecycle',
        'ev_signed_02',
        '2026-10-21T10:05:00.000Z'
      );
      await seedActiveEvidence(
        'asset_full_lifecycle',
        'ev_different_03',
        '2026-10-21T10:05:00.000Z'
      );
      setClock('2026-10-21T10:15:00.000Z');
      const rejRequest = await service.submitRightsReviewRequest(
        { auth: { uid: users.reviewerOne.id } },
        {
          requestId: 'req_reapprove_from_rejected',
          assetId: 'asset_full_lifecycle',
          expectedRevision: 2,
          rationale:
            'Uploaded counter-signed agency release document ev_signed_02.',
          submittedEvidenceRefs: ['ev_signed_02'],
        }
      );
      expect(rejRequest.status).toBe('Pending');
      expect(rejRequest.assetRevision).toBe(2);
      expect(rejRequest.priorRightsStatus).toBe('Rejected');

      // Step 3: Decision omitting the request's submittedEvidenceRefs is rejected
      setClock('2026-10-21T10:25:00.000Z');
      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: users.reviewerTwo.id } },
          {
            assetId: 'asset_full_lifecycle',
            expectedRevision: 2,
            targetStatus: 'Approved',
            ...buildValidApprovalFields({
              reviewRequestId: rejRequest.requestId,
              evidenceRefs: ['ev_different_03'],
            }),
          }
        )
      ).rejects.toMatchObject({
        code: 'INVALID_REVIEW_REQUEST',
      });

      // Step 4: Rejected -> Approved succeeds when including submitted evidence (rev 2 -> 3)
      const reapprovedFromRejected =
        await service.transitionEditorialImageRights(
          { auth: { uid: users.reviewerTwo.id } },
          {
            assetId: 'asset_full_lifecycle',
            expectedRevision: 2,
            targetStatus: 'Approved',
            ...buildValidApprovalFields({
              reviewRequestId: rejRequest.requestId,
              evidenceRefs: ['ev_unsigned_01', 'ev_signed_02'],
              reviewReason:
                'Verified counter-signed agency release ev_signed_02.',
            }),
          }
        );

      expect(reapprovedFromRejected.record.revision).toBe(3);
      expect(reapprovedFromRejected.record.asset.rights.status).toBe(
        'Approved'
      );
      expect(
        reapprovedFromRejected.consumedReviewRequest?.status
      ).toBe('Consumed');
      expect(
        reapprovedFromRejected.consumedReviewRequest?.consumedByAuditId
      ).toBe(reapprovedFromRejected.auditEvent.id);
      expect(reapprovedFromRejected.auditEvent.reviewRequestId).toBe(
        rejRequest.requestId
      );

      // Step 5: Approved -> Revoked (rev 3 -> 4)
      setClock('2026-10-21T11:00:00.000Z');
      await service.transitionEditorialImageRights(
        { auth: { uid: users.reviewerOne.id } },
        {
          assetId: 'asset_full_lifecycle',
          expectedRevision: 3,
          targetStatus: 'Revoked',
          reviewReason:
            'Territory addendum required before continued use.',
        }
      );

      // Step 6: Attempting to replay the previously consumed review request is denied
      await seedActiveEvidence(
        'asset_full_lifecycle',
        'ev_addendum_03',
        '2026-10-21T11:05:00.000Z'
      );
      setClock('2026-10-21T11:10:00.000Z');
      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: users.reviewerTwo.id } },
          {
            assetId: 'asset_full_lifecycle',
            expectedRevision: 4,
            targetStatus: 'Approved',
            ...buildValidApprovalFields({
              reviewRequestId: rejRequest.requestId,
              evidenceRefs: ['ev_unsigned_01', 'ev_signed_02', 'ev_addendum_03'],
            }),
          }
        )
      ).rejects.toMatchObject({
        code: 'REVIEW_REQUEST_CONSUMED',
      });

      // Step 7: Submit fresh review request for Revoked -> Approved with new evidence
      setClock('2026-10-21T11:20:00.000Z');
      const revRequest = await service.submitRightsReviewRequest(
        { auth: { uid: users.ownerUser.id } },
        {
          requestId: 'req_reapprove_from_revoked',
          assetId: 'asset_full_lifecycle',
          expectedRevision: 4,
          rationale:
            'Obtained signed global territory addendum ev_addendum_03.',
          submittedEvidenceRefs: ['ev_addendum_03'],
        }
      );

      // Step 8: Revoked -> Approved succeeds with fresh request and new evidence (rev 4 -> 5)
      setClock('2026-10-21T11:30:00.000Z');
      const reapprovedFromRevoked =
        await service.transitionEditorialImageRights(
          { auth: { uid: users.ownerUser.id } },
          {
            assetId: 'asset_full_lifecycle',
            expectedRevision: 4,
            targetStatus: 'Approved',
            ...buildValidApprovalFields({
              reviewRequestId: revRequest.requestId,
              evidenceRefs: [
                'ev_unsigned_01',
                'ev_signed_02',
                'ev_addendum_03',
              ],
              reviewReason:
                'Approved following verification of global territory addendum ev_addendum_03.',
            }),
          }
        );

      expect(reapprovedFromRevoked.record.revision).toBe(5);
      expect(reapprovedFromRevoked.record.asset.rights.status).toBe('Approved');
      expect(reapprovedFromRevoked.auditEvent.previousRightsStatus).toBe(
        'Revoked'
      );
      expect(reapprovedFromRevoked.auditEvent.newRightsStatus).toBe('Approved');
      expect(reapprovedFromRevoked.auditEvent.reviewRequestId).toBe(
        revRequest.requestId
      );

      const audits = await runner.listAuditEventsForAsset(
        'asset_full_lifecycle'
      );
      expect(audits).toHaveLength(4);
    });
  });

  describe('5. Atomic Persistence, Concurrency Control & All-or-Nothing Rollback Guarantees', () => {
    it('denies concurrent stale revision updates (CONFLICT) and preserves single-increment consistency', async () => {
      const { runner, service, users } = await setupFixture(
        '2026-10-21T12:00:00.000Z'
      );
      const asset = createPendingCanonicalAsset({ assetId: 'asset_cas_1' });
      await runner.seedInitialPendingAsset(asset);

      const [res1, res2] = await Promise.allSettled([
        service.transitionEditorialImageRights(
          { auth: { uid: users.reviewerOne.id } },
          {
            assetId: 'asset_cas_1',
            expectedRevision: 1,
            targetStatus: 'Approved',
            ...buildValidApprovalFields(),
          }
        ),
        service.transitionEditorialImageRights(
          { auth: { uid: users.reviewerTwo.id } },
          {
            assetId: 'asset_cas_1',
            expectedRevision: 1,
            targetStatus: 'Rejected',
            reviewReason: 'Concurrent rejection attempt on revision 1.',
          }
        ),
      ]);

      const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
      const rejected = [res1, res2].filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected'
      );

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0].reason as EditorialImageRightsReviewError).code).toBe(
        'CONFLICT'
      );

      const stored = await runner.getAssetRecord('asset_cas_1');
      expect(stored?.revision).toBe(2);
      const audits = await runner.listAuditEventsForAsset('asset_cas_1');
      expect(audits).toHaveLength(1);
    });

    it('rolls back asset update and review request consumption in memory when audit write fails', async () => {
      const { runner, service, seedActiveEvidence, setClock, users } =
        await setupFixture('2026-10-21T12:00:00.000Z');
      const asset = createPendingCanonicalAsset({
        assetId: 'asset_rollback_mem',
      });
      await runner.seedInitialPendingAsset(asset);
      await seedActiveEvidence(
        'asset_rollback_mem',
        'ev_1',
        '2026-10-21T08:00:00.000Z'
      );
      await seedActiveEvidence(
        'asset_rollback_mem',
        'ev_2',
        '2026-10-21T12:05:00.000Z'
      );

      // Transition to Rejected first (rev 1 -> 2)
      await service.transitionEditorialImageRights(
        { auth: { uid: users.reviewerOne.id } },
        {
          assetId: 'asset_rollback_mem',
          expectedRevision: 1,
          targetStatus: 'Rejected',
          reviewReason: 'Initial rejection.',
          evidenceRefs: ['ev_1'],
        }
      );

      // Submit review request
      setClock('2026-10-21T12:10:00.000Z');
      const req = await service.submitRightsReviewRequest(
        { auth: { uid: users.reviewerOne.id } },
        {
          requestId: 'req_rollback_mem',
          assetId: 'asset_rollback_mem',
          expectedRevision: 2,
          rationale: 'New evidence provided.',
          submittedEvidenceRefs: ['ev_2'],
        }
      );

      // Inject fault on audit write during Rejected -> Approved
      setClock('2026-10-21T12:20:00.000Z');
      runner.injectFaultForNextTransaction({ failOnAuditWrite: true });

      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: users.reviewerTwo.id } },
          {
            assetId: 'asset_rollback_mem',
            expectedRevision: 2,
            targetStatus: 'Approved',
            ...buildValidApprovalFields({
              reviewRequestId: req.requestId,
              evidenceRefs: ['ev_1', 'ev_2'],
            }),
          }
        )
      ).rejects.toMatchObject({
        code: 'PERSISTENCE_FAILURE',
      });

      // Verify asset remained at revision 2 and status Rejected, request remained Pending, and only 1 audit event exists
      const storedAsset = await runner.getAssetRecord('asset_rollback_mem');
      expect(storedAsset?.revision).toBe(2);
      expect(storedAsset?.asset.rights.status).toBe('Rejected');

      const storedReq = await runner.getReviewRequest(req.requestId);
      expect(storedReq?.status).toBe('Pending');
      expect(storedReq?.consumedAtIso).toBeUndefined();

      const audits = await runner.listAuditEventsForAsset('asset_rollback_mem');
      expect(audits).toHaveLength(1);
    });

    it('rolls back asset update and audit write in memory when review request consumption fails', async () => {
      const { runner, service, seedActiveEvidence, setClock, users } =
        await setupFixture('2026-10-21T12:00:00.000Z');
      const asset = createPendingCanonicalAsset({
        assetId: 'asset_rollback_req_mem',
      });
      await runner.seedInitialPendingAsset(asset);
      await seedActiveEvidence(
        'asset_rollback_req_mem',
        'ev_1',
        '2026-10-21T08:00:00.000Z'
      );
      await seedActiveEvidence(
        'asset_rollback_req_mem',
        'ev_2',
        '2026-10-21T12:05:00.000Z'
      );

      await service.transitionEditorialImageRights(
        { auth: { uid: users.reviewerOne.id } },
        {
          assetId: 'asset_rollback_req_mem',
          expectedRevision: 1,
          targetStatus: 'Rejected',
          reviewReason: 'Initial rejection.',
          evidenceRefs: ['ev_1'],
        }
      );

      setClock('2026-10-21T12:10:00.000Z');
      const req = await service.submitRightsReviewRequest(
        { auth: { uid: users.reviewerOne.id } },
        {
          requestId: 'req_rollback_consume_mem',
          assetId: 'asset_rollback_req_mem',
          expectedRevision: 2,
          rationale: 'Supplying ev_2.',
          submittedEvidenceRefs: ['ev_2'],
        }
      );

      // Inject fault on review request consumption write
      setClock('2026-10-21T12:20:00.000Z');
      runner.injectFaultForNextTransaction({ failOnRequestConsumeWrite: true });

      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: users.reviewerTwo.id } },
          {
            assetId: 'asset_rollback_req_mem',
            expectedRevision: 2,
            targetStatus: 'Approved',
            ...buildValidApprovalFields({
              reviewRequestId: req.requestId,
              evidenceRefs: ['ev_1', 'ev_2'],
            }),
          }
        )
      ).rejects.toMatchObject({
        code: 'PERSISTENCE_FAILURE',
      });

      const storedAsset = await runner.getAssetRecord('asset_rollback_req_mem');
      expect(storedAsset?.revision).toBe(2);
      expect(storedAsset?.asset.rights.status).toBe('Rejected');

      const storedReq = await runner.getReviewRequest(req.requestId);
      expect(storedReq?.status).toBe('Pending');

      const audits = await runner.listAuditEventsForAsset(
        'asset_rollback_req_mem'
      );
      expect(audits).toHaveLength(1);
    });

    it('enforces atomic all-or-nothing rollback in FirestoreEditorialImageRightsReviewRunner on audit or request write failure', async () => {
      const mockDb = new TransactionalMockFirestoreDb();
      const firestoreRunner = new FirestoreEditorialImageRightsReviewRunner(
        mockDb
      );
      const adminRepo = new InMemoryAdminRepository();

      const fsAdmin1: AdminUser = {
        id: 'reviewer_fs_1',
        name: 'Firestore Reviewer 1',
        email: 'fs1@promise.org',
        role: AdminRole.RightsReviewer,
        isActive: true,
      };
      const fsAdmin2: AdminUser = {
        id: 'reviewer_fs_2',
        name: 'Firestore Reviewer 2',
        email: 'fs2@promise.org',
        role: AdminRole.RightsReviewer,
        isActive: true,
      };

      await adminRepo.saveAdmin(fsAdmin1);
      await adminRepo.saveAdmin(fsAdmin2);
      mockDb.seedDocument(
        EDITORIAL_IMAGE_ADMINS_COLLECTION,
        fsAdmin1.id,
        fsAdmin1
      );
      mockDb.seedDocument(
        EDITORIAL_IMAGE_ADMINS_COLLECTION,
        fsAdmin2.id,
        fsAdmin2
      );

      let clockIso = '2026-10-21T13:00:00.000Z';
      const service = new EditorialImageRightsReviewService({
        adminRepository: adminRepo,
        transactionRunner: firestoreRunner,
        clock: () => clockIso,
      });

      const initialAsset = createPendingCanonicalAsset({
        assetId: 'asset_fs_atomic',
      });
      mockDb.seedDocument(
        EDITORIAL_IMAGE_ASSET_COLLECTION,
        initialAsset.assetId,
        serializeEnvelopeForPersistence({
          assetId: initialAsset.assetId,
          revision: INITIAL_EDITORIAL_IMAGE_ASSET_REVISION,
          asset: initialAsset,
        })
      );

      mockDb.seedDocument(
        EDITORIAL_IMAGE_RIGHTS_EVIDENCE_COLLECTION,
        'ev_fs_1',
        serializeEvidenceRecordForPersistence({
          evidenceId: 'ev_fs_1',
          assetId: 'asset_fs_atomic',
          status: 'Active',
          sourceKind: 'SignedLicenseAgreement',
          sourceReference: 'FS-LIC-001',
          summary: 'Initial Firestore evidence record 1.',
          recordedByUid: fsAdmin1.id,
          recordedAtIso: '2026-10-21T12:50:00.000Z',
        })
      );

      // Step 1: PendingReview -> Rejected in Firestore
      await service.transitionEditorialImageRights(
        { auth: { uid: 'reviewer_fs_1' } },
        {
          assetId: 'asset_fs_atomic',
          expectedRevision: 1,
          targetStatus: 'Rejected',
          reviewReason: 'Missing license details.',
          evidenceRefs: ['ev_fs_1'],
        }
      );

      // Step 2: Register new post-rejection evidence and submit review request in Firestore
      clockIso = '2026-10-21T13:05:00.000Z';
      await service.registerRightsEvidence(
        { auth: { uid: 'reviewer_fs_1' } },
        {
          evidenceId: 'ev_fs_2',
          assetId: 'asset_fs_atomic',
          sourceKind: 'SignedLicenseAgreement',
          sourceReference: 'FS-LIC-002',
          summary: 'Signed follow-up contract for asset_fs_atomic.',
        }
      );

      clockIso = '2026-10-21T13:10:00.000Z';
      const fsReq = await service.submitRightsReviewRequest(
        { auth: { uid: 'reviewer_fs_1' } },
        {
          requestId: 'req_fs_1',
          assetId: 'asset_fs_atomic',
          expectedRevision: 2,
          rationale: 'Added signed contract ev_fs_2.',
          submittedEvidenceRefs: ['ev_fs_2'],
        }
      );

      // Step 3: Fail audit creation in Firestore transaction -> verify rollback
      clockIso = '2026-10-21T13:20:00.000Z';
      mockDb.failOnAuditCreate = true;
      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: 'reviewer_fs_2' } },
          {
            assetId: 'asset_fs_atomic',
            expectedRevision: 2,
            targetStatus: 'Approved',
            ...buildValidApprovalFields({
              reviewRequestId: fsReq.requestId,
              evidenceRefs: ['ev_fs_1', 'ev_fs_2'],
            }),
          }
        )
      ).rejects.toMatchObject({
        code: 'PERSISTENCE_FAILURE',
      });

      const rawAssetAfterAuditFail = mockDb.readRawDocument(
        EDITORIAL_IMAGE_ASSET_COLLECTION,
        'asset_fs_atomic'
      ) as any;
      expect(rawAssetAfterAuditFail.revision).toBe(2);
      expect(rawAssetAfterAuditFail.asset.rights.status).toBe('Rejected');

      const rawReqAfterAuditFail = mockDb.readRawDocument(
        EDITORIAL_IMAGE_RIGHTS_REVIEW_REQUEST_COLLECTION,
        fsReq.requestId
      ) as any;
      expect(rawReqAfterAuditFail.status).toBe('Pending');

      // Step 4: Fail request consumption set in Firestore transaction -> verify rollback
      mockDb.failOnRequestSet = true;
      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: 'reviewer_fs_2' } },
          {
            assetId: 'asset_fs_atomic',
            expectedRevision: 2,
            targetStatus: 'Approved',
            ...buildValidApprovalFields({
              reviewRequestId: fsReq.requestId,
              evidenceRefs: ['ev_fs_1', 'ev_fs_2'],
            }),
          }
        )
      ).rejects.toMatchObject({
        code: 'PERSISTENCE_FAILURE',
      });

      const rawAssetAfterReqFail = mockDb.readRawDocument(
        EDITORIAL_IMAGE_ASSET_COLLECTION,
        'asset_fs_atomic'
      ) as any;
      expect(rawAssetAfterReqFail.revision).toBe(2);
      expect(rawAssetAfterReqFail.asset.rights.status).toBe('Rejected');
      expect(
        mockDb.listCollectionDocuments(EDITORIAL_IMAGE_RIGHTS_AUDIT_COLLECTION)
      ).toHaveLength(1);

      // Step 5: Succeeds cleanly when no fault is injected
      const finalSuccess = await service.transitionEditorialImageRights(
        { auth: { uid: 'reviewer_fs_2' } },
        {
          assetId: 'asset_fs_atomic',
          expectedRevision: 2,
          targetStatus: 'Approved',
          ...buildValidApprovalFields({
            reviewRequestId: fsReq.requestId,
            evidenceRefs: ['ev_fs_1', 'ev_fs_2'],
          }),
        }
      );
      expect(finalSuccess.record.revision).toBe(3);
      expect(finalSuccess.record.asset.rights.status).toBe('Approved');
      expect(
        mockDb.listCollectionDocuments(EDITORIAL_IMAGE_RIGHTS_AUDIT_COLLECTION)
      ).toHaveLength(2);
    });
  });

  describe('6. Zero Client Spoofing, Clock Chronology & Dedicated Audit Identity', () => {
    it('rejects client-supplied spoofed identity, role, timestamp, revision, or approval fields', async () => {
      const { runner, service, users } = await setupFixture();
      const asset = createPendingCanonicalAsset({ assetId: 'asset_spoof_1' });
      await runner.seedInitialPendingAsset(asset);

      const spoofedPayloads = [
        { reviewedByUid: 'spoofed_uid' },
        { reviewedAtIso: '2026-10-21T09:00:00.000Z' },
        { actorUserId: 'spoofed_actor' },
        { actorRole: 'Owner' },
        { updatedAtIso: '2026-10-21T09:00:00.000Z' },
        { revision: 99 },
        { isApproved: true },
      ];

      for (const extra of spoofedPayloads) {
        await expect(
          service.transitionEditorialImageRights(
            { auth: { uid: users.reviewerOne.id } },
            {
              assetId: 'asset_spoof_1',
              expectedRevision: 1,
              targetStatus: 'Approved',
              ...buildValidApprovalFields(),
              ...extra,
            } as any
          )
        ).rejects.toMatchObject({
          code: 'INVALID_INPUT',
        });
      }

      await expect(
        service.submitRightsReviewRequest(
          { auth: { uid: users.reviewerOne.id } },
          {
            assetId: 'asset_spoof_1',
            expectedRevision: 1,
            rationale: 'Valid rationale',
            submittedEvidenceRefs: ['ev_1'],
            requestedByUid: 'spoofed_requester',
          } as any
        )
      ).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
    });

    it('enforces canonical UTC timestamp chronology and rejects server clock rollback', async () => {
      const { runner, service, setClock, users } = await setupFixture(
        '2026-10-21T07:30:00.000Z' // Precedes asset createdAtIso (08:00:00.000Z)
      );
      const asset = createPendingCanonicalAsset({
        assetId: 'asset_clock_1',
        createdAtIso: '2026-10-21T08:00:00.000Z',
        updatedAtIso: '2026-10-21T08:00:00.000Z',
      });
      await runner.seedInitialPendingAsset(asset);

      // Clock rollback before createdAtIso / updatedAtIso is rejected
      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: users.reviewerOne.id } },
          {
            assetId: 'asset_clock_1',
            expectedRevision: 1,
            targetStatus: 'Approved',
            ...buildValidApprovalFields(),
          }
        )
      ).rejects.toMatchObject({
        code: 'CLOCK_ROLLBACK',
      });

      // Valid forward clock
      setClock('2026-10-21T08:30:00.000Z');
      const approved = await service.transitionEditorialImageRights(
        { auth: { uid: users.reviewerOne.id } },
        {
          assetId: 'asset_clock_1',
          expectedRevision: 1,
          targetStatus: 'Approved',
          ...buildValidApprovalFields(),
        }
      );

      expect(
        Date.parse(approved.record.asset.createdAtIso) <=
          Date.parse(approved.record.asset.rights.reviewedAtIso!)
      ).toBe(true);
      expect(
        Date.parse(approved.record.asset.rights.reviewedAtIso!) <=
          Date.parse(approved.record.asset.updatedAtIso)
      ).toBe(true);

      // Clock rollback before prior reviewedAtIso on subsequent transition is rejected
      setClock('2026-10-21T08:15:00.000Z');
      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: users.reviewerOne.id } },
          {
            assetId: 'asset_clock_1',
            expectedRevision: 2,
            targetStatus: 'Revoked',
            reviewReason: 'Attempted revocation with rolled-back clock.',
          }
        )
      ).rejects.toMatchObject({
        code: 'CLOCK_ROLLBACK',
      });
    });

    it('records explicit EditorialImageAsset audit target identity and never uses AuditTargetType.News', async () => {
      const { runner, service, seedActiveEvidence, users } = await setupFixture(
        '2026-10-21T09:45:00.000Z'
      );
      const asset = createPendingCanonicalAsset({ assetId: 'asset_audit_id' });
      await runner.seedInitialPendingAsset(asset);
      await seedActiveEvidence('asset_audit_id', 'ev_audit_ref_1');
      await seedActiveEvidence('asset_audit_id', 'ev_audit_ref_2');

      const res = await service.transitionEditorialImageRights(
        { auth: { uid: users.reviewerOne.id } },
        {
          assetId: 'asset_audit_id',
          expectedRevision: 1,
          targetStatus: 'Approved',
          ...buildValidApprovalFields({
            evidenceRefs: ['ev_audit_ref_1', 'ev_audit_ref_2'],
          }),
        }
      );

      expect(res.auditEvent.targetType).toBe(EDITORIAL_IMAGE_AUDIT_TARGET_TYPE);
      expect(res.auditEvent.targetType).toBe('EditorialImageAsset');
      expect(res.auditEvent.targetType).not.toBe(AuditTargetType.News);
      expect(res.auditEvent.action).toBe(AuditAction.RightsChanged);
      expect(res.auditEvent.assetId).toBe('asset_audit_id');
      expect(res.auditEvent.targetId).toBe('asset_audit_id');
      expect(res.auditEvent.previousRightsStatus).toBe('PendingReview');
      expect(res.auditEvent.newRightsStatus).toBe('Approved');
      expect(res.auditEvent.previousRevision).toBe(1);
      expect(res.auditEvent.newRevision).toBe(2);
      expect(res.auditEvent.actorUserId).toBe(users.reviewerOne.id);
      expect(res.auditEvent.actorName).toBe(users.reviewerOne.name);
      expect(res.auditEvent.actorRole).toBe(AdminRole.RightsReviewer);
      expect(res.auditEvent.timestamp).toBe('2026-10-21T09:45:00.000Z');
      expect(res.auditEvent.evidenceRefs).toEqual([
        'ev_audit_ref_1',
        'ev_audit_ref_2',
      ]);
      expect(res.auditEvent.selfApprovedByOwner).toBe(false);
    });

    it('requires explicit dependency-injected database/runner adapters and never accesses live Firestore by default', () => {
      expect(
        () => new FirestoreEditorialImageRightsReviewRunner(null as any)
      ).toThrowError(
        expect.objectContaining({
          code: 'PERSISTENCE_FAILURE',
        })
      );

      expect(
        () => new EditorialImageRightsReviewService({} as any)
      ).toThrowError(
        expect.objectContaining({
          code: 'PERSISTENCE_FAILURE',
        })
      );
    });
  });

  describe('7. IMG-F3-04 — Durable Rights Evidence Registry & Contract Validation', () => {
    it('enforces closed key allowlists, sourceKind vocabulary, URL/token prohibitions, and status invariants on EditorialImageRightsEvidenceRecord', () => {
      expect(CANONICAL_EVIDENCE_STATUSES).toEqual(['Active', 'Revoked']);
      expect(CANONICAL_EVIDENCE_SOURCE_KINDS).toEqual([
        'SignedLicenseAgreement',
        'PhotographerWrittenRelease',
        'AgencyContractRecord',
        'PublicDomainArchivalRecord',
        'EditorialExceptionMemo',
      ]);

      const validActive: EditorialImageRightsEvidenceRecord = {
        evidenceId: 'ev_valid_001',
        assetId: 'asset_001',
        status: 'Active',
        sourceKind: 'SignedLicenseAgreement',
        sourceReference: 'CONTRACT-2026-881',
        summary: 'Signed bilateral license agreement with photographer.',
        artifactSha256: VALID_SHA256,
        recordedByUid: 'reviewer_uid_1',
        recordedAtIso: '2026-10-21T08:15:00.000Z',
      };

      expect(
        validateEditorialImageRightsEvidenceRecord(validActive).valid
      ).toBe(true);

      // Active record with revocation fields is rejected
      expect(
        validateEditorialImageRightsEvidenceRecord({
          ...validActive,
          revokedByUid: 'reviewer_uid_2',
        }).valid
      ).toBe(false);

      // Revoked record missing revocation fields is rejected
      expect(
        validateEditorialImageRightsEvidenceRecord({
          ...validActive,
          status: 'Revoked',
        }).valid
      ).toBe(false);

      // Revoked record with revokedAtIso preceding recordedAtIso is rejected
      expect(
        validateEditorialImageRightsEvidenceRecord({
          ...validActive,
          status: 'Revoked',
          revokedByUid: 'reviewer_uid_2',
          revokedAtIso: '2026-10-21T07:00:00.000Z',
          revocationReason: 'Rolled-back revocation timestamp.',
        }).valid
      ).toBe(false);

      // Valid Revoked record passes
      expect(
        validateEditorialImageRightsEvidenceRecord({
          ...validActive,
          status: 'Revoked',
          revokedByUid: 'reviewer_uid_2',
          revokedAtIso: '2026-10-21T09:00:00.000Z',
          revocationReason: 'Agency notified desk of contract termination.',
        }).valid
      ).toBe(true);

      // Invalid artifactSha256 (uppercase or wrong length) is rejected
      expect(
        validateEditorialImageRightsEvidenceRecord({
          ...validActive,
          artifactSha256: VALID_SHA256.toUpperCase(),
        }).valid
      ).toBe(false);

      // Prohibited URL/path/token in sourceReference or evidenceId is rejected
      expect(validateEvidenceId('https://example.com/ev_1').valid).toBe(false);
      expect(validateEvidenceId('editorial_images/private/ev_1').valid).toBe(
        false
      );
      expect(
        validateEditorialImageRightsEvidenceRecord({
          ...validActive,
          sourceReference: 'https://storage.googleapis.com/bucket/doc.pdf',
        }).valid
      ).toBe(false);

      // Unknown property on record is rejected
      expect(
        validateEditorialImageRightsEvidenceRecord({
          ...validActive,
          extraField: 'not_allowed',
        }).valid
      ).toBe(false);
    });

    it('registers and revokes durable evidence records atomically via EditorialImageRightsReviewService and rejects spoofed or duplicate inputs', async () => {
      const { runner, service, setClock, users } = await setupFixture(
        '2026-10-21T09:00:00.000Z'
      );
      const asset = createPendingCanonicalAsset({ assetId: 'asset_ev_reg_1' });
      await runner.seedInitialPendingAsset(asset);

      // Rejects spoofed recordedByUid, recordedAtIso, or status on registration input
      for (const spoofed of [
        { recordedByUid: 'spoofed_uid' },
        { recordedAtIso: '2026-10-21T08:00:00.000Z' },
        { status: 'Active' },
      ]) {
        await expect(
          service.registerRightsEvidence(
            { auth: { uid: users.reviewerOne.id } },
            {
              evidenceId: 'ev_reg_spoof',
              assetId: 'asset_ev_reg_1',
              sourceKind: 'PhotographerWrittenRelease',
              sourceReference: 'REL-2026-10',
              summary: 'Written release from field photographer.',
              ...spoofed,
            } as any
          )
        ).rejects.toMatchObject({
          code: 'INVALID_INPUT',
        });
      }

      // Registers valid evidence record
      const registered = await service.registerRightsEvidence(
        { auth: { uid: users.reviewerOne.id } },
        {
          evidenceId: 'ev_reg_100',
          assetId: 'asset_ev_reg_1',
          sourceKind: 'PhotographerWrittenRelease',
          sourceReference: 'REL-2026-100',
          summary: 'Signed written release verified by editorial desk.',
          artifactSha256: VALID_SHA256,
        }
      );

      expect(registered.evidenceId).toBe('ev_reg_100');
      expect(registered.assetId).toBe('asset_ev_reg_1');
      expect(registered.status).toBe('Active');
      expect(registered.recordedByUid).toBe(users.reviewerOne.id);
      expect(registered.recordedAtIso).toBe('2026-10-21T09:00:00.000Z');
      expect(registered.artifactSha256).toBe(VALID_SHA256);

      // Duplicate evidenceId is rejected with ALREADY_EXISTS
      await expect(
        service.registerRightsEvidence(
          { auth: { uid: users.reviewerOne.id } },
          {
            evidenceId: 'ev_reg_100',
            assetId: 'asset_ev_reg_1',
            sourceKind: 'PhotographerWrittenRelease',
            sourceReference: 'REL-2026-100',
            summary: 'Duplicate registration attempt.',
          }
        )
      ).rejects.toMatchObject({
        code: 'ALREADY_EXISTS',
      });

      // Revoking with wrong assetId is rejected with INVALID_EVIDENCE
      setClock('2026-10-21T09:30:00.000Z');
      await expect(
        service.revokeRightsEvidence(
          { auth: { uid: users.reviewerTwo.id } },
          {
            evidenceId: 'ev_reg_100',
            assetId: 'wrong_asset_id',
            revocationReason: 'Mismatched asset ID.',
          }
        )
      ).rejects.toMatchObject({
        code: 'INVALID_EVIDENCE',
      });

      // Valid revocation transitions status to Revoked and preserves historical registration metadata
      const revoked = await service.revokeRightsEvidence(
        { auth: { uid: users.reviewerTwo.id } },
        {
          evidenceId: 'ev_reg_100',
          assetId: 'asset_ev_reg_1',
          revocationReason: 'Photographer withdrew release prior to publication.',
        }
      );

      expect(revoked.status).toBe('Revoked');
      expect(revoked.recordedByUid).toBe(users.reviewerOne.id);
      expect(revoked.recordedAtIso).toBe('2026-10-21T09:00:00.000Z');
      expect(revoked.revokedByUid).toBe(users.reviewerTwo.id);
      expect(revoked.revokedAtIso).toBe('2026-10-21T09:30:00.000Z');
      expect(revoked.revocationReason).toBe(
        'Photographer withdrew release prior to publication.'
      );

      // Revoking an already-revoked evidence record fails closed with CONFLICT
      setClock('2026-10-21T09:45:00.000Z');
      await expect(
        service.revokeRightsEvidence(
          { auth: { uid: users.reviewerTwo.id } },
          {
            evidenceId: 'ev_reg_100',
            revocationReason: 'Second revocation attempt.',
          }
        )
      ).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('denies approvals and review requests when evidence is missing, revoked, bound to another asset, future-dated, or has a stale timestamp on re-approval', async () => {
      const { runner, service, seedActiveEvidence, setClock, users } =
        await setupFixture('2026-10-21T09:00:00.000Z');

      const asset1 = createPendingCanonicalAsset({ assetId: 'asset_ev_check_1' });
      const asset2 = createPendingCanonicalAsset({ assetId: 'asset_ev_check_2' });
      await runner.seedInitialPendingAsset(asset1);
      await runner.seedInitialPendingAsset(asset2);

      // 1. Missing/unregistered evidenceId -> INVALID_EVIDENCE
      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: users.reviewerOne.id } },
          {
            assetId: 'asset_ev_check_1',
            expectedRevision: 1,
            targetStatus: 'Approved',
            ...buildValidApprovalFields({
              evidenceRefs: ['ev_unregistered_999'],
            }),
          }
        )
      ).rejects.toMatchObject({
        code: 'INVALID_EVIDENCE',
      });

      // 2. Evidence bound to asset_ev_check_2 used on asset_ev_check_1 -> INVALID_EVIDENCE
      await seedActiveEvidence(
        'asset_ev_check_2',
        'ev_bound_to_asset_2',
        '2026-10-21T08:30:00.000Z'
      );
      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: users.reviewerOne.id } },
          {
            assetId: 'asset_ev_check_1',
            expectedRevision: 1,
            targetStatus: 'Approved',
            ...buildValidApprovalFields({
              evidenceRefs: ['ev_bound_to_asset_2'],
            }),
          }
        )
      ).rejects.toMatchObject({
        code: 'INVALID_EVIDENCE',
      });

      // 3. Future-dated evidence (recordedAtIso > decisionTimestampIso) -> INVALID_EVIDENCE
      await seedActiveEvidence(
        'asset_ev_check_1',
        'ev_future_dated',
        '2026-10-21T10:00:00.000Z' // Clock is 09:00:00.000Z
      );
      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: users.reviewerOne.id } },
          {
            assetId: 'asset_ev_check_1',
            expectedRevision: 1,
            targetStatus: 'Approved',
            ...buildValidApprovalFields({
              evidenceRefs: ['ev_future_dated'],
            }),
          }
        )
      ).rejects.toMatchObject({
        code: 'INVALID_EVIDENCE',
      });

      // 4. Revoked evidence record -> INVALID_EVIDENCE
      await service.registerRightsEvidence(
        { auth: { uid: users.reviewerOne.id } },
        {
          evidenceId: 'ev_to_be_revoked',
          assetId: 'asset_ev_check_1',
          sourceKind: 'AgencyContractRecord',
          sourceReference: 'AG-2026-55',
          summary: 'Agency contract later revoked.',
        }
      );
      setClock('2026-10-21T09:05:00.000Z');
      await service.revokeRightsEvidence(
        { auth: { uid: users.reviewerOne.id } },
        {
          evidenceId: 'ev_to_be_revoked',
          revocationReason: 'Contract expired.',
        }
      );

      setClock('2026-10-21T09:10:00.000Z');
      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: users.reviewerOne.id } },
          {
            assetId: 'asset_ev_check_1',
            expectedRevision: 1,
            targetStatus: 'Approved',
            ...buildValidApprovalFields({
              evidenceRefs: ['ev_to_be_revoked'],
            }),
          }
        )
      ).rejects.toMatchObject({
        code: 'INVALID_EVIDENCE',
      });

      // 5. Stale pre-rejection evidence cannot satisfy post-rejection new evidence requirement
      // Register two evidence records BEFORE rejection at 09:20:00.000Z
      await seedActiveEvidence(
        'asset_ev_check_1',
        'ev_pre_rej_used',
        '2026-10-21T08:10:00.000Z'
      );
      await seedActiveEvidence(
        'asset_ev_check_1',
        'ev_pre_rej_unused_stale',
        '2026-10-21T08:20:00.000Z'
      );

      setClock('2026-10-21T09:20:00.000Z');
      await service.transitionEditorialImageRights(
        { auth: { uid: users.reviewerOne.id } },
        {
          assetId: 'asset_ev_check_1',
          expectedRevision: 1,
          targetStatus: 'Rejected',
          reviewReason: 'Rejected at 09:20.',
          evidenceRefs: ['ev_pre_rej_used'],
        }
      );

      // Attempt to submit review request at 09:30 using 'ev_pre_rej_unused_stale' (recorded at 08:20 <= 09:20)
      setClock('2026-10-21T09:30:00.000Z');
      await expect(
        service.submitRightsReviewRequest(
          { auth: { uid: users.reviewerOne.id } },
          {
            requestId: 'req_stale_ev_ts',
            assetId: 'asset_ev_check_1',
            expectedRevision: 2,
            rationale:
              'Trying to use an unused evidence ID that was recorded before the rejection.',
            submittedEvidenceRefs: ['ev_pre_rej_unused_stale'],
          }
        )
      ).rejects.toMatchObject({
        code: 'INVALID_EVIDENCE',
      });
    });
  });

  describe('8. IMG-F3-04 — Transactional Admin Revalidation, Concurrency Races & Retry Simulation', () => {
    it('aborts in-memory transaction when admin is deactivated or demoted after pre-check and before transactional read', async () => {
      const { adminRepo, runner, service, users } = await setupFixture(
        '2026-10-21T10:00:00.000Z'
      );
      const asset = createPendingCanonicalAsset({
        assetId: 'asset_tx_admin_race_mem',
        createdByUid: users.ownerUser.id,
      });
      await runner.seedInitialPendingAsset(asset);

      // Case 1: Reviewer is deactivated right before transactional admin read
      runner.setBeforeNextTransactionHook(async () => {
        await adminRepo.saveAdmin({
          ...users.reviewerOne,
          isActive: false,
        });
      });

      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: users.reviewerOne.id } },
          {
            assetId: 'asset_tx_admin_race_mem',
            expectedRevision: 1,
            targetStatus: 'Approved',
            ...buildValidApprovalFields(),
          }
        )
      ).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });

      // Restore reviewerOne and test Case 2: Reviewer demoted to ContentEditor right before transactional read
      await adminRepo.saveAdmin(users.reviewerOne);
      runner.setBeforeNextTransactionHook(async () => {
        await adminRepo.saveAdmin({
          ...users.reviewerOne,
          role: AdminRole.ContentEditor,
        });
      });

      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: users.reviewerOne.id } },
          {
            assetId: 'asset_tx_admin_race_mem',
            expectedRevision: 1,
            targetStatus: 'Approved',
            ...buildValidApprovalFields(),
          }
        )
      ).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });

      // Case 3: Owner demoted to RightsReviewer right before transactional read while self-approving own asset
      runner.setBeforeNextTransactionHook(async () => {
        await adminRepo.saveAdmin({
          ...users.ownerUser,
          role: AdminRole.RightsReviewer,
        });
      });

      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: users.ownerUser.id } },
          {
            assetId: 'asset_tx_admin_race_mem',
            expectedRevision: 1,
            targetStatus: 'Approved',
            ...buildValidApprovalFields(),
          }
        )
      ).rejects.toMatchObject({
        code: 'SELF_APPROVAL_FORBIDDEN',
      });

      const stored = await runner.getAssetRecord('asset_tx_admin_race_mem');
      expect(stored?.revision).toBe(1);
      expect(stored?.asset.rights.status).toBe('PendingReview');
      expect(
        await runner.listAuditEventsForAsset('asset_tx_admin_race_mem')
      ).toHaveLength(0);
    });

    it('revalidates admins/{uid} inside Firestore transactions on retry: blocks concurrent deactivation/demotion and succeeds on valid retry', async () => {
      const mockDb = new TransactionalMockFirestoreDb();
      const firestoreRunner = new FirestoreEditorialImageRightsReviewRunner(
        mockDb
      );
      const adminRepo = new InMemoryAdminRepository();

      const ownerAdmin: AdminUser = {
        id: 'owner_fs_race',
        name: 'Owner FS',
        email: 'owner_fs@promise.org',
        role: AdminRole.Owner,
        isActive: true,
      };
      const reviewerAdmin: AdminUser = {
        id: 'reviewer_fs_race',
        name: 'Reviewer FS',
        email: 'rev_fs@promise.org',
        role: AdminRole.RightsReviewer,
        isActive: true,
      };

      const syncAdmin = async (user: AdminUser) => {
        await adminRepo.saveAdmin(user);
        mockDb.seedDocument(EDITORIAL_IMAGE_ADMINS_COLLECTION, user.id, user);
      };

      await syncAdmin(ownerAdmin);
      await syncAdmin(reviewerAdmin);

      let clockIso = '2026-10-21T14:00:00.000Z';
      const service = new EditorialImageRightsReviewService({
        adminRepository: adminRepo,
        transactionRunner: firestoreRunner,
        clock: () => clockIso,
      });

      const selfOwnedAsset = createPendingCanonicalAsset({
        assetId: 'asset_fs_self_owner',
        createdByUid: ownerAdmin.id,
      });
      mockDb.seedDocument(
        EDITORIAL_IMAGE_ASSET_COLLECTION,
        selfOwnedAsset.assetId,
        serializeEnvelopeForPersistence({
          assetId: selfOwnedAsset.assetId,
          revision: INITIAL_EDITORIAL_IMAGE_ASSET_REVISION,
          asset: selfOwnedAsset,
        })
      );
      mockDb.seedDocument(
        EDITORIAL_IMAGE_RIGHTS_EVIDENCE_COLLECTION,
        'ev_fs_race_1',
        serializeEvidenceRecordForPersistence({
          evidenceId: 'ev_fs_race_1',
          assetId: selfOwnedAsset.assetId,
          status: 'Active',
          sourceKind: 'SignedLicenseAgreement',
          sourceReference: 'FS-RACE-001',
          summary: 'Registered evidence for asset_fs_self_owner.',
          recordedByUid: reviewerAdmin.id,
          recordedAtIso: '2026-10-21T13:30:00.000Z',
        })
      );

      // 1. Concurrent Owner -> RightsReviewer demotion between transaction.get and commit during self-approval:
      // Attempt 1 sees read-set conflict on admins/owner_fs_race, retries Attempt 2, and fails closed with SELF_APPROVAL_FORBIDDEN!
      mockDb.onBeforeCommitAttempt = async (attempt) => {
        if (attempt === 1) {
          await syncAdmin({
            ...ownerAdmin,
            role: AdminRole.RightsReviewer,
          });
        }
      };

      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: ownerAdmin.id } },
          {
            assetId: 'asset_fs_self_owner',
            expectedRevision: 1,
            targetStatus: 'Approved',
            ...buildValidApprovalFields({
              evidenceRefs: ['ev_fs_race_1'],
            }),
          }
        )
      ).rejects.toMatchObject({
        code: 'SELF_APPROVAL_FORBIDDEN',
      });
      expect(mockDb.lastTransactionAttemptCount).toBe(2);

      // 2. Concurrent admin deactivation between transaction.get and commit:
      // Attempt 1 sees read-set conflict on admins/reviewer_fs_race, retries Attempt 2, and fails closed with PERMISSION_DENIED!
      mockDb.onBeforeCommitAttempt = async (attempt) => {
        if (attempt === 1) {
          await syncAdmin({
            ...reviewerAdmin,
            isActive: false,
          });
        }
      };

      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: reviewerAdmin.id } },
          {
            assetId: 'asset_fs_self_owner',
            expectedRevision: 1,
            targetStatus: 'Approved',
            ...buildValidApprovalFields({
              evidenceRefs: ['ev_fs_race_1'],
            }),
          }
        )
      ).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });
      expect(mockDb.lastTransactionAttemptCount).toBe(2);

      // 3. One transient retry that succeeds:
      // Restore reviewerAdmin to active, and on Attempt 1 update reviewerAdmin's display name (still active RightsReviewer).
      // Attempt 1 detects read-set conflict, retries Attempt 2, and commits with the updated in-transaction actorName!
      await syncAdmin(reviewerAdmin);
      mockDb.onBeforeCommitAttempt = async (attempt) => {
        if (attempt === 1) {
          await syncAdmin({
            ...reviewerAdmin,
            name: 'Reviewer FS (Updated In-Transaction)',
          });
        }
      };

      const retrySuccess = await service.transitionEditorialImageRights(
        { auth: { uid: reviewerAdmin.id } },
        {
          assetId: 'asset_fs_self_owner',
          expectedRevision: 1,
          targetStatus: 'Approved',
          ...buildValidApprovalFields({
            evidenceRefs: ['ev_fs_race_1'],
          }),
        }
      );
      mockDb.onBeforeCommitAttempt = null;

      expect(mockDb.lastTransactionAttemptCount).toBe(2);
      expect(retrySuccess.record.revision).toBe(2);
      expect(retrySuccess.record.asset.rights.status).toBe('Approved');
      expect(retrySuccess.auditEvent.actorName).toBe(
        'Reviewer FS (Updated In-Transaction)'
      );
    });

    it('rolls back cleanly on asset write failure, review-request creation failure, and duplicate audit event ID collision', async () => {
      const { runner, service, seedActiveEvidence, setClock, users } =
        await setupFixture('2026-10-21T15:00:00.000Z');
      const asset = createPendingCanonicalAsset({
        assetId: 'asset_fault_matrix',
      });
      await runner.seedInitialPendingAsset(asset);
      await seedActiveEvidence(
        'asset_fault_matrix',
        'ev_fm_1',
        '2026-10-21T08:00:00.000Z'
      );
      await seedActiveEvidence(
        'asset_fault_matrix',
        'ev_fm_2',
        '2026-10-21T15:05:00.000Z'
      );

      // 1. Asset write failure in memory leaves zero audit events and asset at rev 1
      runner.injectFaultForNextTransaction({ failOnAssetWrite: true });
      await expect(
        service.transitionEditorialImageRights(
          { auth: { uid: users.reviewerOne.id } },
          {
            assetId: 'asset_fault_matrix',
            expectedRevision: 1,
            targetStatus: 'Rejected',
            reviewReason: 'Should roll back on asset write failure.',
            evidenceRefs: ['ev_fm_1'],
          }
        )
      ).rejects.toMatchObject({
        code: 'PERSISTENCE_FAILURE',
      });

      expect((await runner.getAssetRecord('asset_fault_matrix'))?.revision).toBe(
        1
      );
      expect(
        await runner.listAuditEventsForAsset('asset_fault_matrix')
      ).toHaveLength(0);

      // Transition to Rejected cleanly (rev 1 -> 2)
      const rejectedOutcome = await service.transitionEditorialImageRights(
        { auth: { uid: users.reviewerOne.id } },
        {
          assetId: 'asset_fault_matrix',
          expectedRevision: 1,
          targetStatus: 'Rejected',
          reviewReason: 'Clean rejection.',
          evidenceRefs: ['ev_fm_1'],
        }
      );

      // 2. Review-request creation write failure rolls back request creation
      setClock('2026-10-21T15:10:00.000Z');
      runner.injectFaultForNextTransaction({ failOnRequestCreateWrite: true });
      await expect(
        service.submitRightsReviewRequest(
          { auth: { uid: users.reviewerOne.id } },
          {
            requestId: 'req_fault_create',
            assetId: 'asset_fault_matrix',
            expectedRevision: 2,
            rationale: 'Should fail on request create write.',
            submittedEvidenceRefs: ['ev_fm_2'],
          }
        )
      ).rejects.toMatchObject({
        code: 'PERSISTENCE_FAILURE',
      });
      expect(await runner.getReviewRequest('req_fault_create')).toBeNull();

      // Submit request cleanly
      const validReq = await service.submitRightsReviewRequest(
        { auth: { uid: users.reviewerOne.id } },
        {
          requestId: 'req_fault_create',
          assetId: 'asset_fault_matrix',
          expectedRevision: 2,
          rationale: 'Created cleanly on retry.',
          submittedEvidenceRefs: ['ev_fm_2'],
        }
      );
      expect(validReq.status).toBe('Pending');

      // 3. Duplicate audit event ID collision fails closed with ALREADY_EXISTS and leaves asset & request untouched
      const fixedAuditService = new EditorialImageRightsReviewService({
        adminRepository: (service as any).adminRepo,
        transactionRunner: runner,
        clock: () => '2026-10-21T15:20:00.000Z',
        idGenerator: () =>
          // Return the existing audit event ID from rev 1 -> 2
          rejectedOutcome.auditEvent.id,
      });

      await expect(
        fixedAuditService.transitionEditorialImageRights(
          { auth: { uid: users.reviewerTwo.id } },
          {
            assetId: 'asset_fault_matrix',
            expectedRevision: 2,
            targetStatus: 'Approved',
            ...buildValidApprovalFields({
              reviewRequestId: validReq.requestId,
              evidenceRefs: ['ev_fm_1', 'ev_fm_2'],
            }),
          }
        )
      ).rejects.toMatchObject({
        code: 'ALREADY_EXISTS',
      });

      expect((await runner.getAssetRecord('asset_fault_matrix'))?.revision).toBe(
        2
      );
      expect((await runner.getReviewRequest(validReq.requestId))?.status).toBe(
        'Pending'
      );
    });
  });
});

