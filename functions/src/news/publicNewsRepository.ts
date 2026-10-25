import { getFirestore } from 'firebase-admin/firestore';
import type {
  NewsItemBackend,
  NewsRepository,
  SanitizedPublicNewsDTO,
} from './newsRepository';
import { FirestoreNewsRepository } from './firestoreNewsRepository';
import type { EditorialImageAssetRepository } from './editorialImageAssetRepository';
import {
  FirestoreEditorialImageAssetRepository,
  type EditorialImageFirestoreDatabase,
  type EditorialImageFirestoreTransaction,
} from './firestoreEditorialImageAssetRepository';
import {
  extractEditorialImageAssetIdsFromRichDocument,
  REQUIRED_EDITORIAL_IMAGE_VARIANT_KEYS,
} from './newsApplicationService';
import { isCanonicalCategory } from '../shared/contentContract';
import {
  validateAssetId,
  validateEditorialImageAsset,
  validateEditorialImageAssetVariant,
  validateEditorialImageUsageScope,
} from '../shared/editorialImageAssetContract';
import {
  validateRichNewsDocumentByVersion,
  validateRichNewsDocumentV2,
} from '../shared/richNewsDocumentContract';
import {
  DEFAULT_ASSET_VALIDATION_LIMITS,
  type EditorialImageAssetMetadata,
  type EditorialImageAssetValidationLimits,
  type EditorialImageAssetVariantKey,
} from '../types/editorialImageAsset';
import type {
  BlockNodeV2,
  EditorialImageNodeAttrsV2,
  EditorialImageNodeV2,
  RichNewsDocumentWrapper,
  RichNewsDocumentWrapperV2,
} from '../types/richNewsDocument';

const FORBIDDEN_URL_SCHEME_REGEX = /^(https?:\/\/|gs:\/\/|data:|blob:)/i;
const ASSET_LOOKUP_CONCURRENCY_LIMIT = 10;

export const PUBLIC_DELIVERY_EDITORIAL_IMAGE_VARIANT_KEYS = [
  'thumbnail',
  'card',
  'article_inline',
  'article_cover',
] as const satisfies readonly EditorialImageAssetVariantKey[];

export type PublicEditorialImageDeliveryVariantKey =
  (typeof PUBLIC_DELIVERY_EDITORIAL_IMAGE_VARIANT_KEYS)[number];

export type PublicEditorialImageDeliveryDenialReason =
  | 'INVALID_ARTICLE_ID'
  | 'INVALID_ASSET_ID'
  | 'INVALID_VARIANT_KEY'
  | 'ARTICLE_NOT_PUBLISHED'
  | 'ASSET_NOT_REFERENCED_BY_ARTICLE'
  | 'ASSET_NOT_ELIGIBLE_FOR_PUBLIC_ARTICLE';

export interface PublicEditorialImageDeliveryDecision {
  eligible: boolean;
  articleId?: string;
  assetId?: string;
  variantKey?: PublicEditorialImageDeliveryVariantKey;
  reason?: PublicEditorialImageDeliveryDenialReason;
}

export function isPublicDeliveryEditorialImageVariantKey(
  variantKey: unknown
): variantKey is PublicEditorialImageDeliveryVariantKey {
  return (
    typeof variantKey === 'string' &&
    (PUBLIC_DELIVERY_EDITORIAL_IMAGE_VARIANT_KEYS as readonly string[]).includes(
      variantKey
    )
  );
}

function isValidCanonicalArticleId(
  articleId: unknown,
  limits: EditorialImageAssetValidationLimits = DEFAULT_ASSET_VALIDATION_LIMITS
): articleId is string {
  if (typeof articleId !== 'string') {
    return false;
  }
  const trimmed = articleId.trim();
  if (
    trimmed.length === 0 ||
    trimmed !== articleId ||
    trimmed.length > limits.maxArticleIdLength ||
    /\s/.test(trimmed) ||
    FORBIDDEN_URL_SCHEME_REGEX.test(trimmed)
  ) {
    return false;
  }
  return true;
}

