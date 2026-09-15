import React from 'react';
import type { Category, ContentType } from '../../types';
import { getCategoryLabel, getContentTypeLabel, formatDate } from './contentFormatters';

export interface ContentMetaProps {
  category: Category;
  contentType?: ContentType;
  publishedAt?: string;
  isArabic: boolean;
  authorOrProducer?: string;
  location?: string;
  readTimeEstimate?: number;
  className?: string;
}

export const ContentMeta: React.FC<ContentMetaProps> = ({
  category,
  contentType,
  publishedAt,
  isArabic,
  authorOrProducer,
  location,
  readTimeEstimate,
  className = '',
}) => {
  const formattedDate = formatDate(publishedAt, isArabic);

  return (
    <div
      className={`flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400 font-medium ${className}`}
    >
      {/* Content Type Badge if provided */}
      {contentType && (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-semibold">
          {getContentTypeLabel(contentType, isArabic)}
        </span>
      )}

      {/* Category Tag */}
      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60">
        {getCategoryLabel(category, isArabic)}
      </span>

      {/* Date */}
      {formattedDate && (
        <time dateTime={publishedAt} className="inline-flex items-center gap-1">
          <span>•</span>
          <span>{formattedDate}</span>
        </time>
      )}

      {/* Location (for News) */}
      {location && (
        <span className="inline-flex items-center gap-1">
          <span>•</span>
          <span>{location}</span>
        </span>
      )}

      {/* Author / Producer */}
      {authorOrProducer && (
        <span className="inline-flex items-center gap-1">
          <span>•</span>
          <span>{authorOrProducer}</span>
        </span>
      )}

      {/* Read Time Estimate (for Reports) */}
      {readTimeEstimate !== undefined && (
        <span className="inline-flex items-center gap-1">
          <span>•</span>
          <span>
            {isArabic
              ? `${readTimeEstimate} دقائق قراءة`
              : `${readTimeEstimate} min read`}
          </span>
        </span>
      )}
    </div>
  );
};
