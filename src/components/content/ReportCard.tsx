import React from 'react';
import type { Report } from '../../types';
import { ContentCard } from './ContentCard';
import { isArabicAvailableForArticle, isEnglishAvailableForArticle } from '../../services/contentLanguage';

export interface ReportCardProps {
  report: Report;
  currentLanguage: 'ar' | 'en';
  onClick?: () => void;
  className?: string;
}

export const ReportCard: React.FC<ReportCardProps> = ({
  report,
  currentLanguage,
  onClick,
  className = '',
}) => {
  const isArabic = currentLanguage === 'ar';
  const hasArabic = isArabicAvailableForArticle(report);
  const hasEnglish = isEnglishAvailableForArticle(report);

  // Resolve localized texts
  let title = '';
  let excerpt = '';

  if (isArabic) {
    title = hasArabic ? report.titleAr : (report.titleEn || report.titleAr);
    excerpt = hasArabic ? report.excerptAr : (report.excerptEn || report.excerptAr);
  } else {
    // English requested
    title = hasEnglish ? (report.titleEn || '') : report.titleAr;
    excerpt = hasEnglish ? (report.excerptEn || '') : report.excerptAr;
  }

  // Report indicator badge (In-Depth investigative badge)
  const badge = (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-700 text-white shadow-sm">
      {isArabic ? 'تحقيق استقصائي' : 'In-Depth Investigation'}
    </span>
  );

  // Optional footer displaying key findings counter or section count
  const findingsCount = report.keyFindings?.length || 0;
  const sectionsCount = report.sections?.length || 0;

  const footer = (findingsCount > 0 || sectionsCount > 0) ? (
    <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
      {sectionsCount > 0 && (
        <span>
          {isArabic ? `${sectionsCount} محاور رئيسية` : `${sectionsCount} Key Sections`}
        </span>
      )}
      {findingsCount > 0 && (
        <span className="font-medium text-emerald-700 dark:text-emerald-400">
          {isArabic ? `${findingsCount} استنتاجات موثقة` : `${findingsCount} Verified Findings`}
        </span>
      )}
    </div>
  ) : undefined;

  return (
    <ContentCard
      contentType="Report"
      title={title}
      excerpt={excerpt}
      category={report.category}
      publishedAt={report.publishedAt || report.createdAt}
      isArabic={isArabic}
      featuredImage={report.featuredImage}
      authorOrProducer={report.author}
      readTimeEstimate={report.readTimeEstimate}
      badge={badge}
      footer={footer}
      onClick={onClick}
      className={className}
    />
  );
};
