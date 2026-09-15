import React from 'react';
import type { Category, ContentType, ImageObject } from '../../types';
import { ContentMeta } from './ContentMeta';

export interface ContentCardProps {
  contentType: ContentType;
  title: string;
  excerpt: string;
  category: Category;
  publishedAt?: string;
  isArabic: boolean;
  featuredImage?: ImageObject;
  authorOrProducer?: string;
  location?: string;
  readTimeEstimate?: number;
  badge?: React.ReactNode;
  footer?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

export const ContentCard: React.FC<ContentCardProps> = ({
  contentType,
  title,
  excerpt,
  category,
  publishedAt,
  isArabic,
  featuredImage,
  authorOrProducer,
  location,
  readTimeEstimate,
  badge,
  footer,
  onClick,
  className = '',
}) => {
  const isInteractive = Boolean(onClick);

  return (
    <article
      onClick={onClick}
      className={`group flex flex-col bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm transition-all duration-200 overflow-hidden ${
        isInteractive ? 'cursor-pointer hover:border-emerald-500/50 hover:shadow-md' : ''
      } ${className}`}
    >
      {/* Featured Image if present */}
      {featuredImage && featuredImage.url && (
        <div className="relative w-full aspect-video sm:aspect-16/9 bg-gray-100 dark:bg-gray-800 overflow-hidden">
          <img
            src={featuredImage.url}
            alt={isArabic ? featuredImage.altAr : (featuredImage.altEn || featuredImage.altAr)}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-102"
          />
          {badge && (
            <div className="absolute top-3 start-3 z-10">
              {badge}
            </div>
          )}
        </div>
      )}

      {/* Card Content Body */}
      <div className="flex flex-col flex-1 p-5 sm:p-6">
        {/* Top Badges & Meta */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <ContentMeta
            category={category}
            contentType={contentType}
            publishedAt={publishedAt}
            isArabic={isArabic}
            authorOrProducer={authorOrProducer}
            location={location}
            readTimeEstimate={readTimeEstimate}
          />
          {!featuredImage && badge && <div>{badge}</div>}
        </div>

        {/* Title */}
        <h3 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white leading-snug mb-2 group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors line-clamp-2">
          {title}
        </h3>

        {/* Excerpt */}
        <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed line-clamp-3 mb-4 flex-1">
          {excerpt}
        </p>

        {/* Optional Custom Footer / Actions */}
        {footer && <div className="pt-3 border-t border-gray-100 dark:border-gray-800/80 mt-auto">{footer}</div>}
      </div>
    </article>
  );
};
