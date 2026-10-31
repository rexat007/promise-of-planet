import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Container } from '../layout/Container';
import {
  Search,
  Calendar,
  Share2,
  ArrowLeft,
  ArrowRight,
  AlertCircle,
  Check,
  MapPin,
  User,
  Newspaper,
  ImageOff,
} from 'lucide-react';
import {
  NewsCard,
  ContentSourceList,
  getUrgencyLabel,
} from '../content';
import {
  PublicNewsClient,
  extractOrderedEditorialImagesFromDocument,
} from '../../services/publicNewsClient';
import { validateRichNewsDocumentByVersion } from '../../services/richNewsDocumentContract';
import { useDebounce } from '../../hooks/useDebounce';
import { CANONICAL_CATEGORY_DEFINITIONS } from '../../types';
import type { News, Language, JournalisticType } from '../../types';
import type { PublicNewsArticle } from '../../types/news';
import type {
  Alignment,
  BlockNode,
  BlockNodeV2,
  EditorialImageNodeV2,
  ImageLayoutV2,
  ImageWidthV2,
  InlineNode,
  Mark,
  RichNewsDocument,
  TextDirection,
} from '../../types/richNewsDocument';

const PUBLIC_JOURNALISTIC_TYPE_LABELS: Readonly<
  Record<JournalisticType, { ar: string; en: string }>
> = {
  News: { ar: 'خبر', en: 'News' },
  Report: { ar: 'تقرير', en: 'Report' },
  Article: { ar: 'مقال', en: 'Article' },
  Investigation: { ar: 'تحقيق استقصائي', en: 'Investigation' },
  Interview: { ar: 'مقابلة', en: 'Interview' },
  Analysis: { ar: 'تحليل', en: 'Analysis' },
  Opinion: { ar: 'مقال رأي', en: 'Opinion' },
  Explainer: { ar: 'مادة تفسيرية', en: 'Explainer' },
  Feature: { ar: 'قصة معمقة', en: 'Feature' },
};

function getLocalizedKickerForArticle(
  article: News,
  isAr: boolean
): string | undefined {
  const isDisplayingEnglishTitle = !isAr && Boolean(article.titleEn);
  const candidate = isDisplayingEnglishTitle
    ? article.kickerEn
    : article.kickerAr;
  const trimmed = candidate?.trim();
  return trimmed ? trimmed : undefined;
}

function isSafeArticleLinkHref(href: unknown): href is string {
  if (typeof href !== 'string') {
    return false;
  }
  const trimmed = href.trim();
  if (!trimmed) {
    return false;
  }
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('file:') ||
    lower.startsWith('blob:')
  ) {
    return false;
  }
  return (
    lower.startsWith('https://') ||
    lower.startsWith('http://') ||
    lower.startsWith('mailto:') ||
    lower.startsWith('/') ||
    lower.startsWith('#')
  );
}

function getAlignmentClassName(align?: Alignment): string {
  switch (align) {
    case 'right':
      return 'text-right';
    case 'left':
      return 'text-left';
    case 'center':
      return 'text-center';
    case 'justify':
      return 'text-justify';
    default:
      return '';
  }
}

export function getEditorialImageFigureClasses(
  width: ImageWidthV2,
  layout: ImageLayoutV2,
  dir: 'rtl' | 'ltr'
): string {
  let widthClasses = 'w-full max-w-full';
  if (layout !== 'block-full') {
    switch (width) {
      case '25%':
        widthClasses = 'w-full sm:w-1/2 md:w-1/4 max-w-full';
        break;
      case '50%':
        widthClasses = 'w-full sm:w-1/2 max-w-full';
        break;
      case '75%':
        widthClasses = 'w-full md:w-3/4 max-w-full';
        break;
      case '100%':
      default:
        widthClasses = 'w-full max-w-full';
        break;
    }
  }

  let layoutClasses = 'my-6 clear-both';
  switch (layout) {
    case 'float-start':
      layoutClasses =
        dir === 'rtl'
          ? 'my-4 max-md:clear-both md:float-right md:ms-0 md:me-6 md:mb-4'
          : 'my-4 max-md:clear-both md:float-left md:ms-0 md:me-6 md:mb-4';
      break;
    case 'float-end':
      layoutClasses =
        dir === 'rtl'
          ? 'my-4 max-md:clear-both md:float-left md:ms-6 md:me-0 md:mb-4'
          : 'my-4 max-md:clear-both md:float-right md:ms-6 md:me-0 md:mb-4';
      break;
    case 'block-center':
      layoutClasses = 'my-6 mx-auto clear-both';
      break;
    case 'block-full':
    default:
      layoutClasses = 'my-6 w-full max-w-full clear-both';
      break;
  }

  return `rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-800/70 shadow-xs ${widthClasses} ${layoutClasses}`;
}

function hasMeaningfulRichDocumentContent(doc: RichNewsDocument): boolean {
  function checkNodes(
    nodes: readonly (BlockNode | BlockNodeV2 | InlineNode)[]
  ): boolean {
    for (const node of nodes) {
      if (!node || typeof node !== 'object') {
        continue;
      }
      if (node.type === 'editorialImage' || node.type === 'horizontalRule') {
        return true;
      }
      if (
        node.type === 'text' &&
        typeof node.text === 'string' &&
        node.text.trim().length > 0
      ) {
        return true;
      }
      if ('content' in node && Array.isArray(node.content)) {
        if (
          checkNodes(
            node.content as readonly (BlockNode | BlockNodeV2 | InlineNode)[]
          )
        ) {
          return true;
        }
      }
    }
    return false;
  }

  return checkNodes(
    doc.doc.content as readonly (BlockNode | BlockNodeV2 | InlineNode)[]
  );
}

