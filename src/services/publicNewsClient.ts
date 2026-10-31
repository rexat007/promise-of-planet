import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, isFirebaseConfigured } from './firebase';
import { type ImageObject, type News, isCanonicalCategory } from '../types';
import {
  PUBLIC_EDITORIAL_IMAGE_VARIANT_KEYS,
  type PublicArticleCoverSource,
  type PublicEditorialCoverMetadata,
  type PublicEditorialImageVariantKey,
  type PublicNewsArticle,
} from '../types/news';
import type {
  BlockNodeV2,
  EditorialImageNodeV2,
  RichNewsDocument,
  RichNewsDocumentWrapperV2,
} from '../types/richNewsDocument';
import { validateAssetId } from './editorialImageAssetContract';
import { publicDtoToCanonicalNews } from './newsDomainAdapter';
import type { SanitizedPublicNewsDTO } from './newsDomainAdapter';
import {
  validateRichNewsDocumentByVersion,
  validateRichNewsDocumentV2,
} from './richNewsDocumentContract';

export interface PublicNewsFilterOptions {
  searchQuery?: string;
  category?: string; // 'all' or canonical category
  sortBy?: 'recent' | 'relevant';
  language?: 'ar' | 'en';
}

export interface SanitizedPublicNewsDTOWithCover extends SanitizedPublicNewsDTO {
  readonly richBodyAr?: unknown;
  readonly richBodyEn?: unknown;
  readonly coverImage?: {
    readonly assetId?: string;
    readonly url?: string;
    readonly source: PublicArticleCoverSource;
    readonly sourceLocale?: 'ar' | 'en';
    readonly altAr: string;
    readonly altEn?: string;
    readonly captionAr?: string;
    readonly captionEn?: string;
  };
}

export type PublicNewsTransport = (data: {
  lang?: 'ar' | 'en';
}) => Promise<{ articles: SanitizedPublicNewsDTOWithCover[] }>;

const SAFE_ARTICLE_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
const ALLOWED_PUBLIC_VARIANT_SET: ReadonlySet<string> = new Set(
  PUBLIC_EDITORIAL_IMAGE_VARIANT_KEYS
);

let customPublicTransport: PublicNewsTransport | null = null;
let customPublicImageDeliveryEndpointUrl: string | null | undefined = undefined;

function resolveEnvRecord(): Record<string, unknown> {
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return import.meta.env as unknown as Record<string, unknown>;
  }
  if (typeof globalThis !== 'undefined' && 'process' in globalThis) {
    return (
      (globalThis as { process?: { env?: Record<string, unknown> } }).process
        ?.env || {}
    );
  }
  return {};
}

export function isPublicEditorialImageVariantKey(
  value: unknown
): value is PublicEditorialImageVariantKey {
  return typeof value === 'string' && ALLOWED_PUBLIC_VARIANT_SET.has(value);
}

/**
 * Validates that a candidate public editorial image delivery endpoint base URL
 * is an explicitly configured HTTPS URL (or http://localhost / http://127.0.0.1
 * for local development) with no query parameters, fragments, credentials, or whitespace.
 * Never guesses or constructs a Cloud Functions URL from a project ID or region.
 */