/**
 * Pure server-authoritative eligibility predicate determining whether an
 * EditorialImageAssetMetadata record may be exposed in a specific public article.
 * Never throws; returns false on any validation, status, rights, scope, or variant failure.
 */
export function isEditorialImageAssetEligibleForPublicArticle(
  asset: EditorialImageAssetMetadata | null | undefined,
  articleId: string,
  limits?: EditorialImageAssetValidationLimits
): boolean {
  try {
    const effectiveLimits = limits ?? DEFAULT_ASSET_VALIDATION_LIMITS;

    if (!asset || typeof asset !== 'object') {
      return false;
    }

    if (!isValidCanonicalArticleId(articleId, effectiveLimits)) {
      return false;
    }

    const assetValidation = validateEditorialImageAsset(asset, effectiveLimits);
    if (!assetValidation.valid) {
      return false;
    }

    if (asset.status !== 'active') {
      return false;
    }

    if (!asset.rights || asset.rights.status !== 'Approved') {
      return false;
    }

    const usageScope = asset.rights.usageScope;
    const scopeValidation = validateEditorialImageUsageScope(
      usageScope,
      effectiveLimits
    );
    if (!scopeValidation.valid) {
      return false;
    }

    if (usageScope.scopeType === 'GeneralEditorial') {
      if (asset.rights.licenseType === 'ContextSpecificAssessment') {
        return false;
      }
    } else if (usageScope.scopeType === 'ArticleRestricted') {
      if (
        !Array.isArray(usageScope.articleIds) ||
        !usageScope.articleIds.includes(articleId)
      ) {
        return false;
      }
    } else {
      return false;
    }

    if (!asset.variants || typeof asset.variants !== 'object') {
      return false;
    }

    for (const variantKey of REQUIRED_EDITORIAL_IMAGE_VARIANT_KEYS) {
      const variant = asset.variants[variantKey];
      if (!variant) {
        return false;
      }
      const variantValidation = validateEditorialImageAssetVariant(
        variant,
        variantKey,
        effectiveLimits,
        asset.assetId
      );
      if (!variantValidation.valid) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

function deepCloneValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => deepCloneValue(entry)) as unknown as T;
  }
  const cloned: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry !== undefined) {
      cloned[key] = deepCloneValue(entry);
    }
  }
  return cloned as T;
}

function sanitizeEditorialImageNode(
  node: EditorialImageNodeV2
): EditorialImageNodeV2 {
  const attrs = node.attrs;
  const sanitizedAttrs: EditorialImageNodeAttrsV2 = {
    assetId: attrs.assetId,
    altAr: attrs.altAr,
    width: attrs.width,
    layout: attrs.layout,
    ...(attrs.altEn !== undefined ? { altEn: attrs.altEn } : {}),
    ...(attrs.captionAr !== undefined ? { captionAr: attrs.captionAr } : {}),
    ...(attrs.captionEn !== undefined ? { captionEn: attrs.captionEn } : {}),
  };

  return {
    type: 'editorialImage',
    attrs: sanitizedAttrs,
  };
}

function sanitizeRichNodesRecursive<
  T extends { type: string; content?: unknown[]; attrs?: unknown }
>(
  nodes: T[],
  articleId: string,
  resolvedAssetsById: ReadonlyMap<string, EditorialImageAssetMetadata | null>,
  limits: EditorialImageAssetValidationLimits
): T[] {
  const sanitized: T[] = [];

  for (const rawNode of nodes) {
    if (rawNode.type === 'editorialImage') {
      const editorialNode = rawNode as unknown as EditorialImageNodeV2;
      const assetId = editorialNode.attrs?.assetId;
      const asset =
        typeof assetId === 'string'
          ? resolvedAssetsById.get(assetId) ?? null
          : null;

      if (
        isEditorialImageAssetEligibleForPublicArticle(asset, articleId, limits)
      ) {
        sanitized.push(sanitizeEditorialImageNode(editorialNode) as unknown as T);
      }
      continue;
    }

    const clonedNode = deepCloneValue(rawNode);
    if (Array.isArray(clonedNode.content)) {
      clonedNode.content = sanitizeRichNodesRecursive(
        clonedNode.content as Array<{
          type: string;
          content?: unknown[];
          attrs?: unknown;
        }>,
        articleId,
        resolvedAssetsById,
        limits
      );
    }
    sanitized.push(clonedNode);
  }

  return sanitized;
}