export function resolveActiveRichDocumentForArticle(
  article: News | PublicNewsArticle,
  isAr: boolean
): { readonly doc: RichNewsDocument; readonly locale: 'ar' | 'en' } | null {
  const publicArticle = article as PublicNewsArticle;
  const validAr =
    publicArticle.richBodyAr &&
    validateRichNewsDocumentByVersion(publicArticle.richBodyAr).valid &&
    hasMeaningfulRichDocumentContent(publicArticle.richBodyAr)
      ? publicArticle.richBodyAr
      : null;
  const validEn =
    publicArticle.richBodyEn &&
    validateRichNewsDocumentByVersion(publicArticle.richBodyEn).valid &&
    hasMeaningfulRichDocumentContent(publicArticle.richBodyEn)
      ? publicArticle.richBodyEn
      : null;

  if (isAr) {
    if (validAr) {
      return { doc: validAr, locale: 'ar' };
    }
    if (validEn) {
      return { doc: validEn, locale: 'en' };
    }
    return null;
  }

  if (validEn) {
    return { doc: validEn, locale: 'en' };
  }
  if (validAr) {
    return { doc: validAr, locale: 'ar' };
  }
  return null;
}

/**
 * Determines whether the top cover banner in the full article reader should be
 * suppressed to avoid displaying an automatically derived first inline image
 * twice as two separate visual blocks at the beginning of the article.
 */
export function shouldSuppressDuplicateCoverBanner(
  article: News | PublicNewsArticle,
  activeRichDoc: RichNewsDocument | null
): boolean {
  const publicArticle = article as PublicNewsArticle;
  const coverMeta = publicArticle.coverImage;
  if (!coverMeta || coverMeta.source !== 'derived_first_inline') {
    return false;
  }
  if (!coverMeta.assetId || !activeRichDoc || activeRichDoc.schemaVersion !== 2) {
    return false;
  }

  const inlineImages = extractOrderedEditorialImagesFromDocument(activeRichDoc);
  return inlineImages.some((node) => node.attrs.assetId === coverMeta.assetId);
}

export interface PublicEditorialInlineImageFigureProps {
  articleId: string;
  node: EditorialImageNodeV2;
  isAr: boolean;
  defaultDir: 'rtl' | 'ltr';
  forceLoadError?: boolean;
}

export const PublicEditorialInlineImageFigure: React.FC<
  PublicEditorialInlineImageFigureProps
> = ({ articleId, node, isAr, defaultDir, forceLoadError = false }) => {
  const [hasError, setHasError] = useState<boolean>(forceLoadError);
  const { attrs } = node;

  const deliveryUrl = PublicNewsClient.buildPublicEditorialImageDeliveryUrl(
    articleId,
    attrs.assetId,
    'article_inline'
  );

  const altText = isAr
    ? attrs.altAr || attrs.altEn || ''
    : attrs.altEn || attrs.altAr || '';
  const captionText = isAr
    ? attrs.captionAr || attrs.captionEn || ''
    : attrs.captionEn || attrs.captionAr || '';

  const figureClasses = getEditorialImageFigureClasses(
    attrs.width,
    attrs.layout,
    defaultDir
  );

  const isFailedOrUnavailable = hasError || forceLoadError || !deliveryUrl;

  return (
    <figure
      dir={defaultDir}
      data-editorial-asset-id={attrs.assetId}
      data-editorial-width={attrs.width}
      data-editorial-layout={attrs.layout}
      className={figureClasses}
    >
      {isFailedOrUnavailable ? (
        <div
          role="img"
          aria-label={altText}
          className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center bg-gray-100 dark:bg-gray-800/90 text-gray-500 dark:text-gray-400"
        >
          <ImageOff className="w-6 h-6 text-gray-400" aria-hidden="true" />
          <span className="text-xs font-medium">
            {isAr
              ? 'تعذر تحميل الصورة التحريرية المعتمدة'
              : 'Approved editorial image unavailable'}
          </span>
        </div>
      ) : (
        <div className="w-full overflow-hidden bg-gray-100 dark:bg-gray-800">
          <img
            src={deliveryUrl}
            alt={altText}
            loading="lazy"
            onError={() => setHasError(true)}
            className="w-full h-auto max-w-full object-cover block"
          />
        </div>
      )}
      {captionText && (
        <figcaption
          dir={defaultDir}
          className="px-4 py-2.5 text-xs sm:text-sm text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/90 border-t border-gray-200/80 dark:border-gray-700/80 font-medium leading-relaxed text-start"
        >
          {captionText}
        </figcaption>
      )}
    </figure>
  );
};

