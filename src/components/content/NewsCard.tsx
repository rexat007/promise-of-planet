import React from 'react';
import type { News } from '../../types';
import { ContentCard } from './ContentCard';
import { getUrgencyLabel } from './contentFormatters';
import { isArabicAvailableForArticle, isEnglishAvailableForArticle } from '../../services/contentLanguage';

export interface NewsCardProps {
  news: News;
  currentLanguage: 'ar' | 'en';
  onClick?: () => void;
  className?: string;
}

export const NewsCard: React.FC<NewsCardProps> = ({
  news,
  currentLanguage,
  onClick,
  className = '',
}) => {
  const isArabic = currentLanguage === 'ar';
  const hasArabic = isArabicAvailableForArticle(news);
  const hasEnglish = isEnglishAvailableForArticle(news);

  // Resolve localized text without defaulting to empty text when requested lang is missing
  let title = '';
  let excerpt = '';

  if (isArabic) {
    title = hasArabic ? news.titleAr : (news.titleEn || news.titleAr);
    excerpt = hasArabic ? news.excerptAr : (news.excerptEn || news.excerptAr);
  } else {
    // English requested
    title = hasEnglish ? (news.titleEn || '') : news.titleAr;
    excerpt = hasEnglish ? (news.excerptEn || '') : news.excerptAr;
  }

  // Urgency badge if Urgent or Breaking
  let badge: React.ReactNode = null;
  if (news.urgencyLevel === 'Breaking') {
    badge = (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-red-600 text-white shadow-sm animate-pulse">
        {getUrgencyLabel('Breaking', isArabic)}
      </span>
    );
  } else if (news.urgencyLevel === 'Urgent') {
    badge = (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500 text-white shadow-sm">
        {getUrgencyLabel('Urgent', isArabic)}
      </span>
    );
  }

  return (
    <ContentCard
      contentType="News"
      title={title}
      excerpt={excerpt}
      category={news.category}
      publishedAt={news.publishedAt || news.createdAt}
      isArabic={isArabic}
      featuredImage={news.featuredImage}
      authorOrProducer={news.author}
      location={news.location}
      badge={badge}
      onClick={onClick}
      className={className}
    />
  );
};
