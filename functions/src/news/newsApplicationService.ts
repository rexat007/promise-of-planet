import { createHash } from 'node:crypto';
import type { JournalisticType } from '../shared/contentContract';
import type { 
  NewsRepository, 
  NewsItemBackend, 
  WorkflowStateBackend, 
  WorkflowTransitionRecordBackend 
} from './newsRepository';
import { getFirestore } from 'firebase-admin/firestore';
import { FirestoreNewsRepository, sanitizeForFirestore } from './firestoreNewsRepository';
import type { CommunityRepository, CitizenSubmissionBackend } from '../community/communityRepository';
import { FirestoreCommunityRepository } from '../community/firestoreCommunityRepository';
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
  validateAssetId,
  validateEditorialImageAsset,
  validateEditorialImageAssetVariant,
  validateEditorialImageUsageScope,
} from '../shared/editorialImageAssetContract';
import {
  EditorialImageAssetRepositoryError,
  type EditorialImageAssetRepository,
} from './editorialImageAssetRepository';
import { isEditorialImageAssetEligibleForPublicArticle } from './publicNewsRepository';
import type { MediaRepository } from '../media/mediaRepository';
import { FirestoreMediaRepository } from '../media/firestoreMediaRepository';

export const EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE =
  'EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE' as const;

export const MAX_RELATED_VIDEOS_PER_NEWS_ARTICLE = 5 as const;

const CANONICAL_RELATED_VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{3,128}$/;

export function isMalformedOrUrlRelatedVideoId(candidate: unknown): boolean {
  if (typeof candidate !== 'string') {
    return true;
  }
  const trimmed = candidate.trim();
  if (!trimmed || candidate !== trimmed || /\s/.test(candidate)) {
    return true;
  }
  const lower = candidate.toLowerCase();
  if (
    /^(https?:|ftp:|file:|data:|blob:|gs:|javascript:)/i.test(candidate) ||
    lower.includes('youtube.com') ||
    lower.includes('youtu.be') ||
    candidate.includes('/') ||
    candidate.includes('\\') ||
    candidate.includes('..') ||
    candidate.includes('?') ||
    candidate.includes('#') ||
    candidate.includes(':')
  ) {
    return true;
  }
  return !CANONICAL_RELATED_VIDEO_ID_REGEX.test(candidate);
}

export type EditorialImageLocationRole = 'cover' | 'inline_ar' | 'inline_en';

export interface EditorialImageReferenceWithLocations {
  readonly assetId: string;
  readonly locations: readonly EditorialImageLocationRole[];
}

export type NewsOperationHttpErrorCode =
  | 'failed-precondition'
  | 'invalid-argument'
  | 'permission-denied'
  | 'not-found';

export interface NewsEditorialImageErrorDetails {
  readonly reasonCode: string;
  readonly subReasonCode?: string;
  readonly assetId?: string;
  readonly locations?: readonly EditorialImageLocationRole[];
  readonly articleId?: string;
}

export class NewsOperationError extends Error {
  public readonly httpErrorCode: NewsOperationHttpErrorCode;
  public readonly reasonCode: string;
  public readonly details?: NewsEditorialImageErrorDetails;

  constructor(
    httpErrorCode: NewsOperationHttpErrorCode,
    reasonCode: string,
    message: string,
    details?: NewsEditorialImageErrorDetails
  ) {
    super(redactSensitivePathsFromDiagnostic(message));
    this.name = 'NewsOperationError';
    this.httpErrorCode = httpErrorCode;
    this.reasonCode = reasonCode;
    this.details = details;
  }
}

export const CREATE_DRAFT_IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9_-]{16,96}$/;

export function deriveDeterministicCreateDraftId(
  actorUid: string,
  createIdempotencyKey: string
): string {
  const digest = createHash('sha256')
    .update(`pop-news-create-draft:v1:${actorUid}:${createIdempotencyKey}`)
    .digest('hex')
    .slice(0, 24);
  return `news-idem-${digest}`;
}

export function extractManagedFeaturedImageAssetId(
  featuredImage: unknown
): string | null {
  if (typeof featuredImage !== 'string') {
    return null;
  }
  const trimmed = featuredImage.trim();
  if (!trimmed) {
    return null;
  }
  return validateAssetId(trimmed, DEFAULT_ASSET_VALIDATION_LIMITS).valid
    ? trimmed
    : null;
}