function renderMarkedText(
  text: string,
  marks: readonly Mark[] | undefined,
  key: string
): React.ReactNode {
  let element: React.ReactNode = text;
  if (!marks || marks.length === 0) {
    return <React.Fragment key={key}>{element}</React.Fragment>;
  }

  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    const markKey = `${key}-m-${i}`;
    switch (mark.type) {
      case 'bold':
        element = (
          <strong key={markKey} className="font-bold text-gray-900 dark:text-white">
            {element}
          </strong>
        );
        break;
      case 'italic':
        element = (
          <em key={markKey} className="italic">
            {element}
          </em>
        );
        break;
      case 'underline':
        element = (
          <span key={markKey} className="underline underline-offset-4">
            {element}
          </span>
        );
        break;
      case 'strike':
        element = (
          <s key={markKey} className="line-through">
            {element}
          </s>
        );
        break;
      case 'link':
        if (mark.attrs && isSafeArticleLinkHref(mark.attrs.href)) {
          element = (
            <a
              key={markKey}
              href={mark.attrs.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 underline underline-offset-4 font-semibold transition-colors"
            >
              {element}
            </a>
          );
        }
        break;
      default:
        break;
    }
  }

  return <React.Fragment key={key}>{element}</React.Fragment>;
}

function renderInlineNodes(
  nodes: readonly InlineNode[] | undefined,
  keyPrefix: string
): React.ReactNode {
  if (!nodes || nodes.length === 0) {
    return null;
  }

  return nodes.map((node, index) => {
    const key = `${keyPrefix}-i-${index}`;
    if (node.type === 'hardBreak') {
      return <br key={key} />;
    }
    if (node.type === 'text') {
      return renderMarkedText(node.text, node.marks, key);
    }
    return null;
  });
}

export interface PublicRichNewsDocumentRendererProps {
  articleId: string;
  document: RichNewsDocument;
  isAr: boolean;
  defaultDir: 'rtl' | 'ltr';
  failedAssetIds?: ReadonlySet<string>;
}

export const PublicRichNewsDocumentRenderer: React.FC<
  PublicRichNewsDocumentRendererProps
> = ({ articleId, document, isAr, defaultDir, failedAssetIds }) => {
  const renderBlockNode = (
    node: BlockNode | BlockNodeV2,
    key: string
  ): React.ReactNode => {
    if (!node || typeof node !== 'object') {
      return null;
    }

    switch (node.type) {
      case 'paragraph': {
        const dir: TextDirection = node.attrs?.dir || defaultDir;
        const alignClass = getAlignmentClassName(node.attrs?.textAlign);
        if (!node.content || node.content.length === 0) {
          return null;
        }
        return (
          <p
            key={key}
            dir={dir}
            className={`mb-5 text-base sm:text-lg leading-relaxed text-gray-800 dark:text-gray-200 ${alignClass}`.trim()}
          >
            {renderInlineNodes(node.content, key)}
          </p>
        );
      }

      case 'heading': {
        const dir: TextDirection = node.attrs?.dir || defaultDir;
        const alignClass = getAlignmentClassName(node.attrs?.textAlign);
        const level = node.attrs?.level || 2;
        const children = renderInlineNodes(node.content, key);

        if (level === 2) {
          return (
            <h2
              key={key}
              dir={dir}
              className={`mt-8 mb-4 text-xl sm:text-2xl font-extrabold text-gray-900 dark:text-white leading-tight ${alignClass}`.trim()}
            >
              {children}
            </h2>
          );
        }
        if (level === 3) {
          return (
            <h3
              key={key}
              dir={dir}
              className={`mt-6 mb-3 text-lg sm:text-xl font-bold text-gray-900 dark:text-white leading-snug ${alignClass}`.trim()}
            >
              {children}
            </h3>
          );
        }
        return (
          <h4
            key={key}
            dir={dir}
            className={`mt-5 mb-2.5 text-base sm:text-lg font-bold text-gray-900 dark:text-white leading-snug ${alignClass}`.trim()}
          >
            {children}
          </h4>
        );
      }

      case 'blockquote': {
        const dir: TextDirection = node.attrs?.dir || defaultDir;
        return (
          <blockquote
            key={key}
            dir={dir}
            className="my-6 border-s-4 border-emerald-600 bg-gray-50 dark:bg-gray-800/60 px-5 py-4 rounded-e-xl text-gray-700 dark:text-gray-300 italic"
          >
            {node.content?.map((child, idx) =>
              renderBlockNode(child, `${key}-bq-${idx}`)
            )}
          </blockquote>
        );
      }

      case 'bulletList': {
        return (
          <ul
            key={key}
            dir={defaultDir}
            className="my-5 list-disc ps-6 space-y-2 text-base sm:text-lg text-gray-800 dark:text-gray-200"
          >
            {node.content?.map((item, idx) =>
              renderBlockNode(item, `${key}-ul-${idx}`)
            )}
          </ul>
        );
      }

      case 'orderedList': {
        return (
          <ol
            key={key}
            start={node.attrs?.start}
            dir={defaultDir}
            className="my-5 list-decimal ps-6 space-y-2 text-base sm:text-lg text-gray-800 dark:text-gray-200"
          >
            {node.content?.map((item, idx) =>
              renderBlockNode(item, `${key}-ol-${idx}`)
            )}
          </ol>
        );
      }

      case 'listItem': {
        return (
          <li key={key} className="ps-1 [&>p]:mb-2 [&>p:last-child]:mb-0">
            {node.content?.map((child, idx) =>
              renderBlockNode(child, `${key}-li-${idx}`)
            )}
          </li>
        );
      }

      case 'horizontalRule': {
        return (
          <hr
            key={key}
            className="my-8 border-t border-gray-200 dark:border-gray-800 clear-both"
          />
        );
      }

      case 'editorialImage': {
        return (
          <PublicEditorialInlineImageFigure
            key={key}
            articleId={articleId}
            node={node}
            isAr={isAr}
            defaultDir={defaultDir}
            forceLoadError={Boolean(failedAssetIds?.has(node.attrs.assetId))}
          />
        );
      }

      default:
        return null;
    }
  };

  return (
    <div
      dir={defaultDir}
      className="flow-root after:content-[''] after:block after:clear-both"
    >
      {document.doc.content.map((block, index) =>
        renderBlockNode(block as BlockNode | BlockNodeV2, `block-${index}`)
      )}
    </div>
  );
};

