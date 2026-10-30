import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({}),
}));

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: class HttpsError extends Error {
    public readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = 'HttpsError';
      this.code = code;
    }
  },
}));

import {
  buildEditorialImageVariantStoragePath,
  createEditorialImageAssetRecord,
  validateEditorialImageAsset,
} from '../shared/editorialImageAssetContract';
import type {
  EditorialImageAssetMetadata,
  EditorialImageAssetStatus,
  EditorialImageAssetVariant,
  EditorialImageAssetVariantKey,
  EditorialImageRightsRecord,
} from '../types/editorialImageAsset';
import type {
  RichNewsDocumentWrapper,
  RichNewsDocumentWrapperV2,
} from '../types/richNewsDocument';
import type { AdminRepository } from '../admin/adminRepository';
import { AdminPermission, AdminRole, type AdminUser } from '../types/admin';
import type { NewsItemBackend, NewsRepository } from './newsRepository';
import {
  EditorialImageAssetRepositoryError,
  type EditorialImageAssetReadResult,
  type EditorialImageAssetRepository,
  type EditorialImageAssetRepositoryRecord,
} from './editorialImageAssetRepository';
import { InMemoryEditorialImageAssetRepository } from './inMemoryEditorialImageAssetRepository';
import {
  EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE,
  NewsApplicationService,
  REQUIRED_EDITORIAL_IMAGE_VARIANT_KEYS,
  collectUniqueEditorialImageAssetIds,
  extractEditorialImageAssetIdsFromRichDocument,
  type ActorContext,
} from './newsApplicationService';
import {
  createProductionNewsApplicationService,
  executeManageNewsRequest,
} from './newsAdminHandlers';
import {
  PublicNewsRepository,
  isEditorialImageAssetEligibleForPublicArticle,
} from './publicNewsRepository';

function buildCanonicalVariantsMap(
  assetId: string,
  keys: readonly EditorialImageAssetVariantKey[] = REQUIRED_EDITORIAL_IMAGE_VARIANT_KEYS
): Record<string, EditorialImageAssetVariant> {
  const variants: Record<string, EditorialImageAssetVariant> = {};
  for (const key of keys) {
    variants[key] = {
      variantKey: key,
      storagePath: buildEditorialImageVariantStoragePath(assetId, key, 'image/webp'),
      mimeType: 'image/webp',
      width: 800,
      height: 600,
      sizeBytes: 24576,
      sha256Checksum: 'a'.repeat(64),
    };
  }
  return variants;
}

function buildPendingReviewAsset(assetId: string): EditorialImageAssetMetadata {
  return createEditorialImageAssetRecord({
    assetId,
    createdByUid: 'admin-editor-01',
    createdAtIso: '2026-03-20T10:00:00.000Z',
    updatedAtIso: '2026-03-20T10:00:00.000Z',
    origin: 'news_article',
    originalFilename: `${assetId}.webp`,
    mimeType: 'image/webp',
    originalSizeBytes: 49152,
    originalWidth: 1600,
    originalHeight: 1200,
    sha256Checksum: 'b'.repeat(64),
    variants: buildCanonicalVariantsMap(assetId),
    altAr: 'صورة ميدانية لغرس الأشجار',
    altEn: 'Field photo of planting trees',
  });
}

function buildApprovedAsset(assetId: string): EditorialImageAssetMetadata {
  const base = buildPendingReviewAsset(assetId);
  const approvedRights: EditorialImageRightsRecord = {
    status: 'Approved',
    licenseType: 'OriginalWork',
    rightsHolder: 'Promise of Planet Editorial Team',
    sourceAttributionAr: 'فريق التحرير في وعد الكوكب',
    sourceAttributionEn: 'Promise of Planet Editorial Team',
    evidenceRefs: ['evidence_ref_001'],
    usageScope: {
      scopeType: 'GeneralEditorial',
    },
    reviewedByUid: 'admin-reviewer-01',
    reviewedAtIso: '2026-03-20T11:00:00.000Z',
    reviewReason: 'Verified original field photography.',
  };

  const candidate: EditorialImageAssetMetadata = {
    ...base,
    updatedAtIso: '2026-03-20T11:00:00.000Z',
    rights: approvedRights,
  };

  const check = validateEditorialImageAsset(candidate);
  if (!check.valid) {
    throw new Error(`Invalid test approved asset fixture: ${check.errors.join('; ')}`);
  }
  return candidate;
}

function buildAssetWithState(
  assetId: string,
  options: {
    readonly status?: EditorialImageAssetStatus;
    readonly rights?: EditorialImageRightsRecord;
    readonly variantKeys?: readonly EditorialImageAssetVariantKey[];
  }
): EditorialImageAssetMetadata {
  const base = buildPendingReviewAsset(assetId);
  const candidate: EditorialImageAssetMetadata = {
    ...base,
    updatedAtIso: '2026-03-20T12:00:00.000Z',
    status: options.status ?? base.status,
    rights: options.rights ?? base.rights,
    variants: options.variantKeys
      ? buildCanonicalVariantsMap(assetId, options.variantKeys)
      : base.variants,
  };

  const check = validateEditorialImageAsset(candidate);
  if (!check.valid) {
    throw new Error(`Invalid test state asset fixture: ${check.errors.join('; ')}`);
  }
  return candidate;
}

function makeV1Doc(text: string, dir: 'rtl' | 'ltr' = 'rtl'): RichNewsDocumentWrapper {
  return {
    schemaVersion: 1,
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { dir },
          content: [{ type: 'text', text }],
        },
      ],
    },
  };
}

function makeV2TextOnlyDoc(
  text: string,
  dir: 'rtl' | 'ltr' = 'rtl'
): RichNewsDocumentWrapperV2 {
  return {
    schemaVersion: 2,
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { dir },
          content: [{ type: 'text', text }],
        },
      ],
    },
  };
}

function makeV2DocWithImages(
  assetIds: readonly string[],
  options?: {
    readonly dir?: 'rtl' | 'ltr';
    readonly leadText?: string;
    readonly width?: '25%' | '50%' | '75%' | '100%';
    readonly layout?: 'float-start' | 'float-end' | 'block-center' | 'block-full';
    readonly captionAr?: string;
    readonly captionEn?: string;
  }
): RichNewsDocumentWrapperV2 {
  const dir = options?.dir ?? 'rtl';
  const leadText =
    options?.leadText ??
    (dir === 'rtl' ? 'فقرة افتتاحية للتقرير البيئي.' : 'Opening paragraph for environmental report.');
  const width = options?.width ?? '50%';
  const layout = options?.layout ?? 'float-start';

  return {
    schemaVersion: 2,
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { dir },
          content: [{ type: 'text', text: leadText }],
        },
        ...assetIds.map((assetId, idx) => ({
          type: 'editorialImage' as const,
          attrs: {
            assetId,
            altAr: `نص بديل للصورة رقم ${idx + 1}`,
            altEn: `Alt text for image ${idx + 1}`,
            ...(options?.captionAr !== undefined
              ? { captionAr: options.captionAr }
              : { captionAr: `تعليق توضيحي ${idx + 1}` }),
            ...(options?.captionEn !== undefined
              ? { captionEn: options.captionEn }
              : { captionEn: `Caption ${idx + 1}` }),
            width,
            layout,
          },
        })),
      ],
    },
  };
}

class InMemoryTestNewsRepository implements NewsRepository {
  private readonly store = new Map<string, NewsItemBackend>();
  public saveCalls = 0;

  async getById(id: string): Promise<NewsItemBackend | null> {
    const item = this.store.get(id);
    return item ? JSON.parse(JSON.stringify(item)) : null;
  }

  async save(item: NewsItemBackend): Promise<void> {
    this.saveCalls += 1;
    this.store.set(item.id, JSON.parse(JSON.stringify(item)));
  }

  async listAll(): Promise<NewsItemBackend[]> {
    return Array.from(this.store.values()).map((item) => JSON.parse(JSON.stringify(item)));
  }

  async listPublished(_language?: 'ar' | 'en'): Promise<NewsItemBackend[]> {
    return Array.from(this.store.values())
      .filter((item) => item.workflowState === 'Published')
      .map((item) => JSON.parse(JSON.stringify(item)));
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}

class InMemoryTestAdminRepository implements AdminRepository {
  private readonly admins = new Map<string, AdminUser>();

  constructor(users: readonly AdminUser[]) {
    for (const user of users) {
      this.admins.set(user.id, { ...user });
    }
  }

  async getAdminByUid(uid: string): Promise<AdminUser | null> {
    const found = this.admins.get(uid);
    return found ? { ...found } : null;
  }

  async listAdmins(): Promise<AdminUser[]> {
    return Array.from(this.admins.values()).map((u) => ({ ...u }));
  }

  async saveAdmin(admin: AdminUser): Promise<AdminUser> {
    this.admins.set(admin.id, { ...admin });
    return { ...admin };
  }

  async deactivateAdmin(uid: string): Promise<void> {
    const found = this.admins.get(uid);
    if (found) {
      found.isActive = false;
    }
  }

