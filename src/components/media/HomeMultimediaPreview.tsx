import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, ArrowRight, ArrowLeft, X, Calendar, ChevronDown, ChevronUp } from 'lucide-react';
import { Section } from '../layout/Section';
import { Container } from '../layout/Container';
import { VideoCard, VideoEmbed } from '../content';
import { ErrorBanner } from '../common/ErrorBanner';
import { PublicMediaClient } from '../../services/publicMediaClient';
import type { Video, Language } from '../../types';
import type { PublicPageKey } from '../layout/Header';

export interface HomeMultimediaPreviewProps {
  currentLanguage: Language;
  onNavigate?: (page: PublicPageKey) => void;
  className?: string;
}

export const HomeMultimediaPreview: React.FC<HomeMultimediaPreviewProps> = ({
  currentLanguage,
  onNavigate,
  className = '',
}) => {
  const isArabic = currentLanguage === 'ar';
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<unknown | null>(null);

  // Modal playback state
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [isDescExpanded, setIsDescExpanded] = useState<boolean>(false);
  const modalCloseButtonRef = useRef<HTMLButtonElement>(null);

  const loadMultimedia = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await PublicMediaClient.fetchPublicMultimedia(currentLanguage);

      // De-duplicate videos by id
      const seen = new Set<string>();
      const uniqueVideos: Video[] = [];
      for (const v of data.videos) {
        if (!seen.has(v.id)) {
          seen.add(v.id);
          uniqueVideos.push(v);
        }
      }

      // Sort descending by publication date
      uniqueVideos.sort((a, b) => {
        const dateA = new Date(a.publishedAt || a.youtubeSource.youtubePublishedAt || a.createdAt).getTime();
        const dateB = new Date(b.publishedAt || b.youtubeSource.youtubePublishedAt || b.createdAt).getTime();
        return dateB - dateA;
      });

      // Cap at 3 videos for the homepage preview
      setVideos(uniqueVideos.slice(0, 3));
    } catch (err: unknown) {
      setError(err);
      setVideos([]);
    } finally {
      setLoading(false);
    }
  }, [currentLanguage]);

  useEffect(() => {
    loadMultimedia();
  }, [loadMultimedia]);

  // Reset description expansion on video switch
  useEffect(() => {
    setIsDescExpanded(false);
  }, [selectedVideo?.id]);

  // Keyboard accessibility: Close modal on Escape
  useEffect(() => {
    if (!selectedVideo) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedVideo(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    // Focus the close button when modal opens
    modalCloseButtonRef.current?.focus();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedVideo]);

  const handleBrowseAll = () => {
    if (onNavigate) {
      onNavigate('media');
    }
  };

  // Helper to extract localized title
  const getLocalizedTitle = (v: Video): string => {
    if (isArabic) {
      return v.titleAr || v.titleEn || '';
    }
    return v.titleEn || v.titleAr || '';
  };

  // Helper to extract localized description
  const getLocalizedDescription = (v: Video): string => {
    if (isArabic) {
      return v.editorialDescriptionAr || v.excerptAr || v.youtubeSource.originalDescription || '';
    }
    return v.editorialDescriptionEn || v.excerptEn || v.editorialDescriptionAr || v.excerptAr || '';
  };

  const modalTitle = selectedVideo ? getLocalizedTitle(selectedVideo) : '';
  const modalDesc = selectedVideo ? getLocalizedDescription(selectedVideo) : '';
  const isDescLong = modalDesc.length > 250;
  const displayedDesc = isDescLong && !isDescExpanded ? `${modalDesc.slice(0, 250)}...` : modalDesc;

  return (
    <Section
      id="multimedia-preview-section"
      className={`bg-gray-50/70 dark:bg-gray-950/70 border-b border-gray-200/70 dark:border-gray-800/70 pop-motion-section ${className}`}
      aria-label={isArabic ? 'التغطيات المرئية والوسائط المتعددة' : 'Multimedia & Visual Coverage'}
    >
      <Container>
        {/* Nile-blue / Dark Slate Container Card */}
        <div className="bg-gradient-to-br from-slate-900 via-emerald-950/90 to-slate-950 text-white rounded-3xl p-6 sm:p-10 lg:p-12 border border-emerald-900/50 shadow-2xl relative overflow-hidden">
          {/* Subtle Radial Glow */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Section Header */}
          <div className="relative z-10 flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
            <div className="space-y-2 max-w-2xl">
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-emerald-900/80 text-emerald-300 border border-emerald-700/50">
                {isArabic ? 'مكتبة الإنتاج المرئي' : 'Visual Media Library'}
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-emerald-400">
                {isArabic ? 'التغطيات المرئية والوسائط المتعددة' : 'Multimedia & Visual Coverage'}
              </h2>
              <p className="text-sm sm:text-base text-gray-300 leading-relaxed">
                {isArabic
                  ? 'أحدث الإنتاجات المرئية والتوثيقات الميدانية للقضايا البيئية والتنموية'
                  : 'Latest video productions and field documentations on environmental and ecological issues'}
              </p>
            </div>

            <button
              type="button"
              onClick={handleBrowseAll}
              className="inline-flex items-center gap-2 self-start sm:self-auto px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-semibold shadow-md transition-colors pop-motion-micro cursor-pointer whitespace-nowrap"
            >
              <span>{isArabic ? 'تصفح جميع الفيديوهات' : 'Browse All Videos'}</span>
              {isArabic ? (
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              ) : (
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          </div>

          {/* 1. Loading State */}
          {loading && (
            <div className="relative z-10 p-12 text-center bg-slate-950/50 rounded-2xl border border-slate-800 space-y-3">
              <Loader2 className="w-7 h-7 animate-spin text-emerald-400 mx-auto" />
              <p className="text-xs sm:text-sm text-gray-400 font-medium">
                {isArabic ? 'جاري تحميل المواد المرئية...' : 'Loading video productions...'}
              </p>
            </div>
          )}

          {/* 2. Error State (Fail-closed, no fake fallback) */}
          {!loading && Boolean(error) && (
            <div className="relative z-10">
              <ErrorBanner
                error={error}
                isAr={isArabic}
                action={{
                  label: isArabic ? 'إعادة المحاولة' : 'Retry',
                  onClick: loadMultimedia,
                }}
              />
            </div>
          )}

          {/* 3. Truthful Empty State */}
          {!loading && !error && videos.length === 0 && (
            <div className="relative z-10 p-10 text-center bg-slate-950/40 rounded-2xl border border-slate-800/80 space-y-2 max-w-xl mx-auto">
              <h3 className="text-sm sm:text-base font-semibold text-white">
                {isArabic ? 'لا توجد مواد مرئية منشورة حالياً' : 'No Published Video Content Available'}
              </h3>
              <p className="text-xs text-gray-400">
                {isArabic
                  ? 'يتم إتاحة المواد والتقارير المرئية فور مراجعتها واعتماد نشرها على المنصة.'
                  : 'Video reports and multimedia materials will be displayed once published.'}
              </p>
            </div>
          )}

          {/* 4. Video Cards Grid */}
          {!loading && !error && videos.length > 0 && (
            <div className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-6">
              {videos.map((video) => (
                <div key={video.id} className="h-full">
                  <VideoCard
                    video={video}
                    currentLanguage={currentLanguage}
                    onClick={() => setSelectedVideo(video)}
                    className="h-full border-slate-800 bg-slate-950/90 text-white hover:border-emerald-500/60 transition-all duration-200"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </Container>

      {/* Video Playback Modal Overlay */}
      {selectedVideo && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={modalTitle}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-xs animate-in fade-in duration-200"
          onClick={() => setSelectedVideo(null)}
        >
          <div
            className="relative w-full max-w-4xl max-h-[90vh] flex flex-col bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-2xl border border-gray-200 dark:border-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header Bar */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  {isArabic ? 'المشغل المرئي للمنصة' : 'Platform Video Player'}
                </span>
              </div>
              <button
                ref={modalCloseButtonRef}
                type="button"
                onClick={() => setSelectedVideo(null)}
                aria-label={isArabic ? 'إغلاق نافذة الفيديو' : 'Close video modal'}
                className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Video Player (Canonical VideoEmbed) */}
            <div className="w-full bg-black">
              <VideoEmbed
                youtubeSource={selectedVideo.youtubeSource}
                title={modalTitle}
                isArabic={isArabic}
                aspectRatio="16/9"
              />
            </div>

            {/* Video Metadata & Description */}
            <div className="p-5 sm:p-6 overflow-y-auto space-y-3">
              <h3 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white leading-snug">
                {modalTitle}
              </h3>

              {/* Publication Date & Channel Metadata */}
              <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800 pb-3">
                {(selectedVideo.publishedAt || selectedVideo.youtubeSource.youtubePublishedAt) && (
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-gray-400" />
                    <span>
                      {new Date(
                        selectedVideo.publishedAt || selectedVideo.youtubeSource.youtubePublishedAt
                      ).toLocaleDateString(isArabic ? 'ar-SD' : 'en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </span>
                )}
                {selectedVideo.youtubeSource.channelName && (
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">
                    {selectedVideo.youtubeSource.channelName}
                  </span>
                )}
                {selectedVideo.youtubeSource.duration && (
                  <span className="font-mono bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded text-[11px]">
                    {selectedVideo.youtubeSource.duration}
                  </span>
                )}
              </div>

              {/* Description with 250 chars boundary */}
              {modalDesc && (
                <div className="space-y-2">
                  <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-line">
                    {displayedDesc}
                  </p>
                  {isDescLong && (
                    <button
                      type="button"
                      onClick={() => setIsDescExpanded(!isDescExpanded)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 cursor-pointer pt-1"
                    >
                      <span>{isDescExpanded ? (isArabic ? 'عرض أقل' : 'Show less') : (isArabic ? 'قراءة المزيد' : 'Read more')}</span>
                      {isDescExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Section>
  );
};