export interface PublicNewsHubProps {
  initialArticleIdOrSlug?: string;
  initialArticles?: PublicNewsArticle[];
  onNavigate?: (page: any) => void;
}

export function PublicNewsHub({
  initialArticleIdOrSlug,
  initialArticles,
  onNavigate: _onNavigate,
}: PublicNewsHubProps) {
  const { i18n } = useTranslation();
  const currentLang = (i18n.language === 'en' ? 'en' : 'ar') as Language;
  const isAr = currentLang === 'ar';

  const [articles, setArticles] = useState<PublicNewsArticle[]>(
    () => initialArticles ?? []
  );
  const [loading, setLoading] = useState<boolean>(
    () => initialArticles === undefined
  );
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const debouncedSearchQuery = useDebounce(searchQuery, 350);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'relevant'>('recent');

  const [selectedArticle, setSelectedArticle] =
    useState<PublicNewsArticle | null>(() => {
      if (!initialArticles || !initialArticleIdOrSlug) {
        return null;
      }
      return (
        initialArticles.find(
          (a) =>
            a.id === initialArticleIdOrSlug ||
            PublicNewsClient.getSlug(a.titleAr) === initialArticleIdOrSlug ||
            (a.titleEn &&
              PublicNewsClient.getSlug(a.titleEn) === initialArticleIdOrSlug)
        ) ?? null
      );
    });
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [failedCoverUrls, setFailedCoverUrls] = useState<
    Record<string, boolean>
  >({});

  const articleTopRef = useRef<HTMLDivElement>(null);

  // Load published articles when initialArticles is not statically injected
  useEffect(() => {
    if (initialArticles !== undefined) {
      return;
    }

    let isMounted = true;
    async function loadNews() {
      setLoading(true);
      setError(null);
      try {
        const fetched = await PublicNewsClient.listPublishedNews({
          language: currentLang,
        });
        if (isMounted) {
          setArticles(fetched);

          // Check if initial article was requested via slug or id
          if (initialArticleIdOrSlug) {
            const matched = fetched.find(
              (a) =>
                a.id === initialArticleIdOrSlug ||
                PublicNewsClient.getSlug(a.titleAr) ===
                  initialArticleIdOrSlug ||
                (a.titleEn &&
                  PublicNewsClient.getSlug(a.titleEn) ===
                    initialArticleIdOrSlug)
            );
            if (matched) {
              setSelectedArticle(matched);
            }
          }
        }
      } catch (err: unknown) {
        if (isMounted) {
          console.error('Failed to load published news:', err);
          setError(
            isAr
              ? 'تعذر تحميل الأخبار المعتمدة حالياً.'
              : 'Failed to load verified news at this time.'
          );
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadNews();
    return () => {
      isMounted = false;
    };
  }, [currentLang, initialArticleIdOrSlug, initialArticles, isAr]);

  // Scroll to article reader when an article is opened
  useEffect(() => {
    if (selectedArticle && articleTopRef.current) {
      articleTopRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }
  }, [selectedArticle]);

  // Filtered and sorted articles
  const filteredArticles = useMemo(() => {
    let result = [...articles];

    // Category filter
    if (selectedCategory !== 'all') {
      result = result.filter((item) => item.category === selectedCategory);
    }

    // Search filter
    if (debouncedSearchQuery.trim()) {
      const q = debouncedSearchQuery.toLowerCase().trim();
      result = result.filter((item) => {
        const title = isAr ? item.titleAr : item.titleEn || item.titleAr;
        const excerpt = isAr
          ? item.excerptAr
          : item.excerptEn || item.excerptAr;
        const author = item.author || '';
        return (
          title.toLowerCase().includes(q) ||
          excerpt.toLowerCase().includes(q) ||
          author.toLowerCase().includes(q)
        );
      });
    }

    // Sorting
    if (sortBy === 'recent') {
      result.sort((a, b) => {
        const timeA = new Date(a.publishedAt || a.createdAt).getTime();
        const timeB = new Date(b.publishedAt || b.createdAt).getTime();
        return timeB - timeA;
      });
    }

    return result;
  }, [articles, selectedCategory, debouncedSearchQuery, sortBy, isAr]);

  // The leading featured article (highest priority approved article)
  const featuredArticle = useMemo(() => {
    if (selectedCategory !== 'all' || debouncedSearchQuery.trim()) {
      return null;
    }
    return filteredArticles.length > 0 ? filteredArticles[0] : null;
  }, [filteredArticles, selectedCategory, debouncedSearchQuery]);

  // The remaining archive articles (excluding the leading featured article if active)
  const archiveArticles = useMemo(() => {
    if (featuredArticle) {
      return filteredArticles.slice(1);
    }
    return filteredArticles;
  }, [filteredArticles, featuredArticle]);

  const handleShare = async (article: News) => {
    const slug = PublicNewsClient.getSlug(
      isAr ? article.titleAr : article.titleEn || article.titleAr
    );
    const url = `${window.location.origin}/#news/${slug}`;
    const title = isAr ? article.titleAr : article.titleEn || article.titleAr;

    if (navigator.share) {
      try {
        await navigator.share({
          title,
          text: isAr
            ? article.excerptAr
            : article.excerptEn || article.excerptAr,
          url,
        });
        return;
      } catch (_err) {
        // Fallback to clipboard
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch (_e) {
      // ignore
    }
  };

  const getWhatsAppShareUrl = (article: News) => {
    const title = isAr ? article.titleAr : article.titleEn || article.titleAr;
    const slug = PublicNewsClient.getSlug(title);
    const origin =
      typeof window !== 'undefined' ? window.location.origin : '';
    const url = `${origin}/#news/${slug}`;
    return `https://api.whatsapp.com/send?text=${encodeURIComponent(`${title}\n${url}`)}`;
  };

  const getTwitterShareUrl = (article: News) => {
    const title = isAr ? article.titleAr : article.titleEn || article.titleAr;
    const slug = PublicNewsClient.getSlug(title);
    const origin =
      typeof window !== 'undefined' ? window.location.origin : '';
    const url = `${origin}/#news/${slug}`;
    return `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`;
  };

  // Full article reader view
  if (selectedArticle) {
    const title = isAr
      ? selectedArticle.titleAr
      : selectedArticle.titleEn || selectedArticle.titleAr;
    const readerKicker = getLocalizedKickerForArticle(selectedArticle, isAr);
    const content = isAr
      ? selectedArticle.contentAr
      : selectedArticle.contentEn || selectedArticle.contentAr;
    const excerpt = isAr
      ? selectedArticle.excerptAr
      : selectedArticle.excerptEn || selectedArticle.excerptAr;
    const displayCategory = CANONICAL_CATEGORY_DEFINITIONS.find(
      (c) => c.value === selectedArticle.category
    );
    const categoryLabel = displayCategory
      ? isAr
        ? displayCategory.labelAr
        : displayCategory.labelEn
      : selectedArticle.category;
    const journalisticTypeEntry =
      selectedArticle.journalisticType &&
      Object.prototype.hasOwnProperty.call(
        PUBLIC_JOURNALISTIC_TYPE_LABELS,
        selectedArticle.journalisticType
      )
        ? PUBLIC_JOURNALISTIC_TYPE_LABELS[selectedArticle.journalisticType]
        : undefined;
    const journalisticTypeLabel = journalisticTypeEntry
      ? isAr
        ? journalisticTypeEntry.ar
        : journalisticTypeEntry.en
      : undefined;

    const formattedDate = selectedArticle.publishedAt
      ? new Date(selectedArticle.publishedAt).toLocaleDateString(
          isAr ? 'ar-SD' : 'en-US',
          {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          }
        )
      : '';

    const activeRich = resolveActiveRichDocumentForArticle(
      selectedArticle,
      isAr
    );
    const suppressCoverBanner = shouldSuppressDuplicateCoverBanner(
      selectedArticle,
      activeRich?.doc ?? null
    );
    const articleCoverUrl =
      PublicNewsClient.resolveCoverVariantUrl(
        selectedArticle,
        'article_cover'
      ) ?? PublicNewsClient.resolveCoverVariantUrl(selectedArticle, 'card');

    const showArticleCoverBanner =
      Boolean(articleCoverUrl) &&
      !suppressCoverBanner &&
      !failedCoverUrls[articleCoverUrl!];

    const coverAlt = isAr
      ? selectedArticle.coverImage?.altAr ||
        selectedArticle.featuredImage?.altAr ||
        title
      : selectedArticle.coverImage?.altEn ||
        selectedArticle.featuredImage?.altEn ||
        selectedArticle.coverImage?.altAr ||
        selectedArticle.featuredImage?.altAr ||
        title;

    const coverCaption = isAr
      ? selectedArticle.coverImage?.captionAr ||
        selectedArticle.featuredImage?.captionAr ||
        selectedArticle.coverImage?.captionEn ||
        selectedArticle.featuredImage?.captionEn
      : selectedArticle.coverImage?.captionEn ||
        selectedArticle.featuredImage?.captionEn ||
        selectedArticle.coverImage?.captionAr ||
        selectedArticle.featuredImage?.captionAr;

    const readerDir: 'rtl' | 'ltr' =
      activeRich?.locale === 'en' || (!isAr && Boolean(selectedArticle.titleEn))
        ? 'ltr'
        : 'rtl';

    return (
      <div
        ref={articleTopRef}
        className="py-8 sm:py-12 bg-gray-50/50 dark:bg-gray-950 min-h-screen pop-page-fade"
      >
        <Container className="max-w-4xl">
          {/* Back to News Hub */}
          <div className="mb-8">
            <button
              onClick={() => setSelectedArticle(null)}
              className="inline-flex items-center gap-2 text-sm font-bold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 transition-colors cursor-pointer group"
            >
              {isAr ? (
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              ) : (
                <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
              )}
              <span>
                {isAr ? 'العودة لمركز الأخبار' : 'Back to News Hub'}
              </span>
            </button>
          </div>

          <article className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-6 sm:p-12 shadow-sm space-y-8 overflow-hidden">
            {/* Header Meta */}
            <div className="space-y-4 border-b border-gray-100 dark:border-gray-800/80 pb-6">
              <div className="flex flex-wrap items-center gap-3">
                <span className="px-3.5 py-1 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                  {categoryLabel}
                </span>

                {journalisticTypeLabel && (
                  <span className="px-3 py-1 rounded-md text-xs font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200/80 dark:border-gray-700/80">
                    {journalisticTypeLabel}
                  </span>
                )}

                {selectedArticle.urgencyLevel &&
                  selectedArticle.urgencyLevel !== 'Standard' && (
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold text-white shadow-xs ${
                        selectedArticle.urgencyLevel === 'Breaking'
                          ? 'bg-red-600 animate-pulse'
                          : 'bg-amber-600'
                      }`}
                    >
                      {getUrgencyLabel(selectedArticle.urgencyLevel, isAr)}
                    </span>
                  )}
              </div>

              {readerKicker && (
                <p
                  dir="auto"
                  className="text-sm sm:text-base font-bold text-emerald-700 dark:text-emerald-400 leading-snug break-words"
                >
                  {readerKicker}
                </p>
              )}

              <h1 className="text-2xl sm:text-4xl lg:text-5xl font-extrabold text-gray-900 dark:text-white leading-tight tracking-tight">
                {title}
              </h1>

              {excerpt && (
                <p className="text-base sm:text-lg text-gray-600 dark:text-gray-300 font-medium leading-relaxed">
                  {excerpt}
                </p>
              )}

              {/* Byline and Attribution Bar */}
              <div className="flex flex-wrap items-center justify-between gap-4 pt-4 text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                  {selectedArticle.author && (
                    <div className="inline-flex items-center gap-1.5 font-medium text-gray-700 dark:text-gray-300">
                      <User className="w-4 h-4 text-emerald-600" />
                      <span>{selectedArticle.author}</span>
                    </div>
                  )}
                  {formattedDate && (
                    <div className="inline-flex items-center gap-1.5 font-medium">
                      <Calendar className="w-4 h-4 text-emerald-600" />
                      <span>{formattedDate}</span>
                    </div>
                  )}
                  {selectedArticle.location && (
                    <div className="inline-flex items-center gap-1.5 font-medium">
                      <MapPin className="w-4 h-4 text-emerald-600" />
                      <span>{selectedArticle.location}</span>
                    </div>
                  )}
                </div>

                {/* Social and Sharing Controls */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleShare(selectedArticle)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                    title={isAr ? 'نسخ الرابط' : 'Copy link'}
                  >
                    {copiedLink ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Share2 className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {copiedLink
                        ? isAr
                          ? 'تم النسخ!'
                          : 'Copied!'
                        : isAr
                          ? 'مشاركة'
                          : 'Share'}
                    </span>
                  </button>

                  <a
                    href={getWhatsAppShareUrl(selectedArticle)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-950/40 transition-colors"
                    title="WhatsApp"
                  >
                    <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.372-.025-.521-.075-.148-.67-1.613-.916-2.207-.242-.579-.487-.5-.67-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a5.498 5.498 0 0 1-2.827-.775l-.203-.12-2.106.552.562-2.052-.132-.211a5.498 5.498 0 0 1-.843-2.909c0-3.036 2.471-5.508 5.508-5.508 1.47 0 2.852.573 3.89 1.614a5.525 5.525 0 0 1 1.614 3.89c0 3.037-2.472 5.509-5.508 5.509m8.326-17.785C19.145 2.757 16.37 0 12.983 0 7.82 0 3.633 4.187 3.633 9.352c0 1.649.432 3.259 1.257 4.678l-1.34 4.897 5.004-1.313a9.387 9.387 0 0 0 4.437 1.133h.004c5.163 0 9.351-4.187 9.351-9.352 0-2.497-.971-4.847-2.736-6.613" />
                    </svg>
                  </a>

                  <a
                    href={getTwitterShareUrl(selectedArticle)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"
                    title="X / Twitter"
                  >
                    <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932 6.064-6.932zm-1.292 19.49h2.039L6.486 3.24H4.298l13.311 17.403z" />
                    </svg>
                  </a>
                </div>
              </div>
            </div>

            {/* Explicit Cover Image Banner (suppressed when cover was derived from first inline image) */}
            {showArticleCoverBanner && articleCoverUrl && (
              <figure
                data-article-cover="explicit"
                className="space-y-2 clear-both"
              >
                <div className="w-full aspect-video rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-800">
                  <img
                    src={articleCoverUrl}
                    alt={coverAlt}
                    onError={() =>
                      setFailedCoverUrls((prev) => ({
                        ...prev,
                        [articleCoverUrl]: true,
                      }))
                    }
                    className="w-full h-full object-cover"
                  />
                </div>
                {(coverCaption || selectedArticle.featuredImage?.credit) && (
                  <figcaption
                    dir={readerDir}
                    className="text-xs text-gray-500 dark:text-gray-400 text-center font-medium"
                  >
                    {coverCaption}
                    {selectedArticle.featuredImage?.credit &&
                      ` — ${selectedArticle.featuredImage.credit}`}
                  </figcaption>
                )}
              </figure>
            )}

            {/* Main Content Body: Rich Document V2 / V1 or Plain-Text Fallback */}
            <div className="prose prose-emerald dark:prose-invert max-w-none text-base sm:text-lg leading-relaxed text-gray-800 dark:text-gray-200 flow-root after:content-[''] after:block after:clear-both">
              {activeRich ? (
                <PublicRichNewsDocumentRenderer
                  articleId={selectedArticle.id}
                  document={activeRich.doc}
                  isAr={isAr}
                  defaultDir={readerDir}
                />
              ) : content ? (
                <div className="space-y-6">
                  {content.split('\n\n').map((paragraph, idx) => (
                    <p key={idx} className="leading-relaxed">
                      {paragraph}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 italic">
                  {isAr
                    ? 'لا يوجد نص إضافي لهذا المقال.'
                    : 'No additional text for this article.'}
                </p>
              )}
            </div>

            {/* Tags */}
            {selectedArticle.tags && selectedArticle.tags.length > 0 && (
              <div className="pt-6 border-t border-gray-100 dark:border-gray-800/80 flex flex-wrap items-center gap-2 clear-both">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                  {isAr ? 'الوسوم:' : 'Tags:'}
                </span>
                {selectedArticle.tags.map((tag, idx) => (
                  <span
                    key={idx}
                    className="px-2.5 py-1 rounded-md text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            {/* Source & Attribution Presentation */}
            {selectedArticle.sources && selectedArticle.sources.length > 0 && (
              <div className="pt-6 border-t border-gray-100 dark:border-gray-800/80 clear-both">
                <ContentSourceList
                  sources={selectedArticle.sources}
                  isArabic={isAr}
                />
              </div>
            )}
          </article>
        </Container>
      </div>
    );
  }

  const featuredCoverUrl = featuredArticle
    ? (PublicNewsClient.resolveCoverVariantUrl(
        featuredArticle,
        'article_cover'
      ) ?? PublicNewsClient.resolveCoverVariantUrl(featuredArticle, 'card'))
    : null;
  const showFeaturedCover =
    Boolean(featuredCoverUrl) && !failedCoverUrls[featuredCoverUrl!];

  // News Hub Catalog View
  return (
    <div className="py-8 sm:py-14 bg-gray-50/50 dark:bg-gray-950 min-h-screen pop-page-fade">
      <Container>
        {/* Hub Header */}
        <div className="mb-10 space-y-4 text-center sm:text-start">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
            <Newspaper className="w-3.5 h-3.5" />
            <span>
              {isAr
                ? 'المركز الإخباري والتحقيقات البيئية'
                : 'News Hub & Environmental Reporting'}
            </span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold text-gray-900 dark:text-white tracking-tight">
            {isAr
              ? 'الأخبار والتحقيقات الميدانية'
              : 'Environmental News & Investigations'}
          </h1>
          <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 max-w-2xl leading-relaxed">
            {isAr
              ? 'تغطية إعلامية وتحقيقات بيئية موثقة ومعتمدة من فريق التحرير حول قضايا المناخ والموارد المائية والتنوع الحيوي في السودان والمنطقة.'
              : 'Verified editorial coverage and investigative environmental journalism documenting climate change, water governance, and biodiversity.'}
          </p>
        </div>

        {/* Filter and Search Bar */}
        <div className="bg-white dark:bg-gray-900 p-4 sm:p-6 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xs mb-10 space-y-4">
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute start-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  isAr
                    ? 'البحث في الأخبار والتحقيقات بالاسم أو الكلمة...'
                    : 'Search news and investigations...'
                }
                className="w-full ps-10 pe-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm font-medium text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-emerald-600 transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  {isAr ? 'مسح' : 'Clear'}
                </button>
              )}
            </div>

            {/* Sorting Toggle */}
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-semibold text-gray-500">
                {isAr ? 'ترتيب:' : 'Sort:'}
              </span>
              <button
                onClick={() => setSortBy('recent')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  sortBy === 'recent'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200'
                }`}
              >
                {isAr ? 'الأحدث' : 'Most Recent'}
              </button>
            </div>
          </div>

          {/* Category Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide pt-2 border-t border-gray-100 dark:border-gray-800/80">
            <button
              onClick={() => setSelectedCategory('all')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                selectedCategory === 'all'
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {isAr ? 'كافة المجالات' : 'All Topics'}
            </button>
            {CANONICAL_CATEGORY_DEFINITIONS.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setSelectedCategory(cat.value)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                  selectedCategory === cat.value
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {isAr ? cat.labelAr : cat.labelEn}
              </button>
            ))}
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4"
              >
                <div className="aspect-video bg-gray-200 dark:bg-gray-800 rounded-lg" />
                <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-3/4" />
                <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-full" />
                <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-1/2" />
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="p-8 text-center bg-red-50 dark:bg-red-950/30 rounded-2xl border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-400 space-y-2">
            <AlertCircle className="w-8 h-8 mx-auto" />
            <p className="font-bold">{error}</p>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && articles.length === 0 && (
          <div className="py-20 text-center bg-white dark:bg-gray-900 rounded-2xl border border-dashed border-gray-300 dark:border-gray-800 space-y-3">
            <Newspaper className="w-12 h-12 mx-auto text-gray-400" />
            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-200">
              {isAr
                ? 'لا توجد أخبار منشورة حالياً'
                : 'No published news at this time'}
            </h3>
            <p className="text-xs sm:text-sm text-gray-500 max-w-md mx-auto">
              {isAr
                ? 'يتم نشر الأخبار والتحقيقات بعد استيفاء مراحل التدقيق والاعتماد التحريري المعتمدة.'
                : 'News and investigative articles appear here once editorial review and publication approval are completed.'}
            </p>
          </div>
        )}

        {/* No Results from filter/search */}
        {!loading &&
          !error &&
          articles.length > 0 &&
          filteredArticles.length === 0 && (
            <div className="py-16 text-center bg-white dark:bg-gray-900 rounded-2xl border border-dashed border-gray-300 dark:border-gray-800 space-y-2">
              <Search className="w-8 h-8 mx-auto text-gray-400" />
              <h4 className="text-base font-bold text-gray-700 dark:text-gray-300">
                {isAr
                  ? 'لم يتم العثور على نتائج مطابقة'
                  : 'No matching articles found'}
              </h4>
              <p className="text-xs text-gray-500">
                {isAr
                  ? 'جرب البحث بكلمات مفتاحية أخرى أو إلغاء تصفية الموضوع.'
                  : 'Try adjusting your search query or topic filter.'}
              </p>
            </div>
          )}

        {/* Content: Featured + Grid */}
        {!loading && !error && filteredArticles.length > 0 && (
          <div className="space-y-10">
            {/* 1. Leading Featured Article (Only from genuinely approved & published content) */}
            {featuredArticle && (
              <div className="space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-400">
                  {isAr ? 'التغطية البارزة' : 'Featured Coverage'}
                </span>
                <div
                  onClick={() => setSelectedArticle(featuredArticle)}
                  className="group cursor-pointer bg-white dark:bg-gray-900 rounded-3xl border border-emerald-500/30 dark:border-emerald-700/40 p-6 sm:p-8 shadow-sm hover:shadow-xl transition-all duration-300 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center"
                >
                  {showFeaturedCover && featuredCoverUrl && (
                    <div className="lg:col-span-7 aspect-video rounded-2xl overflow-hidden bg-gray-100 dark:bg-gray-800">
                      <img
                        src={featuredCoverUrl}
                        alt={
                          isAr
                            ? featuredArticle.coverImage?.altAr ||
                              featuredArticle.featuredImage?.altAr ||
                              featuredArticle.titleAr
                            : featuredArticle.coverImage?.altEn ||
                              featuredArticle.featuredImage?.altEn ||
                              featuredArticle.coverImage?.altAr ||
                              featuredArticle.featuredImage?.altAr ||
                              featuredArticle.titleEn ||
                              featuredArticle.titleAr
                        }
                        onError={() =>
                          setFailedCoverUrls((prev) => ({
                            ...prev,
                            [featuredCoverUrl]: true,
                          }))
                        }
                        className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-500"
                      />
                    </div>
                  )}

                  <div
                    className={`space-y-4 ${showFeaturedCover ? 'lg:col-span-5' : 'lg:col-span-12'}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                        {isAr
                          ? CANONICAL_CATEGORY_DEFINITIONS.find(
                              (c) => c.value === featuredArticle.category
                            )?.labelAr || featuredArticle.category
                          : CANONICAL_CATEGORY_DEFINITIONS.find(
                              (c) => c.value === featuredArticle.category
                            )?.labelEn || featuredArticle.category}
                      </span>
                      {featuredArticle.urgencyLevel &&
                        featuredArticle.urgencyLevel !== 'Standard' && (
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-xs font-bold text-white ${
                              featuredArticle.urgencyLevel === 'Breaking'
                                ? 'bg-red-600 animate-pulse'
                                : 'bg-amber-600'
                            }`}
                          >
                            {getUrgencyLabel(
                              featuredArticle.urgencyLevel,
                              isAr
                            )}
                          </span>
                        )}
                    </div>

                    {(() => {
                      const featuredKicker = getLocalizedKickerForArticle(
                        featuredArticle,
                        isAr
                      );
                      return featuredKicker ? (
                        <p
                          dir="auto"
                          className="text-xs sm:text-sm font-bold text-emerald-700 dark:text-emerald-400 leading-snug line-clamp-2 break-words"
                        >
                          {featuredKicker}
                        </p>
                      ) : null;
                    })()}

                    <h2 className="text-xl sm:text-3xl font-extrabold text-gray-900 dark:text-white leading-tight group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors">
                      {isAr
                        ? featuredArticle.titleAr
                        : featuredArticle.titleEn || featuredArticle.titleAr}
                    </h2>

                    <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300 leading-relaxed line-clamp-3">
                      {isAr
                        ? featuredArticle.excerptAr
                        : featuredArticle.excerptEn ||
                          featuredArticle.excerptAr}
                    </p>

                    <div className="pt-2 flex items-center justify-between text-xs text-gray-500 font-medium">
                      <span>{featuredArticle.author}</span>
                      <span>
                        {featuredArticle.publishedAt &&
                          new Date(
                            featuredArticle.publishedAt
                          ).toLocaleDateString(isAr ? 'ar-SD' : 'en-US')}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 2. Archive News Grid */}
            {archiveArticles.length > 0 && (
              <div className="space-y-4">
                {featuredArticle && (
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                    {isAr
                      ? 'أحدث التقارير الإخبارية'
                      : 'Latest Reports & Archive'}
                  </h3>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {archiveArticles.map((article) => (
                    <NewsCard
                      key={article.id}
                      news={article}
                      currentLanguage={currentLang}
                      onClick={() => setSelectedArticle(article)}
                      className="h-full"
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Container>
    </div>
  );
}
