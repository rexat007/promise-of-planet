import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, ArrowRight, ArrowLeft } from 'lucide-react';
import { Section } from '../layout/Section';
import { Container } from '../layout/Container';
import { NewsCard } from '../content';
import { ErrorBanner } from '../common/ErrorBanner';
import { PublicNewsClient } from '../../services/publicNewsClient';
import type { News, Language } from '../../types';
import type { PublicPageKey } from '../layout/Header';

export interface HomeNewsPreviewProps {
  currentLanguage: Language;
  onNavigate?: (page: PublicPageKey) => void;
  className?: string;
}

export const HomeNewsPreview: React.FC<HomeNewsPreviewProps> = ({
  currentLanguage,
  onNavigate,
  className = '',
}) => {
  const isArabic = currentLanguage === 'ar';
  const [articles, setArticles] = useState<News[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<unknown | null>(null);

  const loadPublishedNews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fetched = await PublicNewsClient.listPublishedNews({
        language: currentLanguage,
      });
      // Cap at up to 3 published articles for the homepage preview
      setArticles(fetched.slice(0, 3));
    } catch (err: unknown) {
      setError(err);
      setArticles([]);
    } finally {
      setLoading(false);
    }
  }, [currentLanguage]);

  useEffect(() => {
    loadPublishedNews();
  }, [loadPublishedNews]);

  const handleSelectArticle = (article: News) => {
    const titleForSlug = isArabic
      ? article.titleAr
      : (article.titleEn || article.titleAr);
    const slug = PublicNewsClient.getSlug(titleForSlug);
    const targetHash = slug ? `#news/${slug}` : `#news/${article.id}`;

    if (typeof window !== 'undefined') {
      window.location.hash = targetHash;
    }
    if (onNavigate) {
      onNavigate('news');
    }
  };

  const handleBrowseAll = () => {
    if (typeof window !== 'undefined') {
      window.location.hash = '#news';
    }
    if (onNavigate) {
      onNavigate('news');
    }
  };

  return (
    <Section
      id="news-preview-section"
      className={`bg-white dark:bg-gray-900 border-b border-gray-200/70 dark:border-gray-800/70 pop-motion-section ${className}`}
      aria-label={isArabic ? 'الأخبار والتحقيقات البيئية' : 'Environmental News & Investigations'}
    >
      <Container>
        {/* Section Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
          <div className="space-y-2 max-w-2xl">
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">
              {isArabic ? 'الأخبار والتحقيقات البيئية' : 'Environmental News & Investigations'}
            </h2>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300 leading-relaxed">
              {isArabic
                ? 'متابعات ميدانية وتحقيقات موثقة حول قضايا المناخ والبيئة والموارد الطبيعية'
                : 'Field investigations and verified reports on climate, environment, and natural resources'}
            </p>
          </div>

          <button
            type="button"
            onClick={handleBrowseAll}
            className="inline-flex items-center gap-2 self-start sm:self-auto px-4 py-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900 text-emerald-800 dark:text-emerald-300 text-xs sm:text-sm font-semibold border border-emerald-200 dark:border-emerald-800/70 transition-colors pop-motion-micro cursor-pointer whitespace-nowrap"
          >
            <span>{isArabic ? 'تصفح جميع الأخبار' : 'Browse All News'}</span>
            {isArabic ? (
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            ) : (
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        </div>

        {/* 1. Loading State */}
        {loading && (
          <div className="p-12 text-center bg-gray-50 dark:bg-gray-950/40 rounded-2xl border border-gray-200/80 dark:border-gray-800 space-y-3">
            <Loader2 className="w-7 h-7 animate-spin text-emerald-600 dark:text-emerald-400 mx-auto" />
            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 font-medium">
              {isArabic ? 'جاري تحميل الأخبار المنشورة...' : 'Loading published news articles...'}
            </p>
          </div>
        )}

        {/* 2. Error State (Fail-closed, no mock fallback) */}
        {!loading && Boolean(error) && (
          <ErrorBanner
            error={error}
            isAr={isArabic}
            action={{
              label: isArabic ? 'إعادة المحاولة' : 'Retry',
              onClick: loadPublishedNews,
            }}
          />
        )}

        {/* 3. Truthful Empty State */}
        {!loading && !error && articles.length === 0 && (
          <div className="p-10 text-center bg-gray-50 dark:bg-gray-950/30 rounded-2xl border border-gray-200 dark:border-gray-800 space-y-2 max-w-xl mx-auto">
            <h3 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white">
              {isArabic ? 'لا توجد أخبار منشورة حالياً' : 'No Published News Articles Available'}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {isArabic
                ? 'يتم نشر التغطيات والتحقيقات الإخبارية فور اعتمادها النهائي من هيئة التحرير.'
                : 'News coverage and investigative reports will appear here once approved for publication.'}
            </p>
          </div>
        )}

        {/* 4. Articles Grid */}
        {!loading && !error && articles.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
            {articles.map((article) => (
              <NewsCard
                key={article.id}
                news={article}
                currentLanguage={currentLanguage}
                onClick={() => handleSelectArticle(article)}
                className="h-full hover:shadow-lg transition-all duration-200"
              />
            ))}
          </div>
        )}
      </Container>
    </Section>
  );
};