  async verifyAdminAccess(uid: string, _permission: AdminPermission): Promise<boolean> {
    const found = this.admins.get(uid);
    return Boolean(found && found.isActive);
  }
}

describe('IMG-F3-09/D2-D0A — Server-Authoritative Inline Editorial Image Asset Reference Gate', () => {
  let newsRepo: InMemoryTestNewsRepository;
  let assetRepo: InMemoryEditorialImageAssetRepository;
  let service: NewsApplicationService;

  const editorActor: ActorContext = {
    uid: 'admin-editor-01',
    name: 'سارة أحمد',
    role: AdminRole.ContentEditor,
  };

  beforeEach(() => {
    newsRepo = new InMemoryTestNewsRepository();
    assetRepo = new InMemoryEditorialImageAssetRepository();
    service = new NewsApplicationService(newsRepo, assetRepo);
  });

  describe('1. V1 and V2 Text-Only Draft Compatibility', () => {
    it('creates and updates V1 text-only drafts without invoking assetRepo or requiring assetRepo', async () => {
      const serviceWithoutAssetRepo = new NewsApplicationService(newsRepo);
      const getByIdSpy = vi.spyOn(assetRepo, 'getById');

      const created = await serviceWithoutAssetRepo.createDraft(
        {
          titleAr: 'خبر نصي بالنسخة الأولى',
          summaryAr: 'ملخص الخبر',
          bodyAr: '',
          richBodyAr: makeV1Doc('محتوى نصي بالنسخة الأولى.'),
          category: 'Climate',
          featuredImage: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957',
        },
        editorActor
      );

      expect(created.workflowState).toBe('Draft');
      expect(created.bodyAr).toBe('محتوى نصي بالنسخة الأولى.');
      expect(created.featuredImage).toBe(
        'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957'
      );

      const updated = await serviceWithoutAssetRepo.updateDraft(
        created.id,
        {
          richBodyAr: makeV1Doc('محتوى نصي محدث بالنسخة الأولى.'),
        },
        editorActor
      );

      expect(updated.bodyAr).toBe('محتوى نصي محدث بالنسخة الأولى.');
      expect(getByIdSpy).not.toHaveBeenCalled();
    });

    it('creates and updates V2 text-only drafts without invoking assetRepo or requiring assetRepo', async () => {
      const serviceWithoutAssetRepo = new NewsApplicationService(newsRepo);
      const getByIdSpy = vi.spyOn(assetRepo, 'getById');

      const created = await serviceWithoutAssetRepo.createDraft(
        {
          titleAr: 'خبر نصي بالنسخة الثانية بدون صور',
          summaryAr: 'ملخص الخبر',
          bodyAr: '',
          richBodyAr: makeV2TextOnlyDoc('فقرة بالنسخة الثانية خالية من الصور.'),
          richBodyEn: makeV2TextOnlyDoc('V2 paragraph without inline images.', 'ltr'),
          category: 'Water',
        },
        editorActor
      );

      expect(created.richBodyAr.schemaVersion).toBe(2);
      expect(created.bodyAr).toBe('فقرة بالنسخة الثانية خالية من الصور.');
      expect(created.bodyEn).toBe('V2 paragraph without inline images.');

      const updated = await serviceWithoutAssetRepo.updateDraft(
        created.id,
        {
          richBodyAr: makeV2TextOnlyDoc('فقرة محدثة بالنسخة الثانية خالية من الصور.'),
        },
        editorActor
      );

      expect(updated.bodyAr).toBe('فقرة محدثة بالنسخة الثانية خالية من الصور.');
      expect(getByIdSpy).not.toHaveBeenCalled();
    });
  });

  describe('2. Canonical Asset Eligibility on New V2 Image References', () => {
    it('succeeds when newly introduced V2 editorialImage asset is active with PendingReview rights and preserves all V2 attributes', async () => {
      const assetId = 'asset_pending_review_valid_001';
      await assetRepo.createIfAbsent(buildPendingReviewAsset(assetId));

      const docAr = makeV2DocWithImages([assetId], {
        dir: 'rtl',
        width: '75%',
        layout: 'float-end',
        captionAr: 'تسمية توضيحية عربية محفوظة',
        captionEn: 'Preserved English caption',
      });

      const created = await service.createDraft(
        {
          titleAr: 'مسودة بصورة قيد مراجعة الحقوق',
          summaryAr: 'ملخص',
          bodyAr: '',
          richBodyAr: docAr,
          category: 'Biodiversity',
        },
        editorActor
      );

      expect(created.richBodyAr).toEqual(docAr);
      expect(newsRepo.saveCalls).toBe(1);

      // Verify the asset's rights status in repository remains PendingReview (not silently approved)
      const assetCheck = await assetRepo.getById(assetId);
      expect(assetCheck.ok && assetCheck.asset.rights.status).toBe('PendingReview');
    });

    it('succeeds when newly introduced V2 editorialImage asset is active with Approved rights', async () => {
      const assetId = 'asset_approved_valid_002';
      const approvedAsset = buildApprovedAsset(assetId);
      // Seed via createIfAbsent then corrupt/replace in-memory envelope or seed via custom repository wrapper
      await assetRepo.createIfAbsent(buildPendingReviewAsset(assetId));
      assetRepo.corruptStoredRecordForTesting(assetId, {
        assetId,
        revision: 2,
        asset: approvedAsset,
      });

      const docAr = makeV2DocWithImages([assetId], {
        width: '100%',
        layout: 'block-full',
      });

      const created = await service.createDraft(
        {
          titleAr: 'مسودة بصورة معتمدة الحقوق',
          summaryAr: 'ملخص',
          bodyAr: '',
          richBodyAr: docAr,
          category: 'Energy',
        },
        editorActor
      );

      expect(created.richBodyAr).toEqual(docAr);
      expect(newsRepo.saveCalls).toBe(1);
    });

    it('fails closed with UNVERIFIED_EDITORIAL_IMAGE_ASSET_NOT_FOUND when assetId does not exist and performs zero writes', async () => {
      const docAr = makeV2DocWithImages(['asset_nonexistent_00000001']);

      await expect(
        service.createDraft(
          {
            titleAr: 'مسودة بصورة غير موجودة',
            summaryAr: 'ملخص',
            bodyAr: '',
            richBodyAr: docAr,
            category: 'Climate',
          },
          editorActor
        )
      ).rejects.toThrow(/UNVERIFIED_EDITORIAL_IMAGE_ASSET_NOT_FOUND.*asset_nonexistent_00000001/);

      expect(newsRepo.saveCalls).toBe(0);
      expect(await newsRepo.listAll()).toHaveLength(0);
    });

    it('fails closed with INELIGIBLE_EDITORIAL_IMAGE_ASSET_STATUS when asset status is archived or deleted and performs zero writes', async () => {
      const archivedId = 'asset_archived_status_001';
      const deletedId = 'asset_deleted_status_002';

      assetRepo.corruptStoredRecordForTesting(archivedId, {
        assetId: archivedId,
        revision: 2,
        asset: buildAssetWithState(archivedId, { status: 'archived' }),
      });
      assetRepo.corruptStoredRecordForTesting(deletedId, {
        assetId: deletedId,
        revision: 2,
        asset: buildAssetWithState(deletedId, { status: 'deleted' }),
      });

      await expect(
        service.createDraft(
          {
            titleAr: 'مسودة بصورة مؤرشفة',
            summaryAr: 'ملخص',
            bodyAr: '',
            richBodyAr: makeV2DocWithImages([archivedId]),
            category: 'Climate',
          },
          editorActor
        )
      ).rejects.toThrow(/INELIGIBLE_EDITORIAL_IMAGE_ASSET_STATUS.*archived/);

      await expect(
        service.createDraft(
          {
            titleAr: 'مسودة بصورة محذوفة',
            summaryAr: 'ملخص',
            bodyAr: '',
            richBodyAr: makeV2DocWithImages([deletedId]),
            category: 'Climate',
          },
          editorActor
        )
      ).rejects.toThrow(/INELIGIBLE_EDITORIAL_IMAGE_ASSET_STATUS.*deleted/);

      expect(newsRepo.saveCalls).toBe(0);
    });

    it('fails closed with INELIGIBLE_EDITORIAL_IMAGE_ASSET_RIGHTS when asset rights status is Rejected or Revoked and performs zero writes', async () => {
      const rejectedId = 'asset_rights_rejected_001';
      const revokedId = 'asset_rights_revoked_002';

      assetRepo.corruptStoredRecordForTesting(rejectedId, {
        assetId: rejectedId,
        revision: 2,
        asset: buildAssetWithState(rejectedId, {
          rights: {
            status: 'Rejected',
            reviewedByUid: 'admin-reviewer-01',
            reviewedAtIso: '2026-03-20T11:30:00.000Z',
            reviewReason: 'Unverified copyright source.',
          },
        }),
      });

      assetRepo.corruptStoredRecordForTesting(revokedId, {
        assetId: revokedId,
        revision: 3,
        asset: buildAssetWithState(revokedId, {
          rights: {
            status: 'Revoked',
            reviewedByUid: 'admin-reviewer-01',
            reviewedAtIso: '2026-03-20T11:45:00.000Z',
            reviewReason: 'License revoked by photographer.',
          },
        }),
      });

      await expect(
        service.createDraft(
          {
            titleAr: 'مسودة بصورة مرفوضة الحقوق',
            summaryAr: 'ملخص',
            bodyAr: '',
            richBodyAr: makeV2DocWithImages([rejectedId]),
            category: 'Climate',
          },
          editorActor
        )
      ).rejects.toThrow(/INELIGIBLE_EDITORIAL_IMAGE_ASSET_RIGHTS.*Rejected/);

      await expect(
        service.createDraft(
          {
            titleAr: 'مسودة بصورة مسحوبة الحقوق',
            summaryAr: 'ملخص',
            bodyAr: '',
            richBodyAr: makeV2DocWithImages([revokedId]),
            category: 'Climate',
          },
          editorActor
        )
      ).rejects.toThrow(/INELIGIBLE_EDITORIAL_IMAGE_ASSET_RIGHTS.*Revoked/);

      expect(newsRepo.saveCalls).toBe(0);
    });

    it('fails closed with INELIGIBLE_EDITORIAL_IMAGE_ASSET_VARIANTS when any required canonical variant is missing', async () => {
      const incompleteVariantAssetId = 'asset_missing_inline_variant_001';
      // Build an asset that has only 4 of the 5 required variants (missing article_inline)
      assetRepo.corruptStoredRecordForTesting(incompleteVariantAssetId, {
        assetId: incompleteVariantAssetId,
        revision: 1,
        asset: buildAssetWithState(incompleteVariantAssetId, {
          variantKeys: ['thumbnail', 'card', 'article_cover', 'original_processed'],
        }),
      });

      await expect(
        service.createDraft(
          {
            titleAr: 'مسودة بصورة ناقصة النسخ',
            summaryAr: 'ملخص',
            bodyAr: '',
            richBodyAr: makeV2DocWithImages([incompleteVariantAssetId]),
            category: 'Climate',
          },
          editorActor
        )
      ).rejects.toThrow(/INELIGIBLE_EDITORIAL_IMAGE_ASSET_VARIANTS.*article_inline/);

      expect(newsRepo.saveCalls).toBe(0);
    });

    it('fails closed with INVALID_EDITORIAL_IMAGE_ASSET_RECORD when repository record is corrupted', async () => {
      const corruptId = 'asset_corrupted_envelope_001';
      assetRepo.corruptStoredRecordForTesting(corruptId, {
        assetId: corruptId,
        revision: 1,
        asset: {
          assetId: corruptId,
          status: 'active',
          // missing required metadata fields, checksums, variants, etc.
        },
      });

      await expect(
        service.createDraft(
          {
            titleAr: 'مسودة بسجل صورة تالف',
            summaryAr: 'ملخص',
            bodyAr: '',
            richBodyAr: makeV2DocWithImages([corruptId]),
            category: 'Climate',
          },
          editorActor
        )
      ).rejects.toThrow(/INVALID_EDITORIAL_IMAGE_ASSET_RECORD/);

      expect(newsRepo.saveCalls).toBe(0);
    });

    it('fails closed with EDITORIAL_IMAGE_ASSET_REPOSITORY_ERROR when repository access fails', async () => {
      const validId = 'asset_repo_failure_001';
      await assetRepo.createIfAbsent(buildPendingReviewAsset(validId));
      assetRepo.failNextOperationForTesting('Simulated Firestore read timeout');

      await expect(
        service.createDraft(
          {
            titleAr: 'مسودة مع فشل قراءة المستودع',
            summaryAr: 'ملخص',
            bodyAr: '',
            richBodyAr: makeV2DocWithImages([validId]),
            category: 'Climate',
          },
          editorActor
        )
      ).rejects.toThrow(/EDITORIAL_IMAGE_ASSET_REPOSITORY_ERROR.*Simulated Firestore read timeout/);

      expect(newsRepo.saveCalls).toBe(0);
    });

    it('fails closed with UNVERIFIED_EDITORIAL_IMAGE_ASSET_REPO_MISSING when assetRepo dependency is absent and new images are introduced', async () => {
      const serviceWithoutAssetRepo = new NewsApplicationService(newsRepo);

      await expect(
        serviceWithoutAssetRepo.createDraft(
          {
            titleAr: 'مسودة بصورة بدون مستودع تحقق',
            summaryAr: 'ملخص',
            bodyAr: '',
            richBodyAr: makeV2DocWithImages(['asset_unverified_without_repo_01']),
            category: 'Climate',
          },
          editorActor
        )
      ).rejects.toThrow(/UNVERIFIED_EDITORIAL_IMAGE_ASSET_REPO_MISSING.*asset_unverified_without_repo_01/);

      expect(newsRepo.saveCalls).toBe(0);
    });

    it('deduplicates a shared assetId across richBodyAr and richBodyEn so getById is called exactly once', async () => {
      const sharedId = 'asset_shared_ar_en_001';
      await assetRepo.createIfAbsent(buildPendingReviewAsset(sharedId));
      const getByIdSpy = vi.spyOn(assetRepo, 'getById');

      const docAr = makeV2DocWithImages([sharedId, sharedId], { dir: 'rtl' });
      const docEn = makeV2DocWithImages([sharedId], { dir: 'ltr' });

      expect(extractEditorialImageAssetIdsFromRichDocument(docAr)).toEqual([sharedId]);
      expect(collectUniqueEditorialImageAssetIds(docAr, docEn)).toEqual([sharedId]);

      const created = await service.createDraft(
        {
          titleAr: 'مسودة ثنائية اللغة تشترك في نفس الصورة',
          titleEn: 'Bilingual draft sharing the same image',
          summaryAr: 'ملخص',
          summaryEn: 'Summary',
          bodyAr: '',
          bodyEn: '',
          richBodyAr: docAr,
          richBodyEn: docEn,
          category: 'Climate',
        },
        editorActor
      );

      expect(created.id).toMatch(/^news-/);
      expect(getByIdSpy).toHaveBeenCalledTimes(1);
      expect(getByIdSpy).toHaveBeenCalledWith(sharedId);
    });
  });

  describe('3. Differential Baseline Verification on updateDraft', () => {
    it('allows updateDraft to preserve already-persisted image references without re-verification even if the asset later became archived or Revoked', async () => {
      const existingId = 'asset_initially_valid_001';
      await assetRepo.createIfAbsent(buildPendingReviewAsset(existingId));

      const created = await service.createDraft(
        {
          titleAr: 'مسودة أولية بصورة صالحة',
          summaryAr: 'ملخص',
          bodyAr: '',
          richBodyAr: makeV2DocWithImages([existingId], { width: '50%', layout: 'float-start' }),
          category: 'Climate',
        },
        editorActor
      );

      // Simulate asset later becoming archived and Revoked in the repository
      assetRepo.corruptStoredRecordForTesting(existingId, {
        assetId: existingId,
        revision: 2,
        asset: buildAssetWithState(existingId, {
          status: 'archived',
          rights: {
            status: 'Revoked',
            reviewedByUid: 'admin-reviewer-01',
            reviewedAtIso: '2026-03-20T11:30:00.000Z',
            reviewReason: 'Archived after initial draft creation.',
          },
        }),
      });

      const getByIdSpy = vi.spyOn(assetRepo, 'getById');

      // Updating text, captions, width, or layout while keeping the same persisted assetId must succeed without re-verifying
      const updatedDocAr = makeV2DocWithImages([existingId], {
        leadText: 'فقرة معدلة مع الاحتفاظ بنفس الصورة المحفوظة مسبقاً.',
        width: '100%',
        layout: 'block-full',
        captionAr: 'تعليق محدث',
      });

      const updated = await service.updateDraft(
        created.id,
        {
          titleAr: 'عنوان محدث',
          richBodyAr: updatedDocAr,
        },
        editorActor
      );

      expect(updated.titleAr).toBe('عنوان محدث');
      expect(updated.richBodyAr).toEqual(updatedDocAr);
      expect(getByIdSpy).not.toHaveBeenCalled();
    });

    it('verifies only the newly added image when updateDraft preserves an existing image and adds a new verified image', async () => {
      const firstId = 'asset_existing_persisted_001';
      const secondId = 'asset_newly_added_valid_002';
      await assetRepo.createIfAbsent(buildPendingReviewAsset(firstId));
      await assetRepo.createIfAbsent(buildPendingReviewAsset(secondId));

      const created = await service.createDraft(
        {
          titleAr: 'مسودة بصورة واحدة',
          summaryAr: 'ملخص',
          bodyAr: '',
          richBodyAr: makeV2DocWithImages([firstId]),
          category: 'Climate',
        },
        editorActor
      );

      const getByIdSpy = vi.spyOn(assetRepo, 'getById');

      const updated = await service.updateDraft(
        created.id,
        {
          richBodyAr: makeV2DocWithImages([firstId, secondId]),
        },
        editorActor
      );

      expect(extractEditorialImageAssetIdsFromRichDocument(updated.richBodyAr)).toEqual([
        firstId,
        secondId,
      ]);
      expect(getByIdSpy).toHaveBeenCalledTimes(1);
      expect(getByIdSpy).toHaveBeenCalledWith(secondId);
    });

    it('fails closed and performs no write when updateDraft preserves an existing image and adds an unverified image', async () => {
      const firstId = 'asset_existing_persisted_010';
      await assetRepo.createIfAbsent(buildPendingReviewAsset(firstId));

      const created = await service.createDraft(
        {
          titleAr: 'مسودة بصورة محفوظة',
          summaryAr: 'ملخص',
          bodyAr: '',
          richBodyAr: makeV2DocWithImages([firstId]),
          category: 'Climate',
        },
        editorActor
      );

      const saveCallsAfterCreate = newsRepo.saveCalls;

      await expect(
        service.updateDraft(
          created.id,
          {
            titleAr: 'محاولة إضافة صورة غير موثقة',
            richBodyAr: makeV2DocWithImages([firstId, 'asset_unverified_intruder_999']),
          },
          editorActor
        )
      ).rejects.toThrow(/UNVERIFIED_EDITORIAL_IMAGE_ASSET_NOT_FOUND.*asset_unverified_intruder_999/);

      expect(newsRepo.saveCalls).toBe(saveCallsAfterCreate);
      const persistedAfterFailure = await newsRepo.getById(created.id);
      expect(persistedAfterFailure?.titleAr).toBe('مسودة بصورة محفوظة');
      expect(
        extractEditorialImageAssetIdsFromRichDocument(persistedAfterFailure?.richBodyAr)
      ).toEqual([firstId]);
    });

    it('evaluates partial updates across languages using the effective persisted documents and re-verifies an image if it was removed and later re-introduced', async () => {
      const arImageId = 'asset_bilingual_shared_001';
      const newEnImageId = 'asset_en_new_verified_002';
      await assetRepo.createIfAbsent(buildPendingReviewAsset(arImageId));
      await assetRepo.createIfAbsent(buildPendingReviewAsset(newEnImageId));

      const created = await service.createDraft(
        {
          titleAr: 'مسودة عربية بصورة',
          summaryAr: 'ملخص',
          bodyAr: '',
          richBodyAr: makeV2DocWithImages([arImageId], { dir: 'rtl' }),
          category: 'Water',
        },
        editorActor
      );

      const getByIdSpy = vi.spyOn(assetRepo, 'getById');

      // Partial update of richBodyEn only: reusing arImageId (already persisted in richBodyAr) + adding newEnImageId
      const updatedWithEn = await service.updateDraft(
        created.id,
        {
          richBodyEn: makeV2DocWithImages([arImageId, newEnImageId], { dir: 'ltr' }),
        },
        editorActor
      );

      expect(getByIdSpy).toHaveBeenCalledTimes(1);
      expect(getByIdSpy).toHaveBeenCalledWith(newEnImageId);

      // Now remove newEnImageId from richBodyEn so it disappears from the persisted baseline
      await service.updateDraft(
        updatedWithEn.id,
        {
          richBodyEn: makeV2TextOnlyDoc('English body without images.', 'ltr'),
        },
        editorActor
      );

      // Suppose newEnImageId is now archived in the asset repository
      assetRepo.corruptStoredRecordForTesting(newEnImageId, {
        assetId: newEnImageId,
        revision: 2,
        asset: buildAssetWithState(newEnImageId, { status: 'archived' }),
      });

      // Re-introducing newEnImageId after it was removed from the persisted baseline MUST be treated as a NEW reference and fail closed!
      await expect(
        service.updateDraft(
          updatedWithEn.id,
          {
            richBodyEn: makeV2DocWithImages([newEnImageId], { dir: 'ltr' }),
          },
          editorActor
        )
      ).rejects.toThrow(/INELIGIBLE_EDITORIAL_IMAGE_ASSET_STATUS.*asset_en_new_verified_002/);
    });
  });

  describe('4. Handler Authentication, Permissions, and Production DI Wiring', () => {
    const activeEditor: AdminUser = {
      id: 'admin-editor-01',
      name: 'سارة أحمد',
      email: 'editor@promiseofplanet.org',
      role: AdminRole.ContentEditor,
      isActive: true,
    };

    const viewerOnly: AdminUser = {
      id: 'admin-viewer-01',
      name: 'مراقب',
      email: 'viewer@promiseofplanet.org',
      role: AdminRole.Viewer,
      isActive: true,
    };

    it('preserves authentication and permission checks on executeManageNewsRequest and enforces the asset reference gate on saveDraft', async () => {
      const adminRepo = new InMemoryTestAdminRepository([activeEditor, viewerOnly]);
      const validAssetId = 'asset_handler_verified_001';
      await assetRepo.createIfAbsent(buildPendingReviewAsset(validAssetId));

      // 1. Unauthenticated request rejected
      await expect(
        executeManageNewsRequest(
          {
            data: {
              action: 'saveDraft',
              item: {
                titleAr: 'غير مصرح',
                summaryAr: 'ملخص',
                bodyAr: 'نص',
                category: 'Climate',
              },
            },
          },
          adminRepo,
          service
        )
      ).rejects.toThrow(/UNAUTHENTICATED/);

      // 2. Viewer lacking Create permission rejected before service call
      await expect(
        executeManageNewsRequest(
          {
            auth: { uid: viewerOnly.id },
            data: {
              action: 'saveDraft',
              item: {
                titleAr: 'بدون صلاحية إنشاء',
                summaryAr: 'ملخص',
                bodyAr: 'نص',
                category: 'Climate',
              },
            },
          },
          adminRepo,
          service
        )
      ).rejects.toThrow(/PERMISSION_DENIED/);

      // 3. Authorized editor saving unverified V2 image fails closed through handler
      await expect(
        executeManageNewsRequest(
          {
            auth: { uid: activeEditor.id },
            data: {
              action: 'saveDraft',
              item: {
                titleAr: 'محاولة حفظ صورة غير موثقة عبر المعالج',
                summaryAr: 'ملخص',
                bodyAr: '',
                richBodyAr: makeV2DocWithImages(['asset_handler_missing_999']),
                category: 'Climate',
              },
            },
          },
          adminRepo,
          service
        )
      ).rejects.toThrow(/UNVERIFIED_EDITORIAL_IMAGE_ASSET_NOT_FOUND/);

      expect(newsRepo.saveCalls).toBe(0);

      // 4. Authorized editor saving verified V2 image succeeds through handler
      const savedResponse = await executeManageNewsRequest(
        {
          auth: { uid: activeEditor.id },
          data: {
            action: 'saveDraft',
            item: {
              titleAr: 'حفظ صورة موثقة عبر المعالج',
              summaryAr: 'ملخص',
              bodyAr: '',
              richBodyAr: makeV2DocWithImages([validAssetId]),
              category: 'Climate',
            },
          },
        },
        adminRepo,
        service
      );

      expect(savedResponse.item.id).toMatch(/^news-/);
      expect(
        extractEditorialImageAssetIdsFromRichDocument(savedResponse.item.richBodyAr)
      ).toEqual([validAssetId]);
    });

    it('wires createProductionNewsApplicationService with FirestoreEditorialImageAssetRepository so default handler service is never missing assetRepo', async () => {
      const prodService = createProductionNewsApplicationService();
      expect(prodService).toBeInstanceOf(NewsApplicationService);

      // Because getFirestore() is mocked as `{}` in unit tests, attempting to verify a new asset via the default production service
      // invokes FirestoreEditorialImageAssetRepository.getById (proving assetRepo is wired, not missing) and fails closed on persistence access.
      await expect(
        prodService.createDraft(
          {
            titleAr: 'اختبار ربط المستودع الإنتاجي',
            summaryAr: 'ملخص',
            bodyAr: '',
            richBodyAr: makeV2DocWithImages(['asset_prod_wiring_check_01']),
            category: 'Climate',
          },
          editorActor
        )
      ).rejects.toThrow(/EDITORIAL_IMAGE_ASSET_REPOSITORY_ERROR/);
    });

    it('handles custom EditorialImageAssetRepository returning malformed FOUND envelope by failing closed with INVALID_EDITORIAL_IMAGE_ASSET_RECORD', async () => {
      const brokenRepo: EditorialImageAssetRepository = {
        async getById(assetId: string): Promise<EditorialImageAssetReadResult> {
          return {
            ok: true,
            status: 'FOUND',
            assetId,
            revision: 1,
            record: null as unknown as EditorialImageAssetRepositoryRecord,
            asset: {
              assetId: 'mismatched_asset_id',
              status: 'active',
            } as unknown as EditorialImageAssetMetadata,
          } as unknown as EditorialImageAssetReadResult;
        },
        async createIfAbsent(): Promise<EditorialImageAssetRepositoryRecord> {
          throw new EditorialImageAssetRepositoryError('PERSISTENCE_FAILURE', 'Not used', []);
        },
        async updateEditorialMetadata(): Promise<EditorialImageAssetRepositoryRecord> {
          throw new EditorialImageAssetRepositoryError('PERSISTENCE_FAILURE', 'Not used', []);
        },
      };

      const customService = new NewsApplicationService(newsRepo, brokenRepo);

      await expect(
        customService.createDraft(
          {
            titleAr: 'اختبار مستودع يعيد مظروف غير متطابق',
            summaryAr: 'ملخص',
            bodyAr: '',
            richBodyAr: makeV2DocWithImages(['asset_expected_id_001']),
            category: 'Climate',
          },
          editorActor
        )
      ).rejects.toThrow(/INVALID_EDITORIAL_IMAGE_ASSET_RECORD/);

      expect(newsRepo.saveCalls).toBe(0);
    });
  });

  describe('5. NEWS-IMG-RIGHTS-PUBLISH-01 — Server-Authoritative Image Rights Publication Gate', () => {
    const reviewerActor: ActorContext = {
      uid: 'admin-manager-01',
      name: 'خالد المنصور',
      role: AdminRole.TrainingManager,
    };

    const publisherActor: ActorContext = {
      uid: 'admin-owner-01',
      name: 'المالك',
      role: AdminRole.Owner,
    };

    const activeOwner: AdminUser = {
      id: 'admin-owner-01',
      name: 'المالك',
      email: 'owner@promiseofplanet.org',
      role: AdminRole.Owner,
      isActive: true,
    };

    const activeManager: AdminUser = {
      id: 'admin-manager-01',
      name: 'خالد المنصور',
      email: 'manager@promiseofplanet.org',
      role: AdminRole.TrainingManager,
      isActive: true,
    };

    const activeEditor: AdminUser = {
      id: 'admin-editor-01',
      name: 'سارة أحمد',
      email: 'editor@promiseofplanet.org',
      role: AdminRole.ContentEditor,
      isActive: true,
    };

    function seedAssetInRepo(
      asset: EditorialImageAssetMetadata,
      revision = 2
    ): void {
      assetRepo.corruptStoredRecordForTesting(asset.assetId, {
        assetId: asset.assetId,
        revision,
        asset,
      });
    }

    async function transitionDraftToApproved(
      svc: NewsApplicationService,
      articleId: string
    ): Promise<NewsItemBackend> {
      await svc.transitionWorkflow(articleId, 'InReview', editorActor, 'جاهز للمراجعة');
      return svc.transitionWorkflow(articleId, 'Approved', reviewerActor, 'تمت الموافقة التحريرية');
    }

    it('Case 1: allows text-only V1 and V2 articles to transition to Published without an image repository', async () => {
      const serviceWithoutAssetRepo = new NewsApplicationService(newsRepo);
      const getByIdSpy = vi.spyOn(assetRepo, 'getById');

      const v1Created = await serviceWithoutAssetRepo.createDraft(
        {
          titleAr: 'خبر نصي بالنسخة الأولى للنشر',
          summaryAr: 'ملخص',
          bodyAr: '',
          richBodyAr: makeV1Doc('محتوى نصي بالنسخة الأولى جاهز للنشر.'),
          category: 'Climate',
        },
        editorActor
      );

      await transitionDraftToApproved(serviceWithoutAssetRepo, v1Created.id);
      const v1Published = await serviceWithoutAssetRepo.transitionWorkflow(
        v1Created.id,
        'Published',
        publisherActor,
        'نشر الخبر النصي الأول'
      );

      expect(v1Published.workflowState).toBe('Published');
      expect(v1Published.publishedAt).toBeDefined();

      const v2TextCreated = await serviceWithoutAssetRepo.createDraft(
        {
          titleAr: 'خبر نصي بالنسخة الثانية بدون صور للنشر',
          summaryAr: 'ملخص',
          bodyAr: '',
          richBodyAr: makeV2TextOnlyDoc('محتوى نصي بالنسخة الثانية بدون صور.'),
          richBodyEn: makeV2TextOnlyDoc('V2 text-only English body.', 'ltr'),
          category: 'Biodiversity',
        },
        editorActor
      );

      await transitionDraftToApproved(serviceWithoutAssetRepo, v2TextCreated.id);
      const v2Published = await serviceWithoutAssetRepo.transitionWorkflow(
        v2TextCreated.id,
        'Published',
        publisherActor,
        'نشر الخبر النصي الثاني'
      );

      expect(v2Published.workflowState).toBe('Published');
      expect(v2Published.publishedAt).toBeDefined();
      expect(getByIdSpy).not.toHaveBeenCalled();
    });

    it('Case 2: allows a valid V2 article with one approved eligible image (GeneralEditorial) to publish', async () => {
      const approvedId = 'asset_pub_approved_general_001';
      seedAssetInRepo(buildApprovedAsset(approvedId));

      const draft = await service.createDraft(
        {
          titleAr: 'خبر بيئي بصورة معتمدة الحقوق',
          summaryAr: 'ملخص',
          bodyAr: '',
          richBodyAr: makeV2DocWithImages([approvedId]),
          category: 'Climate',
        },
        editorActor
      );

      await transitionDraftToApproved(service, draft.id);
      const published = await service.transitionWorkflow(
        draft.id,
        'Published',
        publisherActor,
        'نشر بعد التحقق من حقوق الصورة'
      );

      expect(published.workflowState).toBe('Published');
      expect(published.publishedAt).toBeDefined();
      expect(extractEditorialImageAssetIdsFromRichDocument(published.richBodyAr)).toEqual([
        approvedId,
      ]);
    });

    it('Case 3: deduplicates an image referenced across both richBodyAr and richBodyEn into one logical eligibility verification during publication', async () => {
      const sharedAssetId = 'asset_pub_shared_bilingual_001';
      seedAssetInRepo(buildApprovedAsset(sharedAssetId));

      const draft = await service.createDraft(
        {
          titleAr: 'خبر ثنائي اللغة بصورة مشتركة',
          titleEn: 'Bilingual article with shared image',
          summaryAr: 'ملخص',
          summaryEn: 'Summary',
          bodyAr: '',
          bodyEn: '',
          richBodyAr: makeV2DocWithImages([sharedAssetId, sharedAssetId], { dir: 'rtl' }),
          richBodyEn: makeV2DocWithImages([sharedAssetId], { dir: 'ltr' }),
          category: 'Climate',
        },
        editorActor
      );

      await transitionDraftToApproved(service, draft.id);

      const getByIdSpy = vi.spyOn(assetRepo, 'getById');
      getByIdSpy.mockClear();

      const published = await service.transitionWorkflow(
        draft.id,
        'Published',
        publisherActor,
        'نشر ثنائي اللغة'
      );

      expect(published.workflowState).toBe('Published');
      expect(getByIdSpy).toHaveBeenCalledTimes(1);
      expect(getByIdSpy).toHaveBeenCalledWith(sharedAssetId);
    });

    it('Case 4: blocks publication when a referenced image has PendingReview rights status', async () => {
      const pendingId = 'asset_pub_pending_001';
      const pendingAsset = buildPendingReviewAsset(pendingId);
      await assetRepo.createIfAbsent(pendingAsset);

      const draft = await service.createDraft(
        {
          titleAr: 'خبر بصورة قيد مراجعة الحقوق',
          summaryAr: 'ملخص',
          bodyAr: '',
          richBodyAr: makeV2DocWithImages([pendingId]),
          category: 'Climate',
        },
        editorActor
      );

      expect(isEditorialImageAssetEligibleForPublicArticle(pendingAsset, draft.id)).toBe(false);

      await transitionDraftToApproved(service, draft.id);

      await expect(
        service.transitionWorkflow(draft.id, 'Published', publisherActor, 'محاولة نشر قبل اعتماد الحقوق')
      ).rejects.toThrow(
        new RegExp(
          `${EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE}.*\\[RIGHTS_STATUS_NOT_APPROVED\\].*${pendingId}.*PendingReview`
        )
      );
    });

    it('Case 5: blocks publication when a referenced image transitions to Rejected rights status', async () => {
      const rejectedId = 'asset_pub_rejected_001';
      await assetRepo.createIfAbsent(buildPendingReviewAsset(rejectedId));

      const draft = await service.createDraft(
        {
          titleAr: 'خبر بصورة تم رفض حقوقها لاحقاً',
          summaryAr: 'ملخص',
          bodyAr: '',
          richBodyAr: makeV2DocWithImages([rejectedId]),
          category: 'Climate',
        },
        editorActor
      );

      await transitionDraftToApproved(service, draft.id);

      const rejectedAsset = buildAssetWithState(rejectedId, {
        rights: {
          status: 'Rejected',
          reviewedByUid: 'admin-reviewer-01',
          reviewedAtIso: '2026-03-20T11:30:00.000Z',
          reviewReason: 'Insufficient copyright proof.',
        },
      });
      seedAssetInRepo(rejectedAsset);

      expect(isEditorialImageAssetEligibleForPublicArticle(rejectedAsset, draft.id)).toBe(false);

      await expect(
        service.transitionWorkflow(draft.id, 'Published', publisherActor, 'محاولة نشر صورة مرفوضة')
      ).rejects.toThrow(
        new RegExp(
          `${EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE}.*\\[RIGHTS_STATUS_NOT_APPROVED\\].*${rejectedId}.*Rejected`
        )
      );
    });

    it('Case 6: blocks publication when a referenced image has Revoked rights status', async () => {
      const revokedId = 'asset_pub_revoked_001';
      seedAssetInRepo(buildApprovedAsset(revokedId));

      const draft = await service.createDraft(
        {
          titleAr: 'خبر بصورة تم سحب ترخيصها قبل النشر',
          summaryAr: 'ملخص',
          bodyAr: '',
          richBodyAr: makeV2DocWithImages([revokedId]),
          category: 'Climate',
        },
        editorActor
      );

      await transitionDraftToApproved(service, draft.id);

      const revokedAsset = buildAssetWithState(revokedId, {
        rights: {
          status: 'Revoked',
          reviewedByUid: 'admin-reviewer-01',
          reviewedAtIso: '2026-03-20T11:45:00.000Z',
          reviewReason: 'License revoked by photographer prior to publication.',
        },
      });
      seedAssetInRepo(revokedAsset, 3);

      expect(isEditorialImageAssetEligibleForPublicArticle(revokedAsset, draft.id)).toBe(false);

      await expect(
        service.transitionWorkflow(draft.id, 'Published', publisherActor, 'محاولة نشر صورة مسحوبة الحقوق')
      ).rejects.toThrow(
        new RegExp(
          `${EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE}.*\\[RIGHTS_STATUS_NOT_APPROVED\\].*${revokedId}.*Revoked`
        )
      );
    });

    it('Case 7: blocks publication when an image is inactive (archived, deleted) even when rights are Approved', async () => {
      const inactiveStatuses: EditorialImageAssetStatus[] = [
        'archived',
        'deleted',
      ];

      for (const inactiveStatus of inactiveStatuses) {
        const assetId = `asset_pub_inactive_${inactiveStatus}_001`;
        const approvedBase = buildApprovedAsset(assetId);
        seedAssetInRepo(approvedBase);

        const draft = await service.createDraft(
          {
            titleAr: `خبر بصورة غير نشطة (${inactiveStatus})`,
            summaryAr: 'ملخص',
            bodyAr: '',
            richBodyAr: makeV2DocWithImages([assetId]),
            category: 'Climate',
          },
          editorActor
        );

        await transitionDraftToApproved(service, draft.id);

        const inactiveApprovedAsset = buildAssetWithState(assetId, {
          status: inactiveStatus,
          rights: approvedBase.rights,
        });
        seedAssetInRepo(inactiveApprovedAsset, 3);

        expect(isEditorialImageAssetEligibleForPublicArticle(inactiveApprovedAsset, draft.id)).toBe(
          false
        );

        await expect(
          service.transitionWorkflow(draft.id, 'Published', publisherActor, 'محاولة نشر أصل غير نشط')
        ).rejects.toThrow(
          new RegExp(
            `${EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE}.*\\[INACTIVE_ASSET_STATUS\\].*${assetId}.*${inactiveStatus}`
          )
        );
      }
    });

    it('Case 8: blocks publication when a referenced canonical image is missing or when assetRepo is missing on an image-bearing article', async () => {
      const missingLaterId = 'asset_pub_vanished_001';
      seedAssetInRepo(buildApprovedAsset(missingLaterId));

      const draft = await service.createDraft(
        {
          titleAr: 'خبر بصورة مفقودة عند النشر',
          summaryAr: 'ملخص',
          bodyAr: '',
          richBodyAr: makeV2DocWithImages([missingLaterId]),
          category: 'Climate',
        },
        editorActor
      );

      await transitionDraftToApproved(service, draft.id);

      // 8a. Service instantiated without assetRepo fails closed when publishing image-bearing article
      const serviceWithoutAssetRepo = new NewsApplicationService(newsRepo);
      await expect(
        serviceWithoutAssetRepo.transitionWorkflow(
          draft.id,
          'Published',
          publisherActor,
          'نشر بدون مستودع صور'
        )
      ).rejects.toThrow(
        new RegExp(
          `${EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE}.*\\[ASSET_REPO_MISSING\\].*${missingLaterId}`
        )
      );

      // 8b. Asset missing from canonical repository fails closed
      const emptyAssetRepo = new InMemoryEditorialImageAssetRepository();
      const serviceWithEmptyAssetRepo = new NewsApplicationService(newsRepo, emptyAssetRepo);
      await expect(
        serviceWithEmptyAssetRepo.transitionWorkflow(
          draft.id,
          'Published',
          publisherActor,
          'نشر مع أصل مفقود'
        )
      ).rejects.toThrow(
        new RegExp(
          `${EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE}.*\\[ASSET_NOT_FOUND\\].*${missingLaterId}`
        )
      );
    });

    it('Case 9: blocks publication when the asset repository throws a read error and redacts any internal storage paths', async () => {
      const assetId = 'asset_pub_repo_err_001';
      seedAssetInRepo(buildApprovedAsset(assetId));

      const draft = await service.createDraft(
        {
          titleAr: 'خبر يواجه خطأ مستودع عند النشر',
          summaryAr: 'ملخص',
          bodyAr: '',
          richBodyAr: makeV2DocWithImages([assetId]),
          category: 'Climate',
        },
        editorActor
      );

      await transitionDraftToApproved(service, draft.id);

      assetRepo.failNextOperationForTesting(
        'Firestore timeout reading editorial_images/asset_pub_repo_err_001/original_processed.webp in gs://secret-bucket/editorial_images/asset_pub_repo_err_001'
      );

      let caughtError: Error | undefined;
      try {
        await service.transitionWorkflow(draft.id, 'Published', publisherActor, 'محاولة نشر');
      } catch (err) {
        caughtError = err as Error;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toContain(EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE);
      expect(caughtError!.message).toContain('[ASSET_REPOSITORY_ERROR]');
      expect(caughtError!.message).not.toContain('editorial_images/asset_pub_repo_err_001');
      expect(caughtError!.message).not.toContain('gs://secret-bucket');
    });

    it('Case 10: blocks publication on malformed asset data without leaking internal storage paths', async () => {
      const corruptedId = 'asset_pub_corrupted_001';
      seedAssetInRepo(buildApprovedAsset(corruptedId));

      const draft = await service.createDraft(
        {
          titleAr: 'خبر بصورة تالفة البيانات عند النشر',
          summaryAr: 'ملخص',
          bodyAr: '',
          richBodyAr: makeV2DocWithImages([corruptedId]),
          category: 'Climate',
        },
        editorActor
      );

      await transitionDraftToApproved(service, draft.id);

      // Corrupt the stored record so InMemoryEditorialImageAssetRepository throws INVALID_ASSET containing a storagePath error
      assetRepo.corruptStoredRecordForTesting(corruptedId, {
        assetId: corruptedId,
        revision: 3,
        asset: {
          ...buildApprovedAsset(corruptedId),
          sha256Checksum: 'not-a-valid-sha256',
        },
      });

      let caughtError: Error | undefined;
      try {
        await service.transitionWorkflow(draft.id, 'Published', publisherActor, 'محاولة نشر أصل تالف');
      } catch (err) {
        caughtError = err as Error;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toContain(EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE);
      expect(caughtError!.message).toContain('[INVALID_ASSET_RECORD]');
      expect(caughtError!.message).not.toContain('editorial_images/');

      // Also verify a custom repository returning a FOUND envelope whose asset fails contract validation (e.g., Approved without reviewedByUid)
      const baseApproved = buildApprovedAsset(corruptedId);
      const invalidContractAsset = {
        ...baseApproved,
        rights: {
          ...baseApproved.rights,
          reviewedByUid: undefined,
        },
      } as unknown as EditorialImageAssetMetadata;

      const customBrokenRepo: EditorialImageAssetRepository = {
        async getById(id: string): Promise<EditorialImageAssetReadResult> {
          return {
            ok: true,
            status: 'FOUND',
            revision: 1,
            record: {
              assetId: id,
              revision: 1,
              asset: invalidContractAsset,
            },
            asset: invalidContractAsset,
          };
        },
        async createIfAbsent(): Promise<EditorialImageAssetRepositoryRecord> {
          throw new Error('Not used');
        },
        async updateEditorialMetadata(): Promise<EditorialImageAssetRepositoryRecord> {
          throw new Error('Not used');
        },
      };

      const customService = new NewsApplicationService(newsRepo, customBrokenRepo);
      await expect(
        customService.transitionWorkflow(draft.id, 'Published', publisherActor, 'نشر بعقد غير صالح')
      ).rejects.toThrow(
        new RegExp(
          `${EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE}.*\\[INVALID_ASSET_RECORD\\].*${corruptedId}`
        )
      );
    });

    it('Case 11: blocks publication when an image has Approved rights with an unrelated ArticleRestricted scope', async () => {
      const restrictedOtherId = 'asset_pub_restricted_other_001';
      const approvedRestrictedOther = buildAssetWithState(restrictedOtherId, {
        rights: {
          ...buildApprovedAsset(restrictedOtherId).rights,
          licenseType: 'ContextSpecificAssessment',
          documentedException: 'Single-article archival clearance.',
          usageScope: {
            scopeType: 'ArticleRestricted',
            articleIds: ['news-unrelated-article-999'],
          },
        },
      });
      seedAssetInRepo(approvedRestrictedOther);

      const draft = await service.createDraft(
        {
          titleAr: 'خبر يستخدم صورة مقيدة بمقال آخر',
          summaryAr: 'ملخص',
          bodyAr: '',
          richBodyAr: makeV2DocWithImages([restrictedOtherId]),
          category: 'Climate',
        },
        editorActor
      );

      expect(isEditorialImageAssetEligibleForPublicArticle(approvedRestrictedOther, draft.id)).toBe(
        false
      );

      await transitionDraftToApproved(service, draft.id);

      await expect(
        service.transitionWorkflow(
          draft.id,
          'Published',
          publisherActor,
          'محاولة نشر صورة مقيدة بمقال مختلف'
        )
      ).rejects.toThrow(
        new RegExp(
          `${EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE}.*\\[USAGE_SCOPE_NOT_AUTHORIZED\\].*${restrictedOtherId}.*${draft.id}`
        )
      );
    });

    it('Case 12: permits publication when an image has Approved rights with a valid ArticleRestricted scope containing the target article ID', async () => {
      const restrictedTargetId = 'asset_pub_restricted_target_001';
      await assetRepo.createIfAbsent(buildPendingReviewAsset(restrictedTargetId));

      const draft = await service.createDraft(
        {
          titleAr: 'خبر بصورة مقيدة بهذا المقال تحديداً',
          summaryAr: 'ملخص',
          bodyAr: '',
          richBodyAr: makeV2DocWithImages([restrictedTargetId]),
          category: 'Climate',
        },
        editorActor
      );

      const approvedForThisArticle = buildAssetWithState(restrictedTargetId, {
        rights: {
          ...buildApprovedAsset(restrictedTargetId).rights,
          licenseType: 'ContextSpecificAssessment',
          documentedException: 'Single-article archival clearance for target article.',
          usageScope: {
            scopeType: 'ArticleRestricted',
            articleIds: ['news-other-001', draft.id],
          },
        },
      });
      seedAssetInRepo(approvedForThisArticle);

      expect(isEditorialImageAssetEligibleForPublicArticle(approvedForThisArticle, draft.id)).toBe(
        true
      );

      await transitionDraftToApproved(service, draft.id);
      const published = await service.transitionWorkflow(
        draft.id,
        'Published',
        publisherActor,
        'نشر صورة مقيدة بالمقال الحالي'
      );

      expect(published.workflowState).toBe('Published');
      expect(published.publishedAt).toBeDefined();
    });

    it('Case 13: blocks publication when canonical variants are missing or invalid without leaking storage paths', async () => {
      const missingVariantAssetId = 'asset_pub_missing_variant_001';
      seedAssetInRepo(buildApprovedAsset(missingVariantAssetId));

      const draft = await service.createDraft(
        {
          titleAr: 'خبر بصورة تفقد أحد اشتقاقاتها قبل النشر',
          summaryAr: 'ملخص',
          bodyAr: '',
          richBodyAr: makeV2DocWithImages([missingVariantAssetId]),
          category: 'Climate',
        },
        editorActor
      );

      await transitionDraftToApproved(service, draft.id);

      const incompleteVariantsAsset: EditorialImageAssetMetadata = {
        ...buildApprovedAsset(missingVariantAssetId),
        variants: buildCanonicalVariantsMap(missingVariantAssetId, [
          'thumbnail',
          'card',
          'article_inline',
          'original_processed',
        ]),
      };

      const customVariantRepo: EditorialImageAssetRepository = {
        async getById(id: string): Promise<EditorialImageAssetReadResult> {
          return {
            ok: true,
            status: 'FOUND',
            revision: 2,
            record: {
              assetId: id,
              revision: 2,
              asset: incompleteVariantsAsset,
            },
            asset: incompleteVariantsAsset,
          };
        },
        async createIfAbsent(): Promise<EditorialImageAssetRepositoryRecord> {
          throw new Error('Not used');
        },
        async updateEditorialMetadata(): Promise<EditorialImageAssetRepositoryRecord> {
          throw new Error('Not used');
        },
      };

      const customService = new NewsApplicationService(newsRepo, customVariantRepo);

      let caughtError: Error | undefined;
      try {
        await customService.transitionWorkflow(
          draft.id,
          'Published',
          publisherActor,
          'محاولة نشر بدون article_cover'
        );
      } catch (err) {
        caughtError = err as Error;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toContain(EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE);
      expect(caughtError!.message).toContain('[INVALID_CANONICAL_VARIANTS]');
      expect(caughtError!.message).toContain('article_cover');
      expect(caughtError!.message).not.toContain('editorial_images/');
    });

    it('Case 14: blocks the entire transition when an article references a mixed set of eligible and ineligible images across richBodyAr and richBodyEn', async () => {
      const approvedArId = 'asset_pub_mixed_approved_ar_001';
      const pendingEnId = 'asset_pub_mixed_pending_en_002';
      seedAssetInRepo(buildApprovedAsset(approvedArId));
      await assetRepo.createIfAbsent(buildPendingReviewAsset(pendingEnId));

      const draft = await service.createDraft(
        {
          titleAr: 'خبر مختلط بصورة معتمدة بالعربية وصورة معلقة بالإنجليزية',
          titleEn: 'Mixed eligibility bilingual article',
          summaryAr: 'ملخص',
          summaryEn: 'Summary',
          bodyAr: '',
          bodyEn: '',
          richBodyAr: makeV2DocWithImages([approvedArId], { dir: 'rtl' }),
          richBodyEn: makeV2DocWithImages([pendingEnId], { dir: 'ltr' }),
          category: 'Climate',
        },
        editorActor
      );

      await transitionDraftToApproved(service, draft.id);

      await expect(
        service.transitionWorkflow(draft.id, 'Published', publisherActor, 'محاولة نشر مقال مختلط')
      ).rejects.toThrow(
        new RegExp(
          `${EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE}.*\\[RIGHTS_STATUS_NOT_APPROVED\\].*${pendingEnId}`
        )
      );
    });

    it('Case 15: performs zero news writes and preserves prior workflowState, history, publishedAt, and rich body documents when publication is blocked', async () => {
      const approvedId = 'asset_pub_zerowrite_ok_001';
      const pendingId = 'asset_pub_zerowrite_pending_002';
      seedAssetInRepo(buildApprovedAsset(approvedId));
      await assetRepo.createIfAbsent(buildPendingReviewAsset(pendingId));

      const arDoc = makeV2DocWithImages([approvedId], { dir: 'rtl' });
      const enDoc = makeV2DocWithImages([pendingId], { dir: 'ltr' });

      const draft = await service.createDraft(
        {
          titleAr: 'التحقق من عدم الكتابة عند حظر النشر',
          titleEn: 'Zero-write guarantee on blocked publication',
          summaryAr: 'ملخص',
          summaryEn: 'Summary',
          bodyAr: '',
          bodyEn: '',
          richBodyAr: arDoc,
          richBodyEn: enDoc,
          category: 'Climate',
        },
        editorActor
      );

      const approvedArticle = await transitionDraftToApproved(service, draft.id);
      const saveCallsBeforePublishAttempt = newsRepo.saveCalls;
      const snapshotBeforeAttempt = await newsRepo.getById(draft.id);

      await expect(
        service.transitionWorkflow(draft.id, 'Published', publisherActor, 'محاولة نشر محظورة')
      ).rejects.toThrow(new RegExp(EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE));

      expect(newsRepo.saveCalls).toBe(saveCallsBeforePublishAttempt);

      const persistedAfterBlockedPublish = await newsRepo.getById(draft.id);
      expect(persistedAfterBlockedPublish).toEqual(snapshotBeforeAttempt);
      expect(persistedAfterBlockedPublish?.workflowState).toBe('Approved');
      expect(persistedAfterBlockedPublish?.publishedAt).toBeUndefined();
      expect(persistedAfterBlockedPublish?.history).toHaveLength(approvedArticle.history.length);
      expect(persistedAfterBlockedPublish?.richBodyAr).toEqual(arDoc);
      expect(persistedAfterBlockedPublish?.richBodyEn).toEqual(enDoc);
      expect(
        extractEditorialImageAssetIdsFromRichDocument(persistedAfterBlockedPublish?.richBodyAr)
      ).toEqual([approvedId]);
      expect(
        extractEditorialImageAssetIdsFromRichDocument(persistedAfterBlockedPublish?.richBodyEn)
      ).toEqual([pendingId]);
    });

    it('Case 16: preserves private draft linkage (createDraft and updateDraft) with PendingReview assets', async () => {
      const pendingId1 = 'asset_pub_draft_pending_001';
      const pendingId2 = 'asset_pub_draft_pending_002';
      await assetRepo.createIfAbsent(buildPendingReviewAsset(pendingId1));
      await assetRepo.createIfAbsent(buildPendingReviewAsset(pendingId2));

      const created = await service.createDraft(
        {
          titleAr: 'مسودة خاصة بصورة قيد المراجعة',
          summaryAr: 'ملخص',
          bodyAr: '',
          richBodyAr: makeV2DocWithImages([pendingId1]),
          category: 'Climate',
        },
        editorActor
      );

      expect(created.workflowState).toBe('Draft');
      expect(extractEditorialImageAssetIdsFromRichDocument(created.richBodyAr)).toEqual([
        pendingId1,
      ]);

      const updated = await service.updateDraft(
        created.id,
        {
          richBodyAr: makeV2DocWithImages([pendingId1, pendingId2]),
        },
        editorActor
      );

      expect(updated.workflowState).toBe('Draft');
      expect(extractEditorialImageAssetIdsFromRichDocument(updated.richBodyAr)).toEqual([
        pendingId1,
        pendingId2,
      ]);
    });

    it('Case 17: does not restrict non-publication workflow transitions (Draft -> InReview -> ChangesRequested -> Draft -> InReview -> Approved) when images are PendingReview', async () => {
      const pendingId = 'asset_pub_nonpub_transitions_001';
      await assetRepo.createIfAbsent(buildPendingReviewAsset(pendingId));

      const draft = await service.createDraft(
        {
          titleAr: 'مقال يمر بجميع مراحل المراجعة قبل اعتماد الصورة',
          summaryAr: 'ملخص',
          bodyAr: '',
          richBodyAr: makeV2DocWithImages([pendingId]),
          category: 'Climate',
        },
        editorActor
      );

      const getByIdSpy = vi.spyOn(assetRepo, 'getById');
      getByIdSpy.mockClear();

      const inReview1 = await service.transitionWorkflow(
        draft.id,
        'InReview',
        editorActor,
        'إرسال للمراجعة الأولى'
      );
      expect(inReview1.workflowState).toBe('InReview');

      const changesRequested = await service.transitionWorkflow(
        draft.id,
        'ChangesRequested',
        reviewerActor,
        'يرجى تدقيق العنوان'
      );
      expect(changesRequested.workflowState).toBe('ChangesRequested');

      const backToDraft = await service.transitionWorkflow(
        draft.id,
        'Draft',
        editorActor,
        'إعادة للمسودة للتعديل'
      );
      expect(backToDraft.workflowState).toBe('Draft');

      const inReview2 = await service.transitionWorkflow(
        draft.id,
        'InReview',
        editorActor,
        'إرسال للمراجعة الثانية'
      );
      expect(inReview2.workflowState).toBe('InReview');

      const approved = await service.transitionWorkflow(
        draft.id,
        'Approved',
        reviewerActor,
        'موافقة تحريرية بانتظار اعتماد الحقوق'
      );
      expect(approved.workflowState).toBe('Approved');

      // None of the non-publication transitions invoke the publication asset gate
      expect(getByIdSpy).not.toHaveBeenCalled();
    });

    it('Case 18: allows publication on a fresh transition check after a previously PendingReview image receives human rights approval', async () => {
      const assetId = 'asset_pub_approve_then_publish_001';
      await assetRepo.createIfAbsent(buildPendingReviewAsset(assetId));

      const draft = await service.createDraft(
        {
          titleAr: 'خبر ينتظر اعتماد حقوق الصورة قبل النشر',
          summaryAr: 'ملخص',
          bodyAr: '',
          richBodyAr: makeV2DocWithImages([assetId]),
          category: 'Climate',
        },
        editorActor
      );

      await transitionDraftToApproved(service, draft.id);

      // First attempt while PendingReview is blocked
      await expect(
        service.transitionWorkflow(draft.id, 'Published', publisherActor, 'محاولة نشر مبكرة')
      ).rejects.toThrow(new RegExp(EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE));

      // Now human rights reviewer approves the asset in the canonical asset repository
      const approvedAsset = buildApprovedAsset(assetId);
      seedAssetInRepo(approvedAsset);

      // Subsequent publication attempt succeeds cleanly
      const published = await service.transitionWorkflow(
        draft.id,
        'Published',
        publisherActor,
        'نشر بعد اعتماد حقوق الصورة'
      );

      expect(published.workflowState).toBe('Published');
      expect(published.publishedAt).toBeDefined();

      // And PublicNewsRepository delivers the published article with its approved image intact
      const publicRepo = new PublicNewsRepository(newsRepo, assetRepo);
      const publicList = await publicRepo.listPublicNews('ar');
      expect(publicList).toHaveLength(1);
      expect(publicList[0].id).toBe(draft.id);
      expect(extractEditorialImageAssetIdsFromRichDocument(publicList[0].richBodyAr)).toEqual([
        assetId,
      ]);
    });

    it('Case 19: preserves editorial transition permissions (Publish permission required) and workflow order (Approved state required before Published)', async () => {
      const adminRepo = new InMemoryTestAdminRepository([
        activeOwner,
        activeManager,
        activeEditor,
      ]);
      const approvedAssetId = 'asset_pub_permissions_001';
      const pendingAssetId = 'asset_pub_permissions_pending_002';
      seedAssetInRepo(buildApprovedAsset(approvedAssetId));
      await assetRepo.createIfAbsent(buildPendingReviewAsset(pendingAssetId));

      const draft = await service.createDraft(
        {
          titleAr: 'اختبار صلاحيات النشر وتسلسل سير العمل',
          summaryAr: 'ملخص',
          bodyAr: '',
          richBodyAr: makeV2DocWithImages([approvedAssetId]),
          category: 'Climate',
        },
        editorActor
      );

      // 19a. Cannot jump directly from Draft to Published even by Owner
      await expect(
        executeManageNewsRequest(
          {
            auth: { uid: activeOwner.id },
            data: {
              action: 'transitionWorkflow',
              id: draft.id,
              targetState: 'Published',
              comment: 'قفز غير قانوني',
            },
          },
          adminRepo,
          service
        )
      ).rejects.toThrow(/VALIDATION_ERROR/);

      // Move to InReview -> Approved
      await executeManageNewsRequest(
        {
          auth: { uid: activeEditor.id },
          data: {
            action: 'transitionWorkflow',
            id: draft.id,
            targetState: 'InReview',
            comment: 'إرسال للمراجعة',
          },
        },
        adminRepo,
        service
      );

      await executeManageNewsRequest(
        {
          auth: { uid: activeManager.id },
          data: {
            action: 'transitionWorkflow',
            id: draft.id,
            targetState: 'Approved',
            comment: 'موافقة تحريرية',
          },
        },
        adminRepo,
        service
      );

      // 19b. ContentEditor and TrainingManager lack AdminPermission.Publish
      await expect(
        executeManageNewsRequest(
          {
            auth: { uid: activeEditor.id },
            data: {
              action: 'transitionWorkflow',
              id: draft.id,
              targetState: 'Published',
              comment: 'محاولة نشر من محرر',
            },
          },
          adminRepo,
          service
        )
      ).rejects.toThrow(/PERMISSION_DENIED/);

      await expect(
        executeManageNewsRequest(
          {
            auth: { uid: activeManager.id },
            data: {
              action: 'transitionWorkflow',
              id: draft.id,
              targetState: 'Published',
              comment: 'محاولة نشر من مدير تدريب',
            },
          },
          adminRepo,
          service
        )
      ).rejects.toThrow(/PERMISSION_DENIED/);

      // 19c. Owner has AdminPermission.Publish and succeeds when image is Approved
      const publishedRes = await executeManageNewsRequest(
        {
          auth: { uid: activeOwner.id },
          data: {
            action: 'transitionWorkflow',
            id: draft.id,
            targetState: 'Published',
            comment: 'نشر معتمد من المالك',
          },
        },
        adminRepo,
        service
      );
      expect(publishedRes.item.workflowState).toBe('Published');

      // 19d. Owner attempting to publish an Approved article with a PendingReview image through executeManageNewsRequest is blocked by the publication gate
      const draftWithPending = await service.createDraft(
        {
          titleAr: 'خبر بصورة معلقة عبر المعالج',
          summaryAr: 'ملخص',
          bodyAr: '',
          richBodyAr: makeV2DocWithImages([pendingAssetId]),
          category: 'Climate',
        },
        editorActor
      );
      await transitionDraftToApproved(service, draftWithPending.id);

      await expect(
        executeManageNewsRequest(
          {
            auth: { uid: activeOwner.id },
            data: {
              action: 'transitionWorkflow',
              id: draftWithPending.id,
              targetState: 'Published',
              comment: 'محاولة نشر صورة معلقة من المالك',
            },
          },
          adminRepo,
          service
        )
      ).rejects.toThrow(new RegExp(EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE));
    });

    it('Case 20: preserves PublicNewsRepository defense-in-depth sanitization if an image is revoked after publication', async () => {
      const assetId = 'asset_pub_revoked_post_publish_001';
      seedAssetInRepo(buildApprovedAsset(assetId));

      const draft = await service.createDraft(
        {
          titleAr: 'خبر منشور ثم سُحبت حقوق صورته لاحقاً',
          summaryAr: 'ملخص',
          bodyAr: '',
          richBodyAr: makeV2DocWithImages([assetId], {
            leadText: 'النص الصحفي يبقى متاحاً للجمهور بعد حجب الصورة المسحوبة.',
          }),
          category: 'Climate',
        },
        editorActor
      );

      await transitionDraftToApproved(service, draft.id);
      const published = await service.transitionWorkflow(
        draft.id,
        'Published',
        publisherActor,
        'نشر قانوني أثناء سريان الترخيص'
      );
      expect(published.workflowState).toBe('Published');

      const publicRepo = new PublicNewsRepository(newsRepo, assetRepo);

      // Before post-publication revocation: image is delivered
      const beforeRevoke = await publicRepo.listPublicNews('ar');
      expect(beforeRevoke).toHaveLength(1);
      expect(
        extractEditorialImageAssetIdsFromRichDocument(beforeRevoke[0].richBodyAr)
      ).toEqual([assetId]);

      // After publication, rights are revoked in the canonical asset repository
      const revokedPostPublish = buildAssetWithState(assetId, {
        rights: {
          status: 'Revoked',
          reviewedByUid: 'admin-reviewer-01',
          reviewedAtIso: '2026-03-20T11:45:00.000Z',
          reviewReason: 'Post-publication rights takedown.',
        },
      });
      seedAssetInRepo(revokedPostPublish, 3);

      // PublicNewsRepository defense-in-depth withholds the revoked image while preserving article text
      const afterRevoke = await publicRepo.listPublicNews('ar');
      expect(afterRevoke).toHaveLength(1);
      expect(
        extractEditorialImageAssetIdsFromRichDocument(afterRevoke[0].richBodyAr)
      ).toEqual([]);
      expect(afterRevoke[0].bodyAr).toContain(
        'النص الصحفي يبقى متاحاً للجمهور بعد حجب الصورة المسحوبة.'
      );
    });
  });
});

