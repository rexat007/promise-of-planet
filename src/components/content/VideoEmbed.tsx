import React from 'react';
import type { YouTubeSource } from '../../types';

export interface VideoEmbedProps {
  youtubeSource: YouTubeSource;
  title: string;
  isArabic?: boolean;
  className?: string;
  aspectRatio?: '16/9' | '4/3';
}

export const VideoEmbed: React.FC<VideoEmbedProps> = ({
  youtubeSource,
  title,
  isArabic = true,
  className = '',
  aspectRatio = '16/9',
}) => {
  const { availabilityStatus, youtubeVideoId } = youtubeSource;

  // Rule: Do NOT display YouTube player if status is Private, Deleted, or Unavailable
  if (availabilityStatus !== 'Available') {
    return (
      <div
        className={`w-full aspect-video bg-gray-100 dark:bg-gray-800/80 rounded-xl border border-gray-200 dark:border-gray-800 flex flex-col items-center justify-center p-6 text-center text-gray-500 dark:text-gray-400 ${className}`}
        role="alert"
        aria-live="polite"
      >
        <svg
          className="w-10 h-10 mb-3 text-gray-400 dark:text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
            d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
          />
        </svg>
        <p className="text-sm font-medium">
          {availabilityStatus === 'Private'
            ? isArabic
              ? 'هذا المحتوى المرئي غير متاح للعرض العام حاليًا (مادة خاصة أو قيد المراجعة الفنية).'
              : 'This video is currently set to private or under editorial review.'
            : isArabic
            ? 'المادة المرئية غير متوفرة على المنصة في الوقت الحالي.'
            : 'This video is currently unavailable on the host platform.'}
        </p>
      </div>
    );
  }

  // Embed URL with standard privacy-conscious attributes
  const embedUrl = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeVideoId)}`;

  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl bg-black border border-gray-200 dark:border-gray-800 shadow-sm ${
        aspectRatio === '16/9' ? 'aspect-video' : 'aspect-4/3'
      } ${className}`}
    >
      <iframe
        src={embedUrl}
        title={title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        loading="lazy"
        className="absolute inset-0 w-full h-full border-0"
      />
    </div>
  );
};
