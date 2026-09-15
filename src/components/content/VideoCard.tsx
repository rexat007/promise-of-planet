import React from 'react';
import type { Video } from '../../types';
import { ContentMeta } from './ContentMeta';
import { isArabicAvailableForVideo, isEnglishAvailableForVideo } from '../../services/contentLanguage';

export interface VideoCardProps {
  video: Video;
  currentLanguage: 'ar' | 'en';
  onClick?: () => void;
  className?: string;
}

export const VideoCard: React.FC<VideoCardProps> = ({
  video,
  currentLanguage,
  onClick,
  className = '',
}) => {
  const isArabic = currentLanguage === 'ar';
  const hasArabic = isArabicAvailableForVideo(video);
  const hasEnglish = isEnglishAvailableForVideo(video);

  // Strictly prioritize Editorial Title & Excerpt over raw YouTube originalTitle/originalDescription
  let title = '';
  let excerpt = '';

  if (isArabic) {
    title = hasArabic ? video.titleAr : (video.titleEn || video.titleAr);
    excerpt = hasArabic ? video.excerptAr : (video.excerptEn || video.excerptAr);
  } else {
    // English requested
    title = hasEnglish ? (video.titleEn || '') : video.titleAr;
    excerpt = hasEnglish ? (video.excerptEn || '') : video.excerptAr;
  }

  // Use Editorial Thumbnail first; fallback to YouTube standard/high thumbnail
  const thumbnailUrl =
    video.editorialThumbnail?.url ||
    video.youtubeSource.thumbnails.high ||
    video.youtubeSource.thumbnails.medium ||
    video.youtubeSource.thumbnails.default;

  const thumbnailAlt =
    video.editorialThumbnail?.altAr ||
    title ||
    (isArabic ? 'صورة مصغرة للمادة المرئية' : 'Video thumbnail');

  const isInteractive = Boolean(onClick);

  return (
    <article
      onClick={onClick}
      className={`group flex flex-col bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm transition-all duration-200 overflow-hidden ${
        isInteractive ? 'cursor-pointer hover:border-emerald-500/50 hover:shadow-md' : ''
      } ${className}`}
    >
      {/* Thumbnail with duration badge and play icon */}
      <div className="relative w-full aspect-video bg-gray-900 overflow-hidden">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={thumbnailAlt}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-102"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-950 text-gray-600">
            <span>Video</span>
          </div>
        )}

        {/* Play Overlay Icon */}
        <div className="absolute inset-0 bg-black/25 flex items-center justify-center group-hover:bg-black/40 transition-colors">
          <div className="w-12 h-12 rounded-full bg-emerald-600/90 text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
            <svg
              className="w-6 h-6 ms-0.5 fill-current"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>

        {/* Duration badge */}
        {video.youtubeSource.duration && (
          <div className="absolute bottom-2 end-2 bg-black/80 backdrop-blur-xs text-white text-xs font-mono font-medium px-2 py-0.5 rounded">
            {video.youtubeSource.duration}
          </div>
        )}

        {/* Captions indicator */}
        {video.youtubeSource.hasCaptions && (
          <div className="absolute bottom-2 start-2 bg-black/80 backdrop-blur-xs text-white text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase">
            CC
          </div>
        )}

        {/* Featured Badge */}
        {video.visibilityDecision === 'Featured' && (
          <div className="absolute top-2 start-2 bg-amber-500 text-white text-xs font-semibold px-2 py-0.5 rounded shadow-sm">
            {isArabic ? 'مميز' : 'Featured'}
          </div>
        )}
      </div>

      {/* Details Body */}
      <div className="flex flex-col flex-1 p-5">
        <div className="mb-2">
          <ContentMeta
            category={video.category}
            contentType="Video"
            publishedAt={video.publishedAt || video.createdAt}
            isArabic={isArabic}
            authorOrProducer={video.producer}
          />
        </div>

        {/* Editorial Title */}
        <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white leading-snug mb-2 group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors line-clamp-2">
          {title}
        </h3>

        {/* Editorial Excerpt */}
        {excerpt && (
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed line-clamp-2 mb-3">
            {excerpt}
          </p>
        )}

        {/* Channel attribution */}
        <div className="mt-auto pt-3 border-t border-gray-100 dark:border-gray-800/80 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <span className="truncate">
            {video.youtubeSource.channelName}
          </span>
          <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
            {isArabic ? 'شاهد الفيديو ←' : 'Watch Video →'}
          </span>
        </div>
      </div>
    </article>
  );
};
