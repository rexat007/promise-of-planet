import React, { useState } from 'react';
import type { News } from '../../types';
import type { PublicNewsArticle } from '../../types/news';
import { ContentCard } from './ContentCard';
import { getUrgencyLabel } from './contentFormatters';
import { isArabicAvailableForArticle, isEnglishAvailableForArticle } from '../../services/contentLanguage';
import { PublicNewsClient } from '../../services/publicNewsClient';

export interface NewsCardProps {
  news: News | PublicNewsArticle;
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
  const [failedCoverUrl, setFailedCoverUrl] = useState<string | null>(null);
  const normalizedNews = PublicNewsClient.normalizeNewsForCard(news, 'card');
  const activeFeaturedImage =
    normalizedNews.featuredImage &&
    normalizedNews.featuredImage.url !== failedCoverUrl
      ? normalizedNews.featuredImage
      : undefined;

  const isArabic = currentLanguage === 'ar';
  const hasArabic = isArabicAvailableForArticle(normalizedNews);
  const hasEnglish = isEnglishAvailableForArticle(normalizedNews);

  // Resolve localized text without defaulting to empty text when requested lang is missing
  let title = '';
  let excerpt = '';

  if (isArabic) {
    title = hasArabic ? normalizedNews.titleAr : (normalizedNews.titleEn || normalizedNews.titleAr);
    excerpt = hasArabic ? normalizedNews.excerptAr : (normalizedNews.excerptEn || normalizedNews.excerptAr);
  } else {
    // English requested
    title = hasEnglish ? (normalizedNews.titleEn || '') : normalizedNews.titleAr;
    excerpt = hasEnglish ? (normalizedNews.excerptEn || '') : normalizedNews.excerptAr;
  }

  const isDisplayingEnglishTitle = isArabic
    ? (!hasArabic && Boolean(normalizedNews.titleEn))
    : hasEnglish;
  const rawKicker = isDisplayingEnglishTitle ? normalizedNews.kickerEn : normalizedNews.kickerAr;
  const kicker = rawKicker?.trim() ? rawKicker.trim() : undefined;

  // Urgency badge if Urgent or Breaking
  let badge: React.ReactNode = null;
  if (normalizedNews.urgencyLevel === 'Breaking') {
    badge = (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-red-600 text-white shadow-sm animate-pulse">
        {getUrgencyLabel('Breaking', isArabic)}
      </span>
    );
  } else if (normalizedNews.urgencyLevel === 'Urgent') {
    badge = (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500 text-white shadow-sm">
        {getUrgencyLabel('Urgent', isArabic)}
      </span>
    );
  }

  const handleImageErrorCapture = (event: React.SyntheticEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target && target.tagName === 'IMG' && activeFeaturedImage?.url) {
      setFailedCoverUrl(activeFeaturedImage.url);
    }
  };

  return (
    <div className="contents" onErrorCapture={handleImageErrorCapture}>
      <ContentCard
        contentType="News"
        title={title}
        kicker={kicker}
        excerpt={excerpt}
        category={normalizedNews.category}
        publishedAt={normalizedNews.publishedAt || normalizedNews.createdAt}
        isArabic={isArabic}
        featuredImage={activeFeaturedImage}
        authorOrProducer={normalizedNews.author}
        location={normalizedNews.location}
        badge={badge}
        onClick={onClick}
        className={className}
      />
    </div>
  );
};
