import { useState, useEffect, useMemo, useRef } from 'react';
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
  Newspaper 
} from 'lucide-react';
import { 
  NewsCard, 
  ContentSourceList, 
  getUrgencyLabel 
} from '../content';
import { PublicNewsClient } from '../../services/publicNewsClient';
import { useDebounce } from '../../hooks/useDebounce';
import { CANONICAL_CATEGORY_DEFINITIONS } from '../../types';
import type { News, Language } from '../../types';

interface PublicNewsHubProps {
  initialArticleIdOrSlug?: string;
  onNavigate?: (page: any) => void;
}

export function PublicNewsHub({ initialArticleIdOrSlug, onNavigate: _onNavigate }: PublicNewsHubProps) {
  const { i18n } = useTranslation();
  const currentLang = (i18n.language === 'en' ? 'en' : 'ar') as Language;
  const isAr = currentLang === 'ar';

  const [articles, setArticles] = useState<News[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const debouncedSearchQuery = useDebounce(searchQuery, 350);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'relevant'>('recent');

  const [selectedArticle, setSelectedArticle] = useState<News | null>(null);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  const articleTopRef = useRef<HTMLDivElement>(null);

  // Load published articles
  useEffect(() => {
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
              a => a.id === initialArticleIdOrSlug || 
                   PublicNewsClient.getSlug(a.titleAr) === initialArticleIdOrSlug ||
                   (a.titleEn && PublicNewsClient.getSlug(a.titleEn) === initialArticleIdOrSlug)
            );
            if (matched) {
              setSelectedArticle(matched);
            }
          }
        }
      } catch (err: unknown) {
        if (isMounted) {
          console.error('Failed to load published news:', err);
          setError(isAr ? 'تعذر تحميل الأخبار المعتمدة حالياً.' : 'Failed to load verified news at this time.');
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
  }, [currentLang, initialArticleIdOrSlug, isAr]);

  // Scroll to article reader when an article is opened
  useEffect(() => {
    if (selectedArticle && articleTopRef.current) {
      articleTopRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedArticle]);

  // Filtered and sorted articles
  const filteredArticles = useMemo(() => {
    let result = [...articles];

    // Category filter
    if (selectedCategory !== 'all') {
      result = result.filter(item => item.category === selectedCategory);
    }

    // Search filter
    if (debouncedSearchQuery.trim()) {
      const q = debouncedSearchQuery.toLowerCase().trim();
      result = result.filter(item => {
        const title = isAr ? item.titleAr : (item.titleEn || item.titleAr);
        const excerpt = isAr ? item.excerptAr : (item.excerptEn || item.excerptAr);
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
    const slug = PublicNewsClient.getSlug(isAr ? article.titleAr : (article.titleEn || article.titleAr));
    const url = `${window.location.origin}/#news/${slug}`;
    const title = isAr ? article.titleAr : (article.titleEn || article.titleAr);

    if (navigator.share) {
      try {
        await navigator.share({
          title,
          text: isAr ? article.excerptAr : (article.excerptEn || article.excerptAr),
          url,
        });
        return;
      } catch (err) {
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
    const title = isAr ? article.titleAr : (article.titleEn || article.titleAr);
    const slug = PublicNewsClient.getSlug(title);
    const url = `${window.location.origin}/#news/${slug}`;
    return `https://api.whatsapp.com/send?text=${encodeURIComponent(`${title}\n${url}`)}`;
  };

  const getTwitterShareUrl = (article: News) => {
    const title = isAr ? article.titleAr : (article.titleEn || article.titleAr);
    const slug = PublicNewsClient.getSlug(title);
    const url = `${window.location.origin}/#news/${slug}`;
    return `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`;
  };

  // Full article reader view
  if (selectedArticle) {
    const title = isAr ? selectedArticle.titleAr : (selectedArticle.titleEn || selectedArticle.titleAr);
    const content = isAr ? selectedArticle.contentAr : (selectedArticle.contentEn || selectedArticle.contentAr);
    const excerpt = isAr ? selectedArticle.excerptAr : (selectedArticle.excerptEn || selectedArticle.excerptAr);
    const displayCategory = CANONICAL_CATEGORY_DEFINITIONS.find(c => c.value === selectedArticle.category);
    const categoryLabel = displayCategory 
      ? (isAr ? displayCategory.labelAr : displayCategory.labelEn)
      : selectedArticle.category;

    const formattedDate = selectedArticle.publishedAt 
      ? new Date(selectedArticle.publishedAt).toLocaleDateString(isAr ? 'ar-SD' : 'en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })
      : '';

    return (
      <div ref={articleTopRef} className="py-8 sm:py-12 bg-gray-50/50 dark:bg-gray-950 min-h-screen pop-page-fade">
        <Container className="max-w-4xl">
          {/* Back to News Hub */}
          <div className="mb-8">
            <button
              onClick={() => setSelectedArticle(null)}
              className="inline-flex items-center gap-2 text-sm font-bold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 transition-colors cursor-pointer group"
            >
              {isAr ? <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" /> : <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />}
              <span>{isAr ? 'العودة لمركز الأخبار' : 'Back to News Hub'}</span>
            </button>
          </div>

          <article className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-6 sm:p-12 shadow-sm space-y-8">
            {/* Header Meta */}
            <div className="space-y-4 border-b border-gray-100 dark:border-gray-800/80 pb-6">
              <div className="flex flex-wrap items-center gap-3">
                <span className="px-3.5 py-1 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                  {categoryLabel}
                </span>

                {selectedArticle.urgencyLevel && selectedArticle.urgencyLevel !== 'Standard' && (
                  <span className={`px-3 py-1 rounded-full text-xs font-bold text-white shadow-xs ${
                    selectedArticle.urgencyLevel === 'Breaking' ? 'bg-red-600 animate-pulse' : 'bg-amber-600'
                  }`}>
                    {getUrgencyLabel(selectedArticle.urgencyLevel, isAr)}
                  </span>
                )}
              </div>

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
                    {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Share2 className="w-3.5 h-3.5" />}
                    <span>{copiedLink ? (isAr ? 'تم النسخ!' : 'Copied!') : (isAr ? 'مشاركة' : 'Share')}</span>
                  </button>

                  <a
                    href={getWhatsAppShareUrl(selectedArticle)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-950/40 transition-colors"
                    title="WhatsApp"
                  >
                    <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.372-.025-.521-.075-.148-.67-1.613-.916-2.207-.242-.579-.487-.5-.67-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a5.498 5.498 0 0 1-2.827-.775l-.203-.12-2.106.552.562-2.052-.132-.211a5.498 5.498 0 0 1-.843-2.909c0-3.036 2.471-5.508 5.508-5.508 1.47 0 2.852.573 3.89 1.614a5.525 5.525 0 0 1 1.614 3.89c0 3.037-2.472 5.509-5.508 5.509m8.326-17.785C19.145 2.757 16.37 0 12.983 0 7.82 0 3.633 4.187 3.633 9.352c0 1.649.432 3.259 1.257 4.678l-1.34 4.897 5.004-1.313a9.387 9.387 0 0 0 4.437 1.133h.004c5.163 0 9.351-4.187 9.351-9.352 0-2.497-.971-4.847-2.736-6.613"/>
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
                      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932 6.064-6.932zm-1.292 19.49h2.039L6.486 3.24H4.298l13.311 17.403z"/>
                    </svg>
                  </a>
                </div>
              </div>
            </div>

            {/* Featured Image */}
            {selectedArticle.featuredImage && selectedArticle.featuredImage.url && (
              <figure className="space-y-2">
                <div className="w-full aspect-video rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-800">
                  <img
                    src={selectedArticle.featuredImage.url}
                    alt={isAr ? selectedArticle.featuredImage.altAr : (selectedArticle.featuredImage.altEn || selectedArticle.featuredImage.altAr)}
                    className="w-full h-full object-cover"
                  />
                </div>
                {(selectedArticle.featuredImage.captionAr || selectedArticle.featuredImage.credit) && (
                  <figcaption className="text-xs text-gray-500 dark:text-gray-400 text-center font-medium">
                    {isAr ? selectedArticle.featuredImage.captionAr : (selectedArticle.featuredImage.captionEn || selectedArticle.featuredImage.captionAr)}
                    {selectedArticle.featuredImage.credit && ` — ${selectedArticle.featuredImage.credit}`}
                  </figcaption>
                )}
              </figure>
            )}

            {/* Main Content Body */}
            <div className="prose prose-emerald dark:prose-invert max-w-none text-base sm:text-lg leading-relaxed text-gray-800 dark:text-gray-200 space-y-6">
              {content ? (
                content.split('\n\n').map((paragraph, idx) => (
                  <p key={idx} className="leading-relaxed">
                    {paragraph}
                  </p>
                ))
              ) : (
                <p className="text-gray-500 italic">
                  {isAr ? 'لا يوجد نص إضافي لهذا المقال.' : 'No additional text for this article.'}
                </p>
              )}
            </div>

            {/* Tags */}
            {selectedArticle.tags && selectedArticle.tags.length > 0 && (
              <div className="pt-6 border-t border-gray-100 dark:border-gray-800/80 flex flex-wrap items-center gap-2">
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

            {/* Source & Attribution Presentation (Reusing existing ContentSourceList) */}
            {selectedArticle.sources && selectedArticle.sources.length > 0 && (
              <div className="pt-6 border-t border-gray-100 dark:border-gray-800/80">
                <ContentSourceList sources={selectedArticle.sources} isArabic={isAr} />
              </div>
            )}
          </article>
        </Container>
      </div>
    );
  }

  // News Hub Catalog View
  return (
    <div className="py-8 sm:py-14 bg-gray-50/50 dark:bg-gray-950 min-h-screen pop-page-fade">
      <Container>
        {/* Hub Header */}
        <div className="mb-10 space-y-4 text-center sm:text-start">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
            <Newspaper className="w-3.5 h-3.5" />
            <span>{isAr ? 'المركز الإخباري والتحقيقات البيئية' : 'News Hub & Environmental Reporting'}</span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold text-gray-900 dark:text-white tracking-tight">
            {isAr ? 'الأخبار والتحقيقات الميدانية' : 'Environmental News & Investigations'}
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
                placeholder={isAr ? 'البحث في الأخبار والتحقيقات بالاسم أو الكلمة...' : 'Search news and investigations...'}
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
              <span className="text-xs font-semibold text-gray-500">{isAr ? 'ترتيب:' : 'Sort:'}</span>
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
            {CANONICAL_CATEGORY_DEFINITIONS.map(cat => (
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
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
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
              {isAr ? 'لا توجد أخبار منشورة حالياً' : 'No published news at this time'}
            </h3>
            <p className="text-xs sm:text-sm text-gray-500 max-w-md mx-auto">
              {isAr
                ? 'يتم نشر الأخبار والتحقيقات بعد استيفاء مراحل التدقيق والاعتماد التحريري المعتمدة.'
                : 'News and investigative articles appear here once editorial review and publication approval are completed.'}
            </p>
          </div>
        )}

        {/* No Results from filter/search */}
        {!loading && !error && articles.length > 0 && filteredArticles.length === 0 && (
          <div className="py-16 text-center bg-white dark:bg-gray-900 rounded-2xl border border-dashed border-gray-300 dark:border-gray-800 space-y-2">
            <Search className="w-8 h-8 mx-auto text-gray-400" />
            <h4 className="text-base font-bold text-gray-700 dark:text-gray-300">
              {isAr ? 'لم يتم العثور على نتائج مطابقة' : 'No matching articles found'}
            </h4>
            <p className="text-xs text-gray-500">
              {isAr ? 'جرب البحث بكلمات مفتاحية أخرى أو إلغاء تصفية الموضوع.' : 'Try adjusting your search query or topic filter.'}
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
                  {isAr ? 'التحقيق البارز' : 'Featured Coverage'}
                </span>
                <div 
                  onClick={() => setSelectedArticle(featuredArticle)}
                  className="group cursor-pointer bg-white dark:bg-gray-900 rounded-3xl border border-emerald-500/30 dark:border-emerald-700/40 p-6 sm:p-8 shadow-sm hover:shadow-xl transition-all duration-300 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center"
                >
                  {featuredArticle.featuredImage && featuredArticle.featuredImage.url && (
                    <div className="lg:col-span-7 aspect-video rounded-2xl overflow-hidden bg-gray-100 dark:bg-gray-800">
                      <img
                        src={featuredArticle.featuredImage.url}
                        alt={isAr ? featuredArticle.featuredImage.altAr : (featuredArticle.featuredImage.altEn || featuredArticle.featuredImage.altAr)}
                        className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-500"
                      />
                    </div>
                  )}

                  <div className={`space-y-4 ${featuredArticle.featuredImage?.url ? 'lg:col-span-5' : 'lg:col-span-12'}`}>
                    <div className="flex items-center gap-2">
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                        {isAr 
                          ? (CANONICAL_CATEGORY_DEFINITIONS.find(c => c.value === featuredArticle.category)?.labelAr || featuredArticle.category)
                          : (CANONICAL_CATEGORY_DEFINITIONS.find(c => c.value === featuredArticle.category)?.labelEn || featuredArticle.category)}
                      </span>
                      {featuredArticle.urgencyLevel && featuredArticle.urgencyLevel !== 'Standard' && (
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold text-white ${
                          featuredArticle.urgencyLevel === 'Breaking' ? 'bg-red-600 animate-pulse' : 'bg-amber-600'
                        }`}>
                          {getUrgencyLabel(featuredArticle.urgencyLevel, isAr)}
                        </span>
                      )}
                    </div>

                    <h2 className="text-xl sm:text-3xl font-extrabold text-gray-900 dark:text-white leading-tight group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors">
                      {isAr ? featuredArticle.titleAr : (featuredArticle.titleEn || featuredArticle.titleAr)}
                    </h2>

                    <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300 leading-relaxed line-clamp-3">
                      {isAr ? featuredArticle.excerptAr : (featuredArticle.excerptEn || featuredArticle.excerptAr)}
                    </p>

                    <div className="pt-2 flex items-center justify-between text-xs text-gray-500 font-medium">
                      <span>{featuredArticle.author}</span>
                      <span>
                        {featuredArticle.publishedAt && new Date(featuredArticle.publishedAt).toLocaleDateString(isAr ? 'ar-SD' : 'en-US')}
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
                    {isAr ? 'أحدث التقارير الإخبارية' : 'Latest Reports & Archive'}
                  </h3>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {archiveArticles.map(article => (
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