function redactSensitivePathsFromDiagnostic(message: string): string {
  return message
    .replace(/editorial_images\/[^\s"';)]*/gi, '[REDACTED_STORAGE_PATH]')
    .replace(/gs:\/\/[^\s"';)]*/gi, '[REDACTED_BUCKET_URI]');
}

function describePublicationIneligibilityReason(
  asset: EditorialImageAssetMetadata,
  articleId: string
): { readonly subReasonCode: string; readonly message: string } {
  const assetId =
    typeof asset?.assetId === 'string' && asset.assetId.trim().length > 0
      ? asset.assetId
      : '<unknown>';

  if (asset.status !== 'active') {
    return {
      subReasonCode: 'INACTIVE_ASSET_STATUS',
      message: `[INACTIVE_ASSET_STATUS] Editorial image asset "${assetId}" referenced by article "${articleId}" has status "${String(asset.status)}"; only "active" assets are eligible for publication.`,
    };
  }

  if (!asset.rights || typeof asset.rights !== 'object') {
    return {
      subReasonCode: 'INVALID_ASSET_RECORD',
      message: `[INVALID_ASSET_RECORD] Editorial image asset "${assetId}" referenced by article "${articleId}" is missing a valid rights record.`,
    };
  }

  if (asset.rights.status !== 'Approved') {
    return {
      subReasonCode: 'RIGHTS_STATUS_NOT_APPROVED',
      message: `[RIGHTS_STATUS_NOT_APPROVED] Editorial image asset "${assetId}" referenced by article "${articleId}" has rights status "${String(asset.rights.status)}"; only human-"Approved" assets are eligible for publication.`,
    };
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
    return {
      subReasonCode: 'USAGE_SCOPE_NOT_AUTHORIZED',
      message: `[USAGE_SCOPE_NOT_AUTHORIZED] Editorial image asset "${assetId}" does not have an approved usageScope authorizing publication in article "${articleId}".`,
    };
  }

  const variants = asset.variants as Record<string, unknown> | undefined;
  if (!variants || typeof variants !== 'object' || Array.isArray(variants)) {
    return {
      subReasonCode: 'INVALID_CANONICAL_VARIANTS',
      message: `[INVALID_CANONICAL_VARIANTS] Editorial image asset "${assetId}" referenced by article "${articleId}" is missing a valid canonical variants map.`,
    };
  }

  for (const requiredKey of REQUIRED_EDITORIAL_IMAGE_VARIANT_KEYS) {
    const candidateVariant = variants[requiredKey];
    if (!candidateVariant) {
      return {
        subReasonCode: 'INVALID_CANONICAL_VARIANTS',
        message: `[INVALID_CANONICAL_VARIANTS] Editorial image asset "${assetId}" referenced by article "${articleId}" is missing required canonical variant "${requiredKey}".`,
      };
    }
    const variantCheck = validateEditorialImageAssetVariant(
      candidateVariant,
      requiredKey,
      DEFAULT_ASSET_VALIDATION_LIMITS,
      assetId
    );
    if (!variantCheck.valid) {
      return {
        subReasonCode: 'INVALID_CANONICAL_VARIANTS',
        message: `[INVALID_CANONICAL_VARIANTS] Editorial image asset "${assetId}" referenced by article "${articleId}" has invalid canonical variant "${requiredKey}".`,
      };
    }
  }

  return {
    subReasonCode: 'INVALID_ASSET_RECORD',
    message: `[INVALID_ASSET_RECORD] Editorial image asset "${assetId}" referenced by article "${articleId}" failed canonical public eligibility validation.`,
  };
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

/**
 * Collects every canonical managed editorial image `assetId` referenced by an
 * article across `featuredImage` (ignoring legacy safe HTTP(S) cover URLs),
 * `richBodyAr`, and `richBodyEn`, recording all role locations per asset.
 */
export function collectArticleEditorialImageReferences(article: {
  readonly featuredImage?: unknown;
  readonly richBodyAr?: unknown;
  readonly richBodyEn?: unknown;
}): EditorialImageReferenceWithLocations[] {
  const locationMap = new Map<string, EditorialImageLocationRole[]>();
  const addRef = (assetId: string, role: EditorialImageLocationRole) => {
    const existing = locationMap.get(assetId);
    if (existing) {
      if (!existing.includes(role)) {
        existing.push(role);
      }
    } else {
      locationMap.set(assetId, [role]);
    }
  };

  const coverAssetId = extractManagedFeaturedImageAssetId(article.featuredImage);
  if (coverAssetId) {
    addRef(coverAssetId, 'cover');
  }

  for (const id of extractEditorialImageAssetIdsFromRichDocument(article.richBodyAr)) {
    addRef(id, 'inline_ar');
  }
  for (const id of extractEditorialImageAssetIdsFromRichDocument(article.richBodyEn)) {
    addRef(id, 'inline_en');
  }

  return Array.from(locationMap.entries()).map(([assetId, locations]) => ({
    assetId,
    locations,
  }));
}

export function collectAllArticleEditorialImageAssetIds(
  featuredImage: unknown,
  richBodyAr: unknown,
  richBodyEn: unknown
): string[] {
  return collectArticleEditorialImageReferences({
    featuredImage,
    richBodyAr,
    richBodyEn,
  }).map((entry) => entry.assetId);
}

export interface SaveNewsInput {
  id?: string;
  createIdempotencyKey?: string;
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

export function mapCitizenCategoryToNewsCategory(category: unknown): string {
  if (typeof category !== 'string') return 'Climate';
  const trimmed = category.trim();
  const lower = trimmed.toLowerCase();
  switch (lower) {
    case 'water':
      return 'Water';
    case 'climate':
      return 'Climate';
    case 'desertification':
      return 'Agriculture';
    case 'marine':
      return 'Water';
    case 'biodiversity':
      return 'Biodiversity';
    case 'pollution':
      return 'Pollution';
    case 'energy':
      return 'Energy';
    case 'agriculture':
      return 'Agriculture';
    case 'environmentalpolicy':
      return 'EnvironmentalPolicy';
    default:
      return trimmed;
  }
}

export class NewsApplicationService {
  private repo: NewsRepository;
  private assetRepo?: EditorialImageAssetRepository;
  private mediaRepo: Pick<MediaRepository, 'getVideoById'>;
  private communityRepo?: CommunityRepository;

  constructor(
    repo?: NewsRepository,
    assetRepo?: EditorialImageAssetRepository,
    mediaRepo?: Pick<MediaRepository, 'getVideoById'>,
    communityRepo?: CommunityRepository
  ) {
    this.repo = repo || new FirestoreNewsRepository();
    this.assetRepo = assetRepo;
    this.mediaRepo = mediaRepo || new FirestoreMediaRepository();
    this.communityRepo = communityRepo;
  }

  /**
   * Authoritatively validates `relatedVideoIds` for Draft creation and updates:
   * - Rejects non-array values when provided
   * - Enforces 0..5 canonical video IDs per news article
   * - Rejects empty, whitespace, malformed, or arbitrary YouTube URL strings
   * - Rejects duplicate video IDs
   * - Verifies every video ID exists in the canonical MediaRepository
   * - Does NOT require selected videos to be publicly eligible merely to save a Draft
   */
  private async validateAndVerifyRelatedVideoIds(
    rawRelatedVideoIds: unknown
  ): Promise<string[]> {
    if (rawRelatedVideoIds === undefined) {
      return [];
    }

    if (!Array.isArray(rawRelatedVideoIds)) {
      throw new Error(
        'VALIDATION_ERROR: INVALID_RELATED_VIDEO_IDS: relatedVideoIds must be an array of canonical video IDs.'
      );
    }

    if (rawRelatedVideoIds.length > MAX_RELATED_VIDEOS_PER_NEWS_ARTICLE) {
      throw new Error(
        `VALIDATION_ERROR: RELATED_VIDEOS_LIMIT_EXCEEDED: A news article cannot have more than ${MAX_RELATED_VIDEOS_PER_NEWS_ARTICLE} related videos (received ${rawRelatedVideoIds.length}).`
      );
    }

    if (rawRelatedVideoIds.length === 0) {
      return [];
    }

    const seen = new Set<string>();
    const validatedIds: string[] = [];

    for (let i = 0; i < rawRelatedVideoIds.length; i++) {
      const candidate = rawRelatedVideoIds[i];
      if (isMalformedOrUrlRelatedVideoId(candidate) || typeof candidate !== 'string') {
        throw new Error(
          `VALIDATION_ERROR: INVALID_RELATED_VIDEO_ID: relatedVideoIds[${i}] is malformed, empty, whitespace, or an arbitrary URL instead of a canonical video ID.`
        );
      }
      if (seen.has(candidate)) {
        throw new Error(
          `VALIDATION_ERROR: DUPLICATE_RELATED_VIDEO_ID: relatedVideoIds contains duplicate video ID "${candidate}".`
        );
      }
      seen.add(candidate);
      validatedIds.push(candidate);
    }

    for (const videoId of validatedIds) {
      const existingVideo = await this.mediaRepo.getVideoById(videoId);
      if (
        !existingVideo ||
        typeof existingVideo !== 'object' ||
        typeof existingVideo.id !== 'string' ||
        existingVideo.id.trim() !== videoId ||
        (existingVideo.contentType !== undefined && existingVideo.contentType !== 'Video')
      ) {
        throw new Error(
          `VALIDATION_ERROR: RELATED_VIDEO_NOT_FOUND: Canonical video "${videoId}" does not exist in the media repository.`
        );
      }
    }

    return validatedIds;
  }

  /**
   * Authoritatively verifies that every newly introduced V2 `editorialImage`
   * asset reference exists in `EditorialImageAssetRepository` and is eligible
   * for private draft linkage (`status === 'active'`, `rights.status` in
   * `'PendingReview' | 'Approved'`, and all 5 canonical variants present).
   */
  private async verifyNewlyIntroducedEditorialImageAssets(
    newAssetIds: readonly string[],
    locationsByAssetId?: ReadonlyMap<string, readonly EditorialImageLocationRole[]>
  ): Promise<void> {
    if (newAssetIds.length === 0) {
      return;
    }

    const getLocations = (
      assetId: string
    ): readonly EditorialImageLocationRole[] | undefined =>
      locationsByAssetId?.get(assetId);

    if (!this.assetRepo) {
      const firstId = newAssetIds[0];
      throw new NewsOperationError(
        'failed-precondition',
        'UNVERIFIED_EDITORIAL_IMAGE_ASSET_REPO_MISSING',
        `UNVERIFIED_EDITORIAL_IMAGE_ASSET_REPO_MISSING: EditorialImageAssetRepository is required to verify newly introduced editorial image asset "${firstId}".`,
        {
          reasonCode: 'UNVERIFIED_EDITORIAL_IMAGE_ASSET_REPO_MISSING',
          assetId: firstId,
          locations: getLocations(firstId),
        }
      );
    }

    for (const assetId of newAssetIds) {
      const locations = getLocations(assetId);
      let readResult;
      try {
        readResult = await this.assetRepo.getById(assetId);
      } catch (err: unknown) {
        if (
          err instanceof EditorialImageAssetRepositoryError &&
          err.code === 'INVALID_ASSET'
        ) {
          throw new NewsOperationError(
            'failed-precondition',
            'INVALID_EDITORIAL_IMAGE_ASSET_RECORD',
            `INVALID_EDITORIAL_IMAGE_ASSET_RECORD: Editorial image asset "${assetId}" has an invalid or corrupted repository record: ${redactSensitivePathsFromDiagnostic(err.message)}`,
            {
              reasonCode: 'INVALID_EDITORIAL_IMAGE_ASSET_RECORD',
              assetId,
              locations,
            }
          );
        }
        const message =
          err instanceof Error
            ? redactSensitivePathsFromDiagnostic(err.message)
            : 'Unknown asset repository error.';
        throw new NewsOperationError(
          'failed-precondition',
          'EDITORIAL_IMAGE_ASSET_REPOSITORY_ERROR',
          `EDITORIAL_IMAGE_ASSET_REPOSITORY_ERROR: Failed to read editorial image asset "${assetId}" from repository: ${message}`,
          {
            reasonCode: 'EDITORIAL_IMAGE_ASSET_REPOSITORY_ERROR',
            assetId,
            locations,
          }
        );
      }

      if (
        !readResult ||
        readResult.ok !== true ||
        readResult.status !== 'FOUND' ||
        !readResult.asset
      ) {
        throw new NewsOperationError(
          'failed-precondition',
          'UNVERIFIED_EDITORIAL_IMAGE_ASSET_NOT_FOUND',
          `UNVERIFIED_EDITORIAL_IMAGE_ASSET_NOT_FOUND: Editorial image asset "${assetId}" does not exist in the canonical asset repository.`,
          {
            reasonCode: 'UNVERIFIED_EDITORIAL_IMAGE_ASSET_NOT_FOUND',
            assetId,
            locations,
          }
        );
      }

      const asset = readResult.asset;

      if (
        !asset ||
        typeof asset !== 'object' ||
        Array.isArray(asset) ||
        asset.assetId !== assetId
      ) {
        throw new NewsOperationError(
          'failed-precondition',
          'INVALID_EDITORIAL_IMAGE_ASSET_RECORD',
          `INVALID_EDITORIAL_IMAGE_ASSET_RECORD: Editorial image asset "${assetId}" has a malformed or mismatched asset envelope.`,
          {
            reasonCode: 'INVALID_EDITORIAL_IMAGE_ASSET_RECORD',
            assetId,
            locations,
          }
        );
      }

      // Check lifecycle and rights status before full variant inspection so ineligible lifecycle/rights states report deterministic status codes
      if (asset.status !== 'active') {
        throw new NewsOperationError(
          'failed-precondition',
          'INELIGIBLE_EDITORIAL_IMAGE_ASSET_STATUS',
          `INELIGIBLE_EDITORIAL_IMAGE_ASSET_STATUS: Editorial image asset "${assetId}" has lifecycle status "${String(asset.status)}"; only "active" assets may be newly linked to drafts.`,
          {
            reasonCode: 'INELIGIBLE_EDITORIAL_IMAGE_ASSET_STATUS',
            assetId,
            locations,
          }
        );
      }

      const rightsStatus = asset.rights?.status;
      if (rightsStatus !== 'PendingReview' && rightsStatus !== 'Approved') {
        throw new NewsOperationError(
          'failed-precondition',
          'INELIGIBLE_EDITORIAL_IMAGE_ASSET_RIGHTS',
          `INELIGIBLE_EDITORIAL_IMAGE_ASSET_RIGHTS: Editorial image asset "${assetId}" has rights status "${String(rightsStatus)}"; only "PendingReview" or "Approved" assets may be newly linked to private drafts.`,
          {
            reasonCode: 'INELIGIBLE_EDITORIAL_IMAGE_ASSET_RIGHTS',
            assetId,
            locations,
          }
        );
      }

      // Verify all 5 required canonical variants are present and valid
      const variants = asset.variants as
        | Record<string, unknown>
        | undefined;
      if (!variants || typeof variants !== 'object' || Array.isArray(variants)) {
        throw new NewsOperationError(
          'failed-precondition',
          'INELIGIBLE_EDITORIAL_IMAGE_ASSET_VARIANTS',
          `INELIGIBLE_EDITORIAL_IMAGE_ASSET_VARIANTS: Editorial image asset "${assetId}" is missing a valid variants map.`,
          {
            reasonCode: 'INELIGIBLE_EDITORIAL_IMAGE_ASSET_VARIANTS',
            assetId,
            locations,
          }
        );
      }

      for (const requiredKey of REQUIRED_EDITORIAL_IMAGE_VARIANT_KEYS) {
        const candidateVariant = variants[requiredKey];
        if (!candidateVariant) {
          throw new NewsOperationError(
            'failed-precondition',
            'INELIGIBLE_EDITORIAL_IMAGE_ASSET_VARIANTS',
            `INELIGIBLE_EDITORIAL_IMAGE_ASSET_VARIANTS: Editorial image asset "${assetId}" is missing required canonical variant "${requiredKey}".`,
            {
              reasonCode: 'INELIGIBLE_EDITORIAL_IMAGE_ASSET_VARIANTS',
              assetId,
              locations,
            }
          );
        }
        const variantCheck = validateEditorialImageAssetVariant(
          candidateVariant,
          requiredKey,
          DEFAULT_ASSET_VALIDATION_LIMITS,
          assetId
        );
        if (!variantCheck.valid) {
          throw new NewsOperationError(
            'failed-precondition',
            'INELIGIBLE_EDITORIAL_IMAGE_ASSET_VARIANTS',
            `INELIGIBLE_EDITORIAL_IMAGE_ASSET_VARIANTS: Editorial image asset "${assetId}" has invalid variant "${requiredKey}": ${redactSensitivePathsFromDiagnostic(variantCheck.errors.join('; '))}`,
            {
              reasonCode: 'INELIGIBLE_EDITORIAL_IMAGE_ASSET_VARIANTS',
              assetId,
              locations,
            }
          );
        }
      }

      const fullAssetCheck = validateEditorialImageAsset(
        asset,
        DEFAULT_ASSET_VALIDATION_LIMITS
      );
      if (!fullAssetCheck.valid) {
        throw new NewsOperationError(
          'failed-precondition',
          'INVALID_EDITORIAL_IMAGE_ASSET_RECORD',
          `INVALID_EDITORIAL_IMAGE_ASSET_RECORD: Editorial image asset "${assetId}" failed canonical contract validation: ${redactSensitivePathsFromDiagnostic(fullAssetCheck.errors.join('; '))}`,
          {
            reasonCode: 'INVALID_EDITORIAL_IMAGE_ASSET_RECORD',
            assetId,
            locations,
          }
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
    let deterministicId: string | null = null;
    if (input.createIdempotencyKey !== undefined) {
      if (
        typeof input.createIdempotencyKey !== 'string' ||
        !CREATE_DRAFT_IDEMPOTENCY_KEY_REGEX.test(input.createIdempotencyKey.trim())
      ) {
        throw new NewsOperationError(
          'invalid-argument',
          'VALIDATION_ERROR',
          'VALIDATION_ERROR: createIdempotencyKey must be a 16-96 character alphanumeric/hyphen/underscore token.'
        );
      }
      if (!actor?.uid || typeof actor.uid !== 'string' || actor.uid.trim().length === 0) {
        throw new NewsOperationError(
          'permission-denied',
          'PERMISSION_DENIED',
          'PERMISSION_DENIED: Authenticated actor UID is required for idempotent draft creation.'
        );
      }
      deterministicId = deriveDeterministicCreateDraftId(
        actor.uid.trim(),
        input.createIdempotencyKey.trim()
      );
      const existingByKey = await this.repo.getById(deterministicId);
      if (existingByKey) {
        return existingByKey;
      }
    }

    // Canonical environmental category is strictly required for new drafts
    NewsValidator.validateCanonicalCategory(input.category);

    const now = new Date().toISOString();
    // Server-authoritative ID generation: client-supplied document IDs are never accepted as authoritative.
    // When a validated createIdempotencyKey is supplied, the server deterministically derives an actor-scoped ID.
    const id =
      deterministicId ??
      `news-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

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

    const validatedRelatedVideoIds = await this.validateAndVerifyRelatedVideoIds(
      input.relatedVideoIds
    );

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
      relatedVideoIds: validatedRelatedVideoIds,
    };

    NewsValidator.validateNewsPayload(item);

    const imageRefs = collectArticleEditorialImageReferences(item);
    const locationsByAssetId = new Map<string, readonly EditorialImageLocationRole[]>(
      imageRefs.map((ref) => [ref.assetId, ref.locations])
    );
    await this.verifyNewlyIntroducedEditorialImageAssets(
      imageRefs.map((ref) => ref.assetId),
      locationsByAssetId
    );

    if (deterministicId && this.repo instanceof FirestoreNewsRepository) {
      const db = getFirestore();
      const docRef = db.collection(FirestoreNewsRepository.COLLECTION).doc(deterministicId);
      const committed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        if (snap.exists) {
          const data = snap.data();
          if (data) {
            return data as NewsItemBackend;
          }
        }
        tx.create(docRef, sanitizeForFirestore({ ...item }));
        return item;
      });
      return committed;
    }

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

    const nextRelatedVideoIds =
      'relatedVideoIds' in input && input.relatedVideoIds !== undefined
        ? await this.validateAndVerifyRelatedVideoIds(input.relatedVideoIds)
        : Array.isArray(existing.relatedVideoIds)
          ? [...existing.relatedVideoIds]
          : [];

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
      relatedVideoIds: nextRelatedVideoIds,
      updatedAt: now,
      author: existing.author || input.author || actor.name,
      workflowState: existing.workflowState,
      history: existing.history,
      createdAt: existing.createdAt,
      publishedAt: existing.publishedAt,
    };

    NewsValidator.validateNewsPayload(updated);

    const existingPersistedAssetIds = new Set(
      collectAllArticleEditorialImageAssetIds(
        existing.featuredImage,
        existing.richBodyAr,
        existing.richBodyEn
      )
    );
    const effectiveNextRefs = collectArticleEditorialImageReferences(updated);
    const locationsByAssetId = new Map<string, readonly EditorialImageLocationRole[]>(
      effectiveNextRefs.map((ref) => [ref.assetId, ref.locations])
    );
    const newlyIntroducedAssetIds = effectiveNextRefs
      .map((ref) => ref.assetId)
      .filter((assetId) => !existingPersistedAssetIds.has(assetId));
    await this.verifyNewlyIntroducedEditorialImageAssets(
      newlyIntroducedAssetIds,
      locationsByAssetId
    );

    await this.repo.save(updated);
    return updated;
  }

  /**
   * Authoritatively verifies that every managed canonical editorial image asset
   * referenced by the persisted article (`featuredImage`, `richBodyAr`, and `richBodyEn`)
   * exists in `EditorialImageAssetRepository` and satisfies the canonical public article
   * rights eligibility contract (`isEditorialImageAssetEligibleForPublicArticle`)
   * before the article is allowed to transition to `Published`.
   * Legacy safe HTTP(S) cover URLs are distinguished from canonical assetIds and preserved.
   */
  private async verifyEditorialImageAssetsForPublication(
    article: NewsItemBackend
  ): Promise<void> {
    const referencedAssets = collectArticleEditorialImageReferences(article);

    if (referencedAssets.length === 0) {
      return;
    }

    if (!this.assetRepo) {
      const firstRef = referencedAssets[0];
      throw new NewsOperationError(
        'failed-precondition',
        EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE,
        `${EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE}: [ASSET_REPO_MISSING] EditorialImageAssetRepository is required to verify publication eligibility for editorial image asset "${firstRef.assetId}" (${firstRef.locations.join(',')}) on article "${article.id}".`,
        {
          reasonCode: EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE,
          subReasonCode: 'ASSET_REPO_MISSING',
          assetId: firstRef.assetId,
          locations: firstRef.locations,
          articleId: article.id,
        }
      );
    }

    for (const ref of referencedAssets) {
      const { assetId, locations } = ref;
      const roleLabel = locations.join(',');
      let readResult;
      try {
        readResult = await this.assetRepo.getById(assetId);
      } catch (err: unknown) {
        if (
          err instanceof EditorialImageAssetRepositoryError &&
          err.code === 'INVALID_ASSET'
        ) {
          throw new NewsOperationError(
            'failed-precondition',
            EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE,
            `${EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE}: [INVALID_ASSET_RECORD] Editorial image asset "${assetId}" (${roleLabel}) referenced by article "${article.id}" has an invalid or corrupted repository record.`,
            {
              reasonCode: EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE,
              subReasonCode: 'INVALID_ASSET_RECORD',
              assetId,
              locations,
              articleId: article.id,
            }
          );
        }
        const safeDetail =
          err instanceof Error
            ? redactSensitivePathsFromDiagnostic(err.message)
            : 'Unknown asset repository error.';
        throw new NewsOperationError(
          'failed-precondition',
          EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE,
          `${EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE}: [ASSET_REPOSITORY_ERROR] Failed to read editorial image asset "${assetId}" (${roleLabel}) for article "${article.id}": ${safeDetail}`,
          {
            reasonCode: EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE,
            subReasonCode: 'ASSET_REPOSITORY_ERROR',
            assetId,
            locations,
            articleId: article.id,
          }
        );
      }

      if (
        !readResult ||
        readResult.ok !== true ||
        readResult.status !== 'FOUND' ||
        !readResult.asset
      ) {
        throw new NewsOperationError(
          'failed-precondition',
          EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE,
          `${EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE}: [ASSET_NOT_FOUND] Editorial image asset "${assetId}" (${roleLabel}) referenced by article "${article.id}" does not exist in the canonical asset repository.`,
          {
            reasonCode: EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE,
            subReasonCode: 'ASSET_NOT_FOUND',
            assetId,
            locations,
            articleId: article.id,
          }
        );
      }

      const asset = readResult.asset;
      if (
        !asset ||
        typeof asset !== 'object' ||
        Array.isArray(asset) ||
        asset.assetId !== assetId
      ) {
        throw new NewsOperationError(
          'failed-precondition',
          EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE,
          `${EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE}: [INVALID_ASSET_RECORD] Editorial image asset "${assetId}" (${roleLabel}) referenced by article "${article.id}" has a malformed or mismatched asset envelope.`,
          {
            reasonCode: EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE,
            subReasonCode: 'INVALID_ASSET_RECORD',
            assetId,
            locations,
            articleId: article.id,
          }
        );
      }

      if (!isEditorialImageAssetEligibleForPublicArticle(asset, article.id)) {
        const reason = describePublicationIneligibilityReason(asset, article.id);
        throw new NewsOperationError(
          'failed-precondition',
          EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE,
          `${EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE}: ${reason.message} [roles=${roleLabel}]`,
          {
            reasonCode: EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE,
            subReasonCode: reason.subReasonCode,
            assetId,
            locations,
            articleId: article.id,
          }
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

  /**
   * Completes the editorial handoff from an AcceptedForEditorial citizen submission into a canonical News Draft.
   * - Human authorized action.
   * - Verifies submission exists and is in AcceptedForEditorial status.
   * - Idempotent: returns existing draft if submission already has an editorialReferenceId pointing to an existing draft.
   * - Atomic Firestore transaction writes draft and updates submission's editorialReferenceId.
   * - Safe field mapping: canonical category, titleAr/titleEn, summaryAr/summaryEn, bodyAr/bodyEn, kickerAr/kickerEn, journalisticType, author.
   * - Private evidence attachments remain private (never in featuredImage or public fields).
   */
  async createDraftFromCitizenSubmission(
    submissionId: string,
    actor: ActorContext,
    communityRepo?: CommunityRepository
  ): Promise<{ item: NewsItemBackend; alreadyExisted: boolean }> {
    const cleanSubId = (submissionId || '').trim();
    if (!cleanSubId) {
      throw new Error('INVALID_ARGUMENT: Submission ID is required.');
    }

    const effectiveCommunityRepo = communityRepo || this.communityRepo || new FirestoreCommunityRepository();

    // Check if Firestore transaction is supported in the current environment
    let db: any = null;
    try {
      db = getFirestore();
    } catch {
      db = null;
    }

    if (db && typeof db.runTransaction === 'function') {
      const newsCol = db.collection(FirestoreNewsRepository.COLLECTION);
      const subCol = db.collection(FirestoreCommunityRepository.COLLECTION);
      const subRef = subCol.doc(cleanSubId);

      return await db.runTransaction(async (transaction: any) => {
        const subSnap = await transaction.get(subRef);
        if (!subSnap.exists) {
          throw new Error(`NOT_FOUND: Citizen submission '${cleanSubId}' not found`);
        }
        const subData = subSnap.data() as CitizenSubmissionBackend;

        if (subData.status !== 'AcceptedForEditorial') {
          throw new Error(
            `FAILED_PRECONDITION: Submission must be in AcceptedForEditorial status to create a news draft (current status: ${subData.status})`
          );
        }

        // Idempotency: If editorialReferenceId already exists and points to an existing news item, return it
        if (subData.editorialReferenceId && subData.editorialReferenceId.trim()) {
          const existingNewsRef = newsCol.doc(subData.editorialReferenceId.trim());
          const existingNewsSnap = await transaction.get(existingNewsRef);
          if (existingNewsSnap.exists) {
            return {
              item: existingNewsSnap.data() as NewsItemBackend,
              alreadyExisted: true,
            };
          }
        }

        const canonicalCategory = mapCitizenCategoryToNewsCategory(subData.category);
        NewsValidator.validateCanonicalCategory(canonicalCategory);

        const now = new Date().toISOString();
        const draftId = `news-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const newsRef = newsCol.doc(draftId);

        const summaryAr = subData.sourceLanguage === 'ar' ? subData.body.slice(0, 300) : '';
        const summaryEn = subData.sourceLanguage === 'en' ? subData.body.slice(0, 300) : '';
        const bodyAr = subData.sourceLanguage === 'ar' ? subData.body : '';
        const bodyEn = subData.sourceLanguage === 'en' ? subData.body : '';
        const titleAr = subData.title;
        const titleEn = subData.sourceLanguage === 'en' ? subData.title : '';

        const author = subData.contributorName
          ? `مواطن صحفي: ${subData.contributorName}`
          : actor.name;

        const sourceAttribution = subData.contributorName
          ? `Citizen Report: ${subData.contributorName} (${subData.id})`
          : `Citizen Report: ${subData.id}`;

        const draftItem: NewsItemBackend = {
          id: draftId,
          titleAr,
          titleEn,
          kickerAr: 'صحافة المواطن',
          kickerEn: 'Citizen Journalism',
          journalisticType: 'Report',
          summaryAr,
          summaryEn,
          bodyAr,
          bodyEn,
          author,
          category: canonicalCategory,
          tags: ['citizen-journalism', canonicalCategory.toLowerCase()],
          sources: [sourceAttribution],
          featuredImage: undefined, // Private evidence attachments remain private
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
              comment: `Draft created from citizen submission ${subData.id}`,
            },
          ],
          location: subData.locationDescription || undefined,
          urgencyLevel: 'Standard',
          relatedVideoIds: [],
        };

        NewsValidator.validateNewsPayload(draftItem);

        transaction.set(newsRef, sanitizeForFirestore(draftItem));
        transaction.update(subRef, {
          editorialReferenceId: draftId,
          updatedAt: now,
        });

        return {
          item: draftItem,
          alreadyExisted: false,
        };
      });
    }

    // Fallback for in-memory or non-Firestore environments (e.g., test harnesses)
    const sub = await effectiveCommunityRepo.getById(cleanSubId);
    if (!sub) {
      throw new Error(`NOT_FOUND: Citizen submission '${cleanSubId}' not found`);
    }
    if (sub.status !== 'AcceptedForEditorial') {
      throw new Error(
        `FAILED_PRECONDITION: Submission must be in AcceptedForEditorial status to create a news draft (current status: ${sub.status})`
      );
    }
    if (sub.editorialReferenceId && sub.editorialReferenceId.trim()) {
      const existing = await this.repo.getById(sub.editorialReferenceId.trim());
      if (existing) {
        return { item: existing, alreadyExisted: true };
      }
    }

    const canonicalCategory = mapCitizenCategoryToNewsCategory(sub.category);
    NewsValidator.validateCanonicalCategory(canonicalCategory);

    const now = new Date().toISOString();
    const draftId = `news-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const summaryAr = sub.sourceLanguage === 'ar' ? sub.body.slice(0, 300) : '';
    const summaryEn = sub.sourceLanguage === 'en' ? sub.body.slice(0, 300) : '';
    const bodyAr = sub.sourceLanguage === 'ar' ? sub.body : '';
    const bodyEn = sub.sourceLanguage === 'en' ? sub.body : '';
    const titleAr = sub.title;
    const titleEn = sub.sourceLanguage === 'en' ? sub.title : '';

    const author = sub.contributorName
      ? `مواطن صحفي: ${sub.contributorName}`
      : actor.name;

    const sourceAttribution = sub.contributorName
      ? `Citizen Report: ${sub.contributorName} (${sub.id})`
      : `Citizen Report: ${sub.id}`;

    const draftItem: NewsItemBackend = {
      id: draftId,
      titleAr,
      titleEn,
      kickerAr: 'صحافة المواطن',
      kickerEn: 'Citizen Journalism',
      journalisticType: 'Report',
      summaryAr,
      summaryEn,
      bodyAr,
      bodyEn,
      author,
      category: canonicalCategory,
      tags: ['citizen-journalism', canonicalCategory.toLowerCase()],
      sources: [sourceAttribution],
      featuredImage: undefined,
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
          comment: `Draft created from citizen submission ${sub.id}`,
        },
      ],
      location: sub.locationDescription || undefined,
      urgencyLevel: 'Standard',
      relatedVideoIds: [],
    };

    NewsValidator.validateNewsPayload(draftItem);
    await this.repo.save(draftItem);
    await effectiveCommunityRepo.save({
      ...sub,
      editorialReferenceId: draftId,
      updatedAt: now,
    });

    return { item: draftItem, alreadyExisted: false };
  }
}