/**
 * Pure rich-document sanitizer for public news DTOs.
 * Validates the input document, removes any ineligible editorialImage nodes in V2,
 * preserves a valid non-empty V2 document structure, and fails closed to undefined on error.
 */
export function sanitizePublicRichDocument(
  rawRichDoc: unknown,
  articleId: string,
  resolvedAssetsById: ReadonlyMap<string, EditorialImageAssetMetadata | null>,
  limits?: EditorialImageAssetValidationLimits
): RichNewsDocumentWrapper | RichNewsDocumentWrapperV2 | undefined {
  try {
    if (rawRichDoc === undefined || rawRichDoc === null) {
      return undefined;
    }

    const effectiveLimits = limits ?? DEFAULT_ASSET_VALIDATION_LIMITS;
    const validation = validateRichNewsDocumentByVersion(rawRichDoc);
    if (!validation.valid) {
      return undefined;
    }

    const typedDoc = rawRichDoc as
      | RichNewsDocumentWrapper
      | RichNewsDocumentWrapperV2;
    if (typedDoc.schemaVersion === 1) {
      return deepCloneValue(typedDoc);
    }

    if (typedDoc.schemaVersion === 2) {
      const clonedV2 = deepCloneValue(typedDoc);
      const sanitizedBlocks = sanitizeRichNodesRecursive<BlockNodeV2>(
        clonedV2.doc.content,
        articleId,
        resolvedAssetsById,
        effectiveLimits
      );

      clonedV2.doc.content =
        sanitizedBlocks.length > 0
          ? sanitizedBlocks
          : [{ type: 'paragraph', attrs: { dir: 'rtl' }, content: [] }];

      const postValidation = validateRichNewsDocumentV2(clonedV2);
      if (!postValidation.valid) {
        return undefined;
      }

      return clonedV2;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

function createDefaultEditorialImageAssetRepository(): EditorialImageAssetRepository {
  return new FirestoreEditorialImageAssetRepository({
    collection(collectionName: string) {
      const db = getFirestore() as unknown as EditorialImageFirestoreDatabase;
      return db.collection(collectionName);
    },
    runTransaction<T>(
      updateFunction: (
        transaction: EditorialImageFirestoreTransaction
      ) => Promise<T>
    ): Promise<T> {
      const db = getFirestore() as unknown as EditorialImageFirestoreDatabase;
      return db.runTransaction(updateFunction);
    },
  });
}

export class PublicNewsRepository {
  private repo: NewsRepository;
  private assetRepo?: EditorialImageAssetRepository;

  constructor(
    repo?: NewsRepository,
    assetRepo?: EditorialImageAssetRepository
  ) {
    this.repo = repo || new FirestoreNewsRepository();
    this.assetRepo = assetRepo;
  }

  private getAssetRepository(): EditorialImageAssetRepository {
    if (!this.assetRepo) {
      this.assetRepo = createDefaultEditorialImageAssetRepository();
    }
    return this.assetRepo;
  }

  private collectUniqueReferencedAssetIds(
    items: readonly NewsItemBackend[]
  ): Set<string> {
    const assetIds = new Set<string>();
    for (const item of items) {
      for (const id of extractEditorialImageAssetIdsFromRichDocument(
        item.richBodyAr
      )) {
        assetIds.add(id);
      }
      for (const id of extractEditorialImageAssetIdsFromRichDocument(
        item.richBodyEn
      )) {
        assetIds.add(id);
      }
    }
    return assetIds;
  }

  private async readAssetFromRepository(
    assetRepo: EditorialImageAssetRepository,
    assetId: string
  ): Promise<EditorialImageAssetMetadata | null> {
    try {
      const result = await assetRepo.getById(assetId);
      if (
        result &&
        result.ok === true &&
        result.status === 'FOUND' &&
        result.asset
      ) {
        return result.asset;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async resolveAssetsByIds(
    assetIds: ReadonlySet<string>
  ): Promise<Map<string, EditorialImageAssetMetadata | null>> {
    const resolved = new Map<string, EditorialImageAssetMetadata | null>();
    if (assetIds.size === 0) {
      return resolved;
    }

    const assetRepo = this.getAssetRepository();
    const idsArray = Array.from(assetIds);

    for (let i = 0; i < idsArray.length; i += ASSET_LOOKUP_CONCURRENCY_LIMIT) {
      const batch = idsArray.slice(i, i + ASSET_LOOKUP_CONCURRENCY_LIMIT);
      const batchEntries = await Promise.all(
        batch.map(
          async (
            assetId
          ): Promise<[string, EditorialImageAssetMetadata | null]> => {
            const asset = await this.readAssetFromRepository(
              assetRepo,
              assetId
            );
            return [assetId, asset];
          }
        )
      );

      for (const [assetId, asset] of batchEntries) {
        resolved.set(assetId, asset);
      }
    }

    return resolved;
  }

  private toSanitizedPublicNewsDTO(
    item: NewsItemBackend,
    resolvedAssetsById: ReadonlyMap<string, EditorialImageAssetMetadata | null>
  ): SanitizedPublicNewsDTO {
    return {
      id: item.id,
      titleAr: item.titleAr,
      titleEn: item.titleEn || undefined,
      kickerAr: item.kickerAr,
      kickerEn: item.kickerEn,
      journalisticType: item.journalisticType,
      summaryAr: item.summaryAr,
      summaryEn: item.summaryEn || undefined,
      bodyAr: item.bodyAr,
      bodyEn: item.bodyEn || undefined,
      richBodyAr: sanitizePublicRichDocument(
        item.richBodyAr,
        item.id,
        resolvedAssetsById
      ),
      richBodyEn: sanitizePublicRichDocument(
        item.richBodyEn,
        item.id,
        resolvedAssetsById
      ),
      author: item.author,
      category: item.category,
      tags: item.tags ? [...item.tags] : [],
      sources: item.sources ? [...item.sources] : [],
      featuredImage: item.featuredImage,
      location: item.location || 'Sudan / السودان',
      urgencyLevel: item.urgencyLevel || 'Standard',
      publishedAt: item.publishedAt || item.updatedAt || item.createdAt,
      createdAt: item.createdAt,
      relatedVideoIds: item.relatedVideoIds ? [...item.relatedVideoIds] : [],
    };
  }

  /**
   * Retrieves strictly published, approved, sanitized news articles.
   * Internal review notes, approval transition records, draft metadata, and
   * unapproved or out-of-scope editorial images are stripped before returning to the public client.
   * Withholds noncanonical categories from public presentation pending editorial reclassification.
   */
  async listPublicNews(
    language?: 'ar' | 'en'
  ): Promise<SanitizedPublicNewsDTO[]> {
    const rawItems = await this.repo.listPublished(language);

    // Double-check workflowState is strictly 'Published' and category is canonical
    const published = rawItems.filter(
      (item) =>
        item.workflowState === 'Published' && isCanonicalCategory(item.category)
    );

    const uniqueAssetIds = this.collectUniqueReferencedAssetIds(published);
    const resolvedAssetsById = await this.resolveAssetsByIds(uniqueAssetIds);

    return published.map((item) =>
      this.toSanitizedPublicNewsDTO(item, resolvedAssetsById)
    );
  }

  /**
   * Retrieves a single published, sanitized article by ID.
   * Returns null if not Published or if category is noncanonical.
   */
  async getPublicNewsById(
    id: string,
    language?: 'ar' | 'en'
  ): Promise<SanitizedPublicNewsDTO | null> {
    const item = await this.repo.getById(id);
    if (
      !item ||
      item.workflowState !== 'Published' ||
      !isCanonicalCategory(item.category)
    ) {
      return null;
    }

    if (language === 'en' && !item.titleEn && !item.bodyEn) {
      return null;
    }

    const uniqueAssetIds = this.collectUniqueReferencedAssetIds([item]);
    const resolvedAssetsById = await this.resolveAssetsByIds(uniqueAssetIds);

    return this.toSanitizedPublicNewsDTO(item, resolvedAssetsById);
  }

  /**
   * Read-only eligibility check for future B2 public editorial image binary delivery.
   * Verifies that:
   * - articleId, assetId, and optional variantKey are canonical
   * - variantKey (when supplied) is a permitted public delivery variant (original_processed is denied)
   * - the article exists, has workflowState === 'Published', and has a canonical category
   * - the article's validated richBodyAr or richBodyEn actually references assetId
   * - the asset passes isEditorialImageAssetEligibleForPublicArticle for articleId
   * Never exposes storagePath, evidenceRefs, or internal repository error details.
   */
  async evaluatePublicEditorialImageDelivery(
    articleId: string,
    assetId: string,
    variantKey?: EditorialImageAssetVariantKey | string
  ): Promise<PublicEditorialImageDeliveryDecision> {
    if (!isValidCanonicalArticleId(articleId)) {
      return {
        eligible: false,
        reason: 'INVALID_ARTICLE_ID',
      };
    }

    if (!validateAssetId(assetId).valid) {
      return {
        eligible: false,
        articleId,
        reason: 'INVALID_ASSET_ID',
      };
    }

    let validatedVariantKey: PublicEditorialImageDeliveryVariantKey | undefined;
    if (variantKey !== undefined) {
      if (!isPublicDeliveryEditorialImageVariantKey(variantKey)) {
        return {
          eligible: false,
          articleId,
          assetId,
          reason: 'INVALID_VARIANT_KEY',
        };
      }
      validatedVariantKey = variantKey;
    }

    let item: NewsItemBackend | null = null;
    try {
      item = await this.repo.getById(articleId);
    } catch {
      item = null;
    }

    if (
      !item ||
      item.workflowState !== 'Published' ||
      !isCanonicalCategory(item.category)
    ) {
      return {
        eligible: false,
        articleId,
        assetId,
        ...(validatedVariantKey ? { variantKey: validatedVariantKey } : {}),
        reason: 'ARTICLE_NOT_PUBLISHED',
      };
    }

    const validArIds = validateRichNewsDocumentByVersion(item.richBodyAr).valid
      ? extractEditorialImageAssetIdsFromRichDocument(item.richBodyAr)
      : [];
    const validEnIds = validateRichNewsDocumentByVersion(item.richBodyEn).valid
      ? extractEditorialImageAssetIdsFromRichDocument(item.richBodyEn)
      : [];
    const referencedAssetIds = new Set<string>([...validArIds, ...validEnIds]);

    if (!referencedAssetIds.has(assetId)) {
      return {
        eligible: false,
        articleId,
        assetId,
        ...(validatedVariantKey ? { variantKey: validatedVariantKey } : {}),
        reason: 'ASSET_NOT_REFERENCED_BY_ARTICLE',
      };
    }

    const asset = await this.readAssetFromRepository(
      this.getAssetRepository(),
      assetId
    );

    if (!isEditorialImageAssetEligibleForPublicArticle(asset, articleId)) {
      return {
        eligible: false,
        articleId,
        assetId,
        ...(validatedVariantKey ? { variantKey: validatedVariantKey } : {}),
        reason: 'ASSET_NOT_ELIGIBLE_FOR_PUBLIC_ARTICLE',
      };
    }

    return {
      eligible: true,
      articleId,
      assetId,
      ...(validatedVariantKey ? { variantKey: validatedVariantKey } : {}),
    };
  }
}