export function isValidPublicImageDeliveryEndpointUrl(
  rawUrl: unknown
): rawUrl is string {
  if (typeof rawUrl !== 'string') {
    return false;
  }
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed !== rawUrl || /\s/.test(trimmed)) {
    return false;
  }
  if (trimmed.includes('?') || trimmed.includes('#')) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.username || parsed.password) {
      return false;
    }
    if (parsed.protocol === 'https:') {
      return Boolean(parsed.hostname && parsed.hostname.length > 0);
    }
    if (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function isSafePublicHttpImageUrl(rawUrl: unknown): rawUrl is string {
  if (typeof rawUrl !== 'string') {
    return false;
  }
  const trimmed = rawUrl.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.username || parsed.password) {
      return false;
    }
    if (parsed.protocol === 'https:') {
      return Boolean(parsed.hostname && parsed.hostname.length > 0);
    }
    if (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function extractOrderedEditorialImagesFromDocument(
  richDoc: unknown
): EditorialImageNodeV2[] {
  if (!richDoc || typeof richDoc !== 'object' || Array.isArray(richDoc)) {
    return [];
  }
  const wrapper = richDoc as Record<string, unknown>;
  if (wrapper.schemaVersion !== 2) {
    return [];
  }
  if (!validateRichNewsDocumentV2(richDoc).valid) {
    return [];
  }
  const v2 = richDoc as RichNewsDocumentWrapperV2;
  const nodes: EditorialImageNodeV2[] = [];

  function walk(blocks: readonly BlockNodeV2[]): void {
    for (const block of blocks) {
      if (!block || typeof block !== 'object') {
        continue;
      }
      if (block.type === 'editorialImage') {
        if (
          block.attrs &&
          typeof block.attrs.assetId === 'string' &&
          validateAssetId(block.attrs.assetId).valid
        ) {
          nodes.push({
            type: 'editorialImage',
            attrs: { ...block.attrs },
          });
        }
        continue;
      }
      if ('content' in block && Array.isArray(block.content)) {
        walk(block.content as readonly BlockNodeV2[]);
      }
    }
  }

  walk(v2.doc.content);
  return nodes;
}

export class PublicNewsClient {
  /**
   * Injects an isolated transport function (used for automated testing without live network mutation).
   */
  public static setTransport(transport: PublicNewsTransport | null): void {
    customPublicTransport = transport;
  }

  /**
   * Injects or resets a custom public editorial image delivery endpoint URL for testing.
   * Pass `undefined` to restore reading from `VITE_PUBLIC_EDITORIAL_IMAGE_DELIVERY_URL`.
   */
  public static setPublicImageDeliveryEndpointUrl(
    endpointUrl: string | null | undefined
  ): void {
    customPublicImageDeliveryEndpointUrl = endpointUrl;
  }

  /**
   * Resolves the explicitly configured public editorial image delivery endpoint URL
   * (`VITE_PUBLIC_EDITORIAL_IMAGE_DELIVERY_URL`).
   * Never guesses or invents a Cloud Functions URL.
   */
  public static getConfiguredPublicImageDeliveryEndpointUrl(): string | null {
    if (customPublicImageDeliveryEndpointUrl !== undefined) {
      return isValidPublicImageDeliveryEndpointUrl(
        customPublicImageDeliveryEndpointUrl
      )
        ? customPublicImageDeliveryEndpointUrl
        : null;
    }

    const env = resolveEnvRecord();
    const candidate = env.VITE_PUBLIC_EDITORIAL_IMAGE_DELIVERY_URL ?? null;
    return isValidPublicImageDeliveryEndpointUrl(candidate) ? candidate : null;
  }

  /**
   * Builds a deterministic public editorial image delivery GET URL for an authorized
   * `(articleId, assetId, variant)` tuple.
   * Explicitly denies `original_processed` and returns `null` when parameters are invalid
   * or when the public delivery endpoint URL is not configured.
   */
  public static buildPublicEditorialImageDeliveryUrl(
    articleId: string,
    assetId: string,
    variant: PublicEditorialImageVariantKey,
    baseEndpointUrl?: string | null
  ): string | null {
    if (
      typeof articleId !== 'string' ||
      articleId.trim().length === 0 ||
      articleId !== articleId.trim() ||
      !SAFE_ARTICLE_ID_REGEX.test(articleId)
    ) {
      return null;
    }

    if (
      typeof assetId !== 'string' ||
      assetId.trim().length === 0 ||
      assetId !== assetId.trim() ||
      !validateAssetId(assetId).valid
    ) {
      return null;
    }

    if (!isPublicEditorialImageVariantKey(variant)) {
      return null;
    }

    const resolvedBase =
      baseEndpointUrl !== undefined
        ? isValidPublicImageDeliveryEndpointUrl(baseEndpointUrl)
          ? baseEndpointUrl
          : null
        : this.getConfiguredPublicImageDeliveryEndpointUrl();

    if (!resolvedBase) {
      return null;
    }

    try {
      const url = new URL(resolvedBase);
      url.search = '';
      url.hash = '';
      url.searchParams.set('articleId', articleId);
      url.searchParams.set('assetId', assetId);
      url.searchParams.set('variant', variant);
      return url.toString();
    } catch {
      return null;
    }
  }

  /**
   * Builds the full map of allowed public delivery variant URLs for an `(articleId, assetId)` pair.
   */
  public static buildPublicEditorialImageVariantUrls(
    articleId: string,
    assetId: string,
    baseEndpointUrl?: string | null
  ): {
    readonly thumbnail?: string;
    readonly card?: string;
    readonly article_inline?: string;
    readonly article_cover?: string;
  } {
    const thumbnail =
      this.buildPublicEditorialImageDeliveryUrl(
        articleId,
        assetId,
        'thumbnail',
        baseEndpointUrl
      ) ?? undefined;
    const card =
      this.buildPublicEditorialImageDeliveryUrl(
        articleId,
        assetId,
        'card',
        baseEndpointUrl
      ) ?? undefined;
    const article_inline =
      this.buildPublicEditorialImageDeliveryUrl(
        articleId,
        assetId,
        'article_inline',
        baseEndpointUrl
      ) ?? undefined;
    const article_cover =
      this.buildPublicEditorialImageDeliveryUrl(
        articleId,
        assetId,
        'article_cover',
        baseEndpointUrl
      ) ?? undefined;

    return {
      ...(thumbnail ? { thumbnail } : {}),
      ...(card ? { card } : {}),
      ...(article_inline ? { article_inline } : {}),
      ...(article_cover ? { article_cover } : {}),
    };
  }

  /**
   * Converts a sanitized public DTO from the backend into a `PublicNewsArticle`
   * preserving `richBodyAr`, `richBodyEn`, and cover metadata (`coverImage`),
   * and normalizing `featuredImage` so raw `assetId` strings are never exposed as
   * broken relative image URLs.
   */
  public static toPublicNewsArticle(
    dto: SanitizedPublicNewsDTOWithCover
  ): PublicNewsArticle {
    const baseNews = publicDtoToCanonicalNews(dto);

    const richBodyAr: RichNewsDocument | undefined =
      dto.richBodyAr && validateRichNewsDocumentByVersion(dto.richBodyAr).valid
        ? (dto.richBodyAr as RichNewsDocument)
        : undefined;
    const richBodyEn: RichNewsDocument | undefined =
      dto.richBodyEn && validateRichNewsDocumentByVersion(dto.richBodyEn).valid
        ? (dto.richBodyEn as RichNewsDocument)
        : undefined;

    const arImages = extractOrderedEditorialImagesFromDocument(richBodyAr);
    const enImages = extractOrderedEditorialImagesFromDocument(richBodyEn);

    let resolvedCoverMeta: PublicEditorialCoverMetadata | undefined;

    if (dto.coverImage && typeof dto.coverImage === 'object') {
      const serverCover = dto.coverImage;
      if (
        serverCover.assetId &&
        validateAssetId(serverCover.assetId).valid
      ) {
        const variants = this.buildPublicEditorialImageVariantUrls(
          dto.id,
          serverCover.assetId
        );
        resolvedCoverMeta = {
          assetId: serverCover.assetId,
          ...(variants.article_cover || variants.card
            ? { url: variants.article_cover ?? variants.card }
            : {}),
          source: serverCover.source,
          ...(serverCover.sourceLocale
            ? { sourceLocale: serverCover.sourceLocale }
            : {}),
          altAr: serverCover.altAr || dto.titleAr,
          altEn:
            serverCover.altEn ||
            dto.titleEn ||
            serverCover.altAr ||
            dto.titleAr,
          ...(serverCover.captionAr
            ? { captionAr: serverCover.captionAr }
            : {}),
          ...(serverCover.captionEn
            ? { captionEn: serverCover.captionEn }
            : {}),
          variants,
        };
      } else if (
        serverCover.url &&
        isSafePublicHttpImageUrl(serverCover.url)
      ) {
        resolvedCoverMeta = {
          url: serverCover.url,
          source: 'explicit',
          altAr: serverCover.altAr || dto.titleAr,
          altEn:
            serverCover.altEn ||
            dto.titleEn ||
            serverCover.altAr ||
            dto.titleAr,
          ...(serverCover.captionAr
            ? { captionAr: serverCover.captionAr }
            : {}),
          ...(serverCover.captionEn
            ? { captionEn: serverCover.captionEn }
            : {}),
          variants: {
            thumbnail: serverCover.url,
            card: serverCover.url,
            article_inline: serverCover.url,
            article_cover: serverCover.url,
          },
        };
      }
    } else if (
      typeof dto.featuredImage === 'string' &&
      dto.featuredImage.trim().length > 0
    ) {
      const rawFeatured = dto.featuredImage.trim();
      if (validateAssetId(rawFeatured).valid) {
        const firstAr = arImages[0];
        const firstEn = arImages.length === 0 ? enImages[0] : undefined;
        const firstInline = firstAr ?? firstEn;
        const matchingInline =
          arImages.find((img) => img.attrs.assetId === rawFeatured) ??
          enImages.find((img) => img.attrs.assetId === rawFeatured);

        const isDerivedFromFirstInline =
          firstInline !== undefined &&
          firstInline.attrs.assetId === rawFeatured;
        const sourceLocale: 'ar' | 'en' | undefined = isDerivedFromFirstInline
          ? firstAr
            ? 'ar'
            : 'en'
          : undefined;

        const variants = this.buildPublicEditorialImageVariantUrls(
          dto.id,
          rawFeatured
        );
        const altAr = matchingInline?.attrs.altAr || dto.titleAr;
        const altEn =
          matchingInline?.attrs.altEn ||
          dto.titleEn ||
          matchingInline?.attrs.altAr ||
          dto.titleAr;

        resolvedCoverMeta = {
          assetId: rawFeatured,
          ...(variants.article_cover || variants.card
            ? { url: variants.article_cover ?? variants.card }
            : {}),
          source: isDerivedFromFirstInline
            ? 'derived_first_inline'
            : 'explicit',
          ...(sourceLocale ? { sourceLocale } : {}),
          altAr,
          altEn,
          ...(matchingInline?.attrs.captionAr
            ? { captionAr: matchingInline.attrs.captionAr }
            : {}),
          ...(matchingInline?.attrs.captionEn
            ? { captionEn: matchingInline.attrs.captionEn }
            : {}),
          variants,
        };
      } else if (isSafePublicHttpImageUrl(rawFeatured)) {
        resolvedCoverMeta = {
          url: rawFeatured,
          source: 'explicit',
          altAr: dto.titleAr,
          altEn: dto.titleEn || dto.titleAr,
          ...(dto.summaryAr ? { captionAr: dto.summaryAr } : {}),
          ...(dto.summaryEn ? { captionEn: dto.summaryEn } : {}),
          variants: {
            thumbnail: rawFeatured,
            card: rawFeatured,
            article_inline: rawFeatured,
            article_cover: rawFeatured,
          },
        };
      }
    }

    const cardOrCoverUrl =
      resolvedCoverMeta?.variants?.card ??
      resolvedCoverMeta?.variants?.article_cover ??
      resolvedCoverMeta?.url;

    const normalizedFeaturedImage: ImageObject | undefined =
      resolvedCoverMeta &&
      cardOrCoverUrl &&
      isSafePublicHttpImageUrl(cardOrCoverUrl)
        ? {
            url: cardOrCoverUrl,
            altAr: resolvedCoverMeta.altAr || dto.titleAr,
            altEn:
              resolvedCoverMeta.altEn ||
              dto.titleEn ||
              resolvedCoverMeta.altAr ||
              dto.titleAr,
            captionAr: resolvedCoverMeta.captionAr,
            captionEn: resolvedCoverMeta.captionEn,
          }
        : undefined;

    return {
      ...baseNews,
      featuredImage: normalizedFeaturedImage,
      ...(richBodyAr ? { richBodyAr } : {}),
      ...(richBodyEn ? { richBodyEn } : {}),
      ...(resolvedCoverMeta ? { coverImage: resolvedCoverMeta } : {}),
    };
  }

  /**
   * Resolves the URL for a specific public cover variant (`card`, `article_cover`, `thumbnail`, `article_inline`)
   * from a `News` or `PublicNewsArticle` item.
   * Returns `null` if the article has no cover or if the delivery endpoint is unconfigured.
   */
  public static resolveCoverVariantUrl(
    article: News | PublicNewsArticle,
    preferredVariant: PublicEditorialImageVariantKey = 'card'
  ): string | null {
    const publicArticle = article as PublicNewsArticle;
    const coverMeta = publicArticle.coverImage;

    if (coverMeta) {
      const fromVariants = coverMeta.variants?.[preferredVariant];
      if (fromVariants && isSafePublicHttpImageUrl(fromVariants)) {
        return fromVariants;
      }
      if (coverMeta.assetId && validateAssetId(coverMeta.assetId).valid) {
        const dynamicUrl = this.buildPublicEditorialImageDeliveryUrl(
          article.id,
          coverMeta.assetId,
          preferredVariant
        );
        if (dynamicUrl) {
          return dynamicUrl;
        }
      }
      if (coverMeta.url && isSafePublicHttpImageUrl(coverMeta.url)) {
        return coverMeta.url;
      }
      return null;
    }

    const rawFeaturedUrl = article.featuredImage?.url?.trim() || '';
    if (!rawFeaturedUrl) {
      return null;
    }

    if (validateAssetId(rawFeaturedUrl).valid) {
      return this.buildPublicEditorialImageDeliveryUrl(
        article.id,
        rawFeaturedUrl,
        preferredVariant
      );
    }

    if (isSafePublicHttpImageUrl(rawFeaturedUrl)) {
      return rawFeaturedUrl;
    }

    return null;
  }

  /**
   * Normalizes a `News` or `PublicNewsArticle` item for card rendering (`ContentCard` / `NewsCard`),
   * ensuring `featuredImage` uses the `card` variant URL when available and is `undefined`
   * when no valid URL exists.
   */
  public static normalizeNewsForCard(
    article: News | PublicNewsArticle,
    preferredVariant: PublicEditorialImageVariantKey = 'card'
  ): PublicNewsArticle {
    const publicArticle = article as PublicNewsArticle;
    const resolvedUrl = this.resolveCoverVariantUrl(article, preferredVariant);

    if (!resolvedUrl) {
      return {
        ...publicArticle,
        featuredImage: undefined,
      };
    }

    const coverMeta = publicArticle.coverImage;
    const existingFeatured = article.featuredImage;

    return {
      ...publicArticle,
      featuredImage: {
        url: resolvedUrl,
        altAr: coverMeta?.altAr || existingFeatured?.altAr || article.titleAr,
        altEn:
          coverMeta?.altEn ||
          existingFeatured?.altEn ||
          article.titleEn ||
          article.titleAr,
        captionAr: coverMeta?.captionAr ?? existingFeatured?.captionAr,
        captionEn: coverMeta?.captionEn ?? existingFeatured?.captionEn,
      },
    };
  }

  /**
   * Generates a semantic slug from title for URL/sharing.
   */
  public static getSlug(title: string): string {
    return (title || '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\u0600-\u06FFa-z0-9-]/g, '')
      .replace(/-+/g, '-');
  }

  /**
   * Retrieves all published, approved news articles for the public hub.
   * Connects via callable Firebase function getPublicNews.
   * Strictly enforces that only server-returned, sanitized, Published articles are returned.
   */
  public static async listPublishedNews(
    options: PublicNewsFilterOptions = {}
  ): Promise<PublicNewsArticle[]> {
    let dtos: SanitizedPublicNewsDTOWithCover[] = [];

    if (customPublicTransport) {
      const res = await customPublicTransport({
        lang: options.language || 'ar',
      });
      dtos = res.articles || [];
    } else {
      if (!isFirebaseConfigured || !app) {
        throw new Error(
          'BACKEND_UNAVAILABLE: Firebase backend is not configured.'
        );
      }
      try {
        const fns = getFunctions(app);
        const callable = httpsCallable<
          { lang?: 'ar' | 'en' },
          { articles: SanitizedPublicNewsDTOWithCover[] }
        >(fns, 'getPublicNews');
        const res = await callable({ lang: options.language || 'ar' });
        dtos = res.data?.articles || [];
      } catch (err) {
        console.error('Failed to fetch public news from server:', err);
        throw new Error(
          'BACKEND_UNAVAILABLE: Failed to retrieve public news from server.'
        );
      }
    }

    // Convert server DTO to canonical PublicNewsArticle model
    let canonicalItems: PublicNewsArticle[] = dtos.map((dto) =>
      this.toPublicNewsArticle(dto)
    );

    // Language availability filter:
    if (options.language) {
      canonicalItems = canonicalItems.filter((item) => {
        if (options.language === 'en') {
          return Boolean(item.titleEn || item.titleAr);
        }
        return Boolean(item.titleAr);
      });
    }

    // Category filter: exact canonical key match, non-canonical filter returns empty list
    if (options.category && options.category !== 'all') {
      const filterCat = options.category;
      if (!isCanonicalCategory(filterCat)) {
        return [];
      }
      canonicalItems = canonicalItems.filter(
        (item) => item.category === filterCat
      );
    }

    // Search query filter
    if (options.searchQuery && options.searchQuery.trim() !== '') {
      const q = options.searchQuery.toLowerCase().trim();
      canonicalItems = canonicalItems.filter((item) => {
        const titleAr = (item.titleAr || '').toLowerCase();
        const titleEn = (item.titleEn || '').toLowerCase();
        const excerptAr = (item.excerptAr || '').toLowerCase();
        const excerptEn = (item.excerptEn || '').toLowerCase();
        const contentAr = (item.contentAr || '').toLowerCase();
        const contentEn = (item.contentEn || '').toLowerCase();
        const author = (item.author || '').toLowerCase();

        return (
          titleAr.includes(q) ||
          titleEn.includes(q) ||
          excerptAr.includes(q) ||
          excerptEn.includes(q) ||
          contentAr.includes(q) ||
          contentEn.includes(q) ||
          author.includes(q)
        );
      });
    }

    // Sort by publication date (descending by default)
    canonicalItems.sort((a, b) => {
      const dateA = new Date(a.publishedAt || a.createdAt).getTime();
      const dateB = new Date(b.publishedAt || b.createdAt).getTime();
      return dateB - dateA;
    });

    return canonicalItems;
  }

  /**
   * Retrieves a single published article by ID or slug.
   */
  public static async getPublishedArticle(
    idOrSlug: string
  ): Promise<PublicNewsArticle | null> {
    const published = await this.listPublishedNews();
    const match = published.find((item) => {
      const matchesId = item.id === idOrSlug;
      const slugAr = this.getSlug(item.titleAr);
      const slugEn = item.titleEn ? this.getSlug(item.titleEn) : '';
      return matchesId || slugAr === idOrSlug || slugEn === idOrSlug;
    });
    return match || null;
  }
}
