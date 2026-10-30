import type { JournalisticType } from '../shared/contentContract';
import type { 
  NewsRepository, 
  NewsItemBackend, 
  WorkflowStateBackend, 
  WorkflowTransitionRecordBackend 
} from './newsRepository';
import { FirestoreNewsRepository } from './firestoreNewsRepository';
import { NewsValidator } from './newsValidator';
import { 
  validateRichNewsDocumentByVersion, 
  extractPlainTextFromRichDocument 
} from '../shared/richNewsDocumentContract';
import {
  DEFAULT_ASSET_VALIDATION_LIMITS,
  type EditorialImageAssetMetadata,
  type EditorialImageAssetVariantKey,
} from '../types/editorialImageAsset';
import {
  validateEditorialImageAsset,
  validateEditorialImageAssetVariant,
  validateEditorialImageUsageScope,
} from '../shared/editorialImageAssetContract';
import {
  EditorialImageAssetRepositoryError,
  type EditorialImageAssetRepository,
} from './editorialImageAssetRepository';
import { isEditorialImageAssetEligibleForPublicArticle } from './publicNewsRepository';

export const EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE =
  'EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE' as const;

function redactSensitivePathsFromDiagnostic(message: string): string {
  return message
    .replace(/editorial_images\/[^\s"';)]*/gi, '[REDACTED_STORAGE_PATH]')
    .replace(/gs:\/\/[^\s"';)]*/gi, '[REDACTED_BUCKET_URI]');
}

function describePublicationIneligibilityReason(
  asset: EditorialImageAssetMetadata,
  articleId: string
): string {
  const assetId =
    typeof asset?.assetId === 'string' && asset.assetId.trim().length > 0
      ? asset.assetId
      : '<unknown>';

  if (asset.status !== 'active') {
    return `[INACTIVE_ASSET_STATUS] Editorial image asset "${assetId}" referenced by article "${articleId}" has status "${String(asset.status)}"; only "active" assets are eligible for publication.`;
  }

  if (!asset.rights || typeof asset.rights !== 'object') {
    return `[INVALID_ASSET_RECORD] Editorial image asset "${assetId}" referenced by article "${articleId}" is missing a valid rights record.`;
  }

  if (asset.rights.status !== 'Approved') {
    return `[RIGHTS_STATUS_NOT_APPROVED] Editorial image asset "${assetId}" referenced by article "${articleId}" has rights status "${String(asset.rights.status)}"; only human-"Approved" assets are eligible for publication.`;
  }

  const usageScope = asset.rights.usageScope;
  const scopeValidation = validateEditorialImageUsageScope(
    usageScope,
    DEFAULT_ASSET_VALIDATION_LIMITS
  );
  if (
    !scopeValidation.valid ||
    !usageScope ||
    (usageScope.scopeType === 'GeneralEditorial' &&
      asset.rights.licenseType === 'ContextSpecificAssessment') ||
    (usageScope.scopeType === 'ArticleRestricted' &&
      (!Array.isArray(usageScope.articleIds) ||
        !usageScope.articleIds.includes(articleId)))
  ) {
    return `[USAGE_SCOPE_NOT_AUTHORIZED] Editorial image asset "${assetId}" does not have an approved usageScope authorizing publication in article "${articleId}".`;
  }

  const variants = asset.variants as Record<string, unknown> | undefined;
  if (!variants || typeof variants !== 'object' || Array.isArray(variants)) {
    return `[INVALID_CANONICAL_VARIANTS] Editorial image asset "${assetId}" referenced by article "${articleId}" is missing a valid canonical variants map.`;
  }

  for (const requiredKey of REQUIRED_EDITORIAL_IMAGE_VARIANT_KEYS) {
    const candidateVariant = variants[requiredKey];
    if (!candidateVariant) {
      return `[INVALID_CANONICAL_VARIANTS] Editorial image asset "${assetId}" referenced by article "${articleId}" is missing required canonical variant "${requiredKey}".`;
    }
    const variantCheck = validateEditorialImageAssetVariant(
      candidateVariant,
      requiredKey,
      DEFAULT_ASSET_VALIDATION_LIMITS,
      assetId
    );
    if (!variantCheck.valid) {
      return `[INVALID_CANONICAL_VARIANTS] Editorial image asset "${assetId}" referenced by article "${articleId}" has invalid canonical variant "${requiredKey}".`;
    }
  }

  return `[INVALID_ASSET_RECORD] Editorial image asset "${assetId}" referenced by article "${articleId}" failed canonical public eligibility validation.`;
}

export const REQUIRED_EDITORIAL_IMAGE_VARIANT_KEYS: readonly EditorialImageAssetVariantKey[] =
  Object.freeze([
    'thumbnail',
    'card',
    'article_inline',
    'article_cover',
    'original_processed',
  ]);

/**
 * Extracts unique `editorialImage.attrs.assetId` references in deterministic
 * document-traversal order from a validated V2 rich news document wrapper.
 * Returns an empty array for V1, undefined, or non-V2 documents.
 */
export function extractEditorialImageAssetIdsFromRichDocument(
  richDoc: unknown
): string[] {
  if (!richDoc || typeof richDoc !== 'object' || Array.isArray(richDoc)) {
    return [];
  }

  const wrapper = richDoc as Record<string, unknown>;
  if (wrapper.schemaVersion !== 2) {
    return [];
  }

  const doc = wrapper.doc as Record<string, unknown> | undefined;
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || doc.type !== 'doc') {
    return [];
  }

  if (!Array.isArray(doc.content)) {
    return [];
  }

  const seen = new Set<string>();

  function walkNodes(nodes: unknown[]): void {
    for (const node of nodes) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) {
        continue;
      }
      const record = node as Record<string, unknown>;
      if (record.type === 'editorialImage') {
        const attrs = record.attrs as Record<string, unknown> | undefined;
        if (
          attrs &&
          typeof attrs === 'object' &&
          !Array.isArray(attrs) &&
          typeof attrs.assetId === 'string' &&
          attrs.assetId.length > 0
        ) {
          seen.add(attrs.assetId);
        }
      }
      if (Array.isArray(record.content)) {
        walkNodes(record.content);
      }
    }
  }

  walkNodes(doc.content);
  return Array.from(seen);
}

/**
 * Collects unique `editorialImage.attrs.assetId` references across both
 * Arabic and English rich document bodies in deterministic order.
 */
export function collectUniqueEditorialImageAssetIds(
  richBodyAr: unknown,
  richBodyEn: unknown
): string[] {
  const combined = new Set<string>();
  for (const id of extractEditorialImageAssetIdsFromRichDocument(richBodyAr)) {
    combined.add(id);
  }
  for (const id of extractEditorialImageAssetIdsFromRichDocument(richBodyEn)) {
    combined.add(id);
  }
  return Array.from(combined);
}

export interface SaveNewsInput {
  id?: string;
  titleAr: string;
  titleEn?: string;
  kickerAr?: string;
  kickerEn?: string;
  journalisticType?: JournalisticType;
  summaryAr: string;
  summaryEn?: string;
  bodyAr: string;
  bodyEn?: string;
  richBodyAr?: any;
  richBodyEn?: any;
  author?: string;
  category: string;
  tags?: string[];
  sources?: string[];
  featuredImage?: string;
  location?: string;
  urgencyLevel?: 'Standard' | 'Urgent' | 'Breaking';
  relatedVideoIds?: string[];
}

export interface ActorContext {
  uid: string;
  name: string;
  role: string;
}

export class NewsApplicationService {
  private repo: NewsRepository;
  private assetRepo?: EditorialImageAssetRepository;

  constructor(
    repo?: NewsRepository,
    assetRepo?: EditorialImageAssetRepository
  ) {
    this.repo = repo || new FirestoreNewsRepository();
    this.assetRepo = assetRepo;
  }

  /**
   * Authoritatively verifies that every newly introduced V2 `editorialImage`
   * asset reference exists in `EditorialImageAssetRepository` and is eligible
   * for private draft linkage (`status === 'active'`, `rights.status` in
   * `'PendingReview' | 'Approved'`, and all 5 canonical variants present).
   */
  private async verifyNewlyIntroducedEditorialImageAssets(
    newAssetIds: readonly string[]
  ): Promise<void> {
    if (newAssetIds.length === 0) {
      return;
    }

    if (!this.assetRepo) {
      throw new Error(
        `UNVERIFIED_EDITORIAL_IMAGE_ASSET_REPO_MISSING: EditorialImageAssetRepository is required to verify newly introduced editorial image asset "${newAssetIds[0]}".`
      );
    }

    for (const assetId of newAssetIds) {
      let readResult;
      try {
        readResult = await this.assetRepo.getById(assetId);
      } catch (err: unknown) {
        if (
          err instanceof EditorialImageAssetRepositoryError &&
          err.code === 'INVALID_ASSET'
        ) {
          throw new Error(
            `INVALID_EDITORIAL_IMAGE_ASSET_RECORD: Editorial image asset "${assetId}" has an invalid or corrupted repository record: ${err.message}`
          );
        }
        const message =
          err instanceof Error
            ? err.message
            : 'Unknown asset repository error.';
        throw new Error(
          `EDITORIAL_IMAGE_ASSET_REPOSITORY_ERROR: Failed to read editorial image asset "${assetId}" from repository: ${message}`
        );
      }

      if (
        !readResult ||
        readResult.ok !== true ||
        readResult.status !== 'FOUND' ||
        !readResult.asset
      ) {
        throw new Error(
          `UNVERIFIED_EDITORIAL_IMAGE_ASSET_NOT_FOUND: Editorial image asset "${assetId}" does not exist in the canonical asset repository.`
        );
      }

      const asset = readResult.asset;

      if (
        !asset ||
        typeof asset !== 'object' ||
        Array.isArray(asset) ||
        asset.assetId !== assetId
      ) {
        throw new Error(
          `INVALID_EDITORIAL_IMAGE_ASSET_RECORD: Editorial image asset "${assetId}" has a malformed or mismatched asset envelope.`
        );
      }

      // Check lifecycle and rights status before full variant inspection so ineligible lifecycle/rights states report deterministic status codes
      if (asset.status !== 'active') {
        throw new Error(
          `INELIGIBLE_EDITORIAL_IMAGE_ASSET_STATUS: Editorial image asset "${assetId}" has lifecycle status "${String(asset.status)}"; only "active" assets may be newly linked to drafts.`
        );
      }

      const rightsStatus = asset.rights?.status;
      if (rightsStatus !== 'PendingReview' && rightsStatus !== 'Approved') {
        throw new Error(
          `INELIGIBLE_EDITORIAL_IMAGE_ASSET_RIGHTS: Editorial image asset "${assetId}" has rights status "${String(rightsStatus)}"; only "PendingReview" or "Approved" assets may be newly linked to private drafts.`
        );
      }

      // Verify all 5 required canonical variants are present and valid
      const variants = asset.variants as
        | Record<string, unknown>
        | undefined;
      if (!variants || typeof variants !== 'object' || Array.isArray(variants)) {
        throw new Error(
          `INELIGIBLE_EDITORIAL_IMAGE_ASSET_VARIANTS: Editorial image asset "${assetId}" is missing a valid variants map.`
        );
      }

      for (const requiredKey of REQUIRED_EDITORIAL_IMAGE_VARIANT_KEYS) {
        const candidateVariant = variants[requiredKey];
        if (!candidateVariant) {
          throw new Error(
            `INELIGIBLE_EDITORIAL_IMAGE_ASSET_VARIANTS: Editorial image asset "${assetId}" is missing required canonical variant "${requiredKey}".`
          );
        }
        const variantCheck = validateEditorialImageAssetVariant(
          candidateVariant,
          requiredKey,
          DEFAULT_ASSET_VALIDATION_LIMITS,
          assetId
        );
        if (!variantCheck.valid) {
          throw new Error(
            `INELIGIBLE_EDITORIAL_IMAGE_ASSET_VARIANTS: Editorial image asset "${assetId}" has invalid variant "${requiredKey}": ${variantCheck.errors.join('; ')}`
          );
        }
      }

      const fullAssetCheck = validateEditorialImageAsset(
        asset,
        DEFAULT_ASSET_VALIDATION_LIMITS
      );
      if (!fullAssetCheck.valid) {
        throw new Error(
          `INVALID_EDITORIAL_IMAGE_ASSET_RECORD: Editorial image asset "${assetId}" failed canonical contract validation: ${fullAssetCheck.errors.join('; ')}`
        );
      }
    }
  }

  async listAll(): Promise<NewsItemBackend[]> {
    return this.repo.listAll();
  }

  async getById(id: string): Promise<NewsItemBackend | null> {
    return this.repo.getById(id);
  }

  /**
   * Creates a new draft article.
   */
  async createDraft(input: SaveNewsInput, actor: ActorContext): Promise<NewsItemBackend> {
    // Canonical environmental category is strictly required for new drafts
    NewsValidator.validateCanonicalCategory(input.category);

    const now = new Date().toISOString();
    // Server-authoritative ID generation: client-supplied document IDs are never accepted as authoritative
    const id = `news-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    // Rich validation and plain text derivation
    let bodyAr = input.bodyAr || '';
    let bodyEn = input.bodyEn || '';

    if (input.richBodyAr !== undefined) {
      const v = validateRichNewsDocumentByVersion(input.richBodyAr);
      if (!v.valid) throw new Error(`INVALID_RICH_DOCUMENT_AR: ${v.errors.join('; ')}`);
      const derived = extractPlainTextFromRichDocument(input.richBodyAr);
      if (input.bodyAr && input.bodyAr.trim() !== derived.trim()) {
        throw new Error('CONTRADICTORY_UPDATE: Simultaneous update of richBodyAr and bodyAr with mismatched content is forbidden.');
      }
      bodyAr = derived;
    }

    if (input.richBodyEn !== undefined) {
      const v = validateRichNewsDocumentByVersion(input.richBodyEn);
      if (!v.valid) throw new Error(`INVALID_RICH_DOCUMENT_EN: ${v.errors.join('; ')}`);
      const derived = extractPlainTextFromRichDocument(input.richBodyEn);
      if (input.bodyEn && input.bodyEn.trim() !== derived.trim()) {
        throw new Error('CONTRADICTORY_UPDATE: Simultaneous update of richBodyEn and bodyEn with mismatched content is forbidden.');
      }
      bodyEn = derived;
    }

    const item: NewsItemBackend = {
      id,
      titleAr: input.titleAr,
      titleEn: input.titleEn || '',
      kickerAr: input.kickerAr !== undefined ? input.kickerAr : undefined,
      kickerEn: input.kickerEn !== undefined ? input.kickerEn : undefined,
      journalisticType: input.journalisticType !== undefined ? input.journalisticType : undefined,
      summaryAr: input.summaryAr || '',
      summaryEn: input.summaryEn || '',
      bodyAr,
      bodyEn,
      richBodyAr: input.richBodyAr,
      richBodyEn: input.richBodyEn,
      author: input.author || actor.name,
      category: input.category,
      tags: input.tags || [],
      sources: input.sources || [],
      featuredImage: input.featuredImage,
      workflowState: 'Draft',
      createdAt: now,
      updatedAt: now,
      history: [
        {
          id: `trans-${Date.now()}-init`,
          fromState: 'Draft',
          toState: 'Draft',
          action: 'revise_draft',
          actorName: actor.name,
          actorRole: actor.role,
          timestamp: now,
          comment: 'Initial draft created',
        },
      ],
      location: input.location,
      urgencyLevel: input.urgencyLevel || 'Standard',
      relatedVideoIds: input.relatedVideoIds || [],
    };

    NewsValidator.validateNewsPayload(item);

    const newAssetIds = collectUniqueEditorialImageAssetIds(
      item.richBodyAr,
      item.richBodyEn
    );
    await this.verifyNewlyIntroducedEditorialImageAssets(newAssetIds);

    await this.repo.save(item);
    return item;
  }

  /**
   * Updates an existing draft while in Draft state.
   * Strictly enforces that ONLY articles in Draft state can be edited.
   * Modifying articles in InReview, Approved, Published, or ChangesRequested is rejected
   * until an authorized transition back to Draft is completed.
   */
  async updateDraft(id: string, input: Partial<SaveNewsInput>, actor: ActorContext): Promise<NewsItemBackend> {
    const existing = await this.repo.getById(id);
    if (!existing) {
      throw new Error(`NOT_FOUND: News article with ID ${id} does not exist`);
    }

    if (existing.workflowState !== 'Draft') {
      throw new Error(
        `INVALID_TRANSITION: Cannot modify content for article '${id}' because its workflow state is '${existing.workflowState}'. Only articles in Draft state can be edited. Transition the article back to Draft before editing.`
      );
    }

    const now = new Date().toISOString();
    
    let bodyAr = input.bodyAr !== undefined ? input.bodyAr : existing.bodyAr;
    let bodyEn = input.bodyEn !== undefined ? input.bodyEn : existing.bodyEn;
    let richBodyAr = input.richBodyAr !== undefined ? input.richBodyAr : existing.richBodyAr;
    let richBodyEn = input.richBodyEn !== undefined ? input.richBodyEn : existing.richBodyEn;

    // Contradiction checks and derivation
    if (input.richBodyAr !== undefined) {
      const v = validateRichNewsDocumentByVersion(input.richBodyAr);
      if (!v.valid) throw new Error(`INVALID_RICH_DOCUMENT_AR: ${v.errors.join('; ')}`);
      const derived = extractPlainTextFromRichDocument(input.richBodyAr);
      
      if (input.bodyAr !== undefined && input.bodyAr.trim() !== derived.trim()) {
        throw new Error('CONTRADICTORY_UPDATE: Simultaneous update of richBodyAr and bodyAr with mismatched content is forbidden.');
      }
      bodyAr = derived;
    }

    if (input.richBodyEn !== undefined) {
      const v = validateRichNewsDocumentByVersion(input.richBodyEn);
      if (!v.valid) throw new Error(`INVALID_RICH_DOCUMENT_EN: ${v.errors.join('; ')}`);
      const derived = extractPlainTextFromRichDocument(input.richBodyEn);
      
      if (input.bodyEn !== undefined && input.bodyEn.trim() !== derived.trim()) {
        throw new Error('CONTRADICTORY_UPDATE: Simultaneous update of richBodyEn and bodyEn with mismatched content is forbidden.');
      }
      bodyEn = derived;
    }

    let category = existing.category;
    if (input.category !== undefined) {
      if (typeof input.category === 'string' && input.category.trim() !== '' && input.category === existing.category) {
        category = existing.category;
      } else {
        NewsValidator.validateCanonicalCategory(input.category);
        category = input.category;
      }
    }

    const updated: NewsItemBackend = {
      ...existing,
      id: existing.id,
      titleAr: input.titleAr !== undefined ? input.titleAr : existing.titleAr,
      titleEn: input.titleEn !== undefined ? input.titleEn : existing.titleEn,
      kickerAr: input.kickerAr !== undefined ? input.kickerAr : existing.kickerAr,
      kickerEn: input.kickerEn !== undefined ? input.kickerEn : existing.kickerEn,
      journalisticType: input.journalisticType !== undefined ? input.journalisticType : existing.journalisticType,
      summaryAr: input.summaryAr !== undefined ? input.summaryAr : existing.summaryAr,
      summaryEn: input.summaryEn !== undefined ? input.summaryEn : existing.summaryEn,
      bodyAr,
      bodyEn,
      richBodyAr,
      richBodyEn,
      category,
      tags: input.tags !== undefined ? input.tags : existing.tags,
      sources: input.sources !== undefined ? input.sources : existing.sources,
      featuredImage: input.featuredImage !== undefined ? input.featuredImage : existing.featuredImage,
      location: input.location !== undefined ? input.location : existing.location,
      urgencyLevel: input.urgencyLevel !== undefined ? input.urgencyLevel : existing.urgencyLevel,
      relatedVideoIds: input.relatedVideoIds !== undefined ? input.relatedVideoIds : existing.relatedVideoIds,
      updatedAt: now,
      author: existing.author || input.author || actor.name,
      workflowState: existing.workflowState,
      history: existing.history,
      createdAt: existing.createdAt,
      publishedAt: existing.publishedAt,
    };

    NewsValidator.validateNewsPayload(updated);

    const existingPersistedAssetIds = new Set(
      collectUniqueEditorialImageAssetIds(
        existing.richBodyAr,
        existing.richBodyEn
      )
    );
    const effectiveNextAssetIds = collectUniqueEditorialImageAssetIds(
      updated.richBodyAr,
      updated.richBodyEn
    );
    const newlyIntroducedAssetIds = effectiveNextAssetIds.filter(
      (assetId) => !existingPersistedAssetIds.has(assetId)
    );
    await this.verifyNewlyIntroducedEditorialImageAssets(
      newlyIntroducedAssetIds
    );

    await this.repo.save(updated);
    return updated;
  }

  /**
   * Authoritatively verifies that every V2 `editorialImage` asset referenced by
   * the persisted article documents (`richBodyAr` and `richBodyEn`) exists in
   * `EditorialImageAssetRepository` and satisfies the canonical public article
   * rights eligibility contract (`isEditorialImageAssetEligibleForPublicArticle`)
   * before the article is allowed to transition to `Published`.
   */
  private async verifyEditorialImageAssetsForPublication(
    article: NewsItemBackend
  ): Promise<void> {
    const referencedAssetIds = collectUniqueEditorialImageAssetIds(
      article.richBodyAr,
      article.richBodyEn
    );

    if (referencedAssetIds.length === 0) {
      return;
    }

    if (!this.assetRepo) {
      throw new Error(
        `${EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE}: [ASSET_REPO_MISSING] EditorialImageAssetRepository is required to verify publication eligibility for editorial image asset "${referencedAssetIds[0]}" on article "${article.id}".`
      );
    }

    for (const assetId of referencedAssetIds) {
      let readResult;
      try {
        readResult = await this.assetRepo.getById(assetId);
      } catch (err: unknown) {
        if (
          err instanceof EditorialImageAssetRepositoryError &&
          err.code === 'INVALID_ASSET'
        ) {
          throw new Error(
            `${EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE}: [INVALID_ASSET_RECORD] Editorial image asset "${assetId}" referenced by article "${article.id}" has an invalid or corrupted repository record.`
          );
        }
        const safeDetail =
          err instanceof Error
            ? redactSensitivePathsFromDiagnostic(err.message)
            : 'Unknown asset repository error.';
        throw new Error(
          `${EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE}: [ASSET_REPOSITORY_ERROR] Failed to read editorial image asset "${assetId}" for article "${article.id}": ${safeDetail}`
        );
      }

      if (
        !readResult ||
        readResult.ok !== true ||
        readResult.status !== 'FOUND' ||
        !readResult.asset
      ) {
        throw new Error(
          `${EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE}: [ASSET_NOT_FOUND] Editorial image asset "${assetId}" referenced by article "${article.id}" does not exist in the canonical asset repository.`
        );
      }

      const asset = readResult.asset;
      if (
        !asset ||
        typeof asset !== 'object' ||
        Array.isArray(asset) ||
        asset.assetId !== assetId
      ) {
        throw new Error(
          `${EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE}: [INVALID_ASSET_RECORD] Editorial image asset "${assetId}" referenced by article "${article.id}" has a malformed or mismatched asset envelope.`
        );
      }

      if (!isEditorialImageAssetEligibleForPublicArticle(asset, article.id)) {
        const reason = describePublicationIneligibilityReason(asset, article.id);
        throw new Error(
          `${EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE}: ${reason}`
        );
      }
    }
  }

  /**
   * Transitions an article through the editorial workflow.
   * Human explicit publication required for state === 'Published'.
   * Formal withdrawal from 'Published' to 'Draft' is restricted to an active 'Owner' with a mandatory written reason.
   */
  async transitionWorkflow(
    id: string,
    targetState: WorkflowStateBackend,
    actor: ActorContext,
    comment?: string
  ): Promise<NewsItemBackend> {
    const existing = await this.repo.getById(id);
    if (!existing) {
      throw new Error(`NOT_FOUND: News article with ID ${id} does not exist`);
    }

    if (existing.workflowState === 'Published' && targetState === 'Draft') {
      if (!actor || actor.role !== 'Owner') {
        throw new Error(
          'PERMISSION_DENIED: Only an active Owner may withdraw a published article to Draft'
        );
      }
    }

    const action = NewsValidator.validateTransition(existing.workflowState, targetState, comment);

    // Forward workflow transitions to InReview, Approved, or Published require a canonical category
    if (targetState === 'InReview' || targetState === 'Approved' || targetState === 'Published') {
      NewsValidator.validateCanonicalCategory(existing.category);
    }

    if (targetState === 'Published') {
      await this.verifyEditorialImageAssetsForPublication(existing);
    }

    const now = new Date().toISOString();
    const normalizedComment =
      typeof comment === 'string' && comment.trim() !== '' ? comment.trim() : undefined;

    const transitionRecord: WorkflowTransitionRecordBackend = {
      id: `trans-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      fromState: existing.workflowState,
      toState: targetState,
      action,
      actorName: actor.name,
      actorRole: actor.role,
      timestamp: now,
      comment: normalizedComment,
    };

    const updated: NewsItemBackend = {
      ...existing,
      workflowState: targetState,
      updatedAt: now,
      publishedAt: targetState === 'Published' ? (existing.publishedAt || now) : existing.publishedAt,
      history: [...(existing.history || []), transitionRecord],
    };

    await this.repo.save(updated);
    return updated;
  }
}
