import React from 'react';
import type { Category } from '../../types';
import { getCategoryLabel } from './contentFormatters';

export interface LibraryItemPreview {
  id: string;
  titleAr: string;
  titleEn: string;
  excerptAr: string;
  excerptEn: string;
  category: Category;
  format: 'PDF' | 'ResearchPaper' | 'PolicyBrief' | 'Toolkit';
  pages?: number;
  publishedDate: string;
}

const MOCK_LIBRARY_PREVIEWS: LibraryItemPreview[] = [
  {
    id: 'lib-01',
    titleAr: 'دليل الإدارة المستدامة للمياه الجوفية في حوض النيل وحزام الساحل',
    titleEn: 'Handbook of Sustainable Groundwater Management in the Nile Basin & Sahel',
    excerptAr: 'مرجع تطبيقي شامل لتقنيات حماية الآبار الجوفية وإدارة الحفائر المائية في المناطق شبه الجافة.',
    excerptEn: 'Comprehensive practical guide on borehole protection and water catchment reservoirs in semi-arid lands.',
    category: 'Water',
    format: 'PDF',
    pages: 64,
    publishedDate: '2026-02-15',
  },
  {
    id: 'lib-02',
    titleAr: 'تقييم الغطاء النباتي وتأثير الكثبان الرملية على الزراعة المطرية في السودان',
    titleEn: 'Vegetation Cover Assessment & Sand Dune Impacts on Rainfed Agriculture in Sudan',
    excerptAr: 'ورقة بحثية بيئية محكّمة تحلل معدلات التراجع الشجري وآليات زراعة الأحزمة الخضراء الواقية.',
    excerptEn: 'Peer-reviewed research paper analyzing tree cover reduction and protective shelterbelt mechanics.',
    category: 'Agriculture',
    format: 'ResearchPaper',
    pages: 42,
    publishedDate: '2026-01-28',
  },
  {
    id: 'lib-03',
    titleAr: 'موجز سياسات: التشريعات البيئية والمسؤولية المناخية لقطاع التعدين التقليدي',
    titleEn: 'Policy Brief: Environmental Legislation & Climate Liability in Artisanal Mining',
    excerptAr: 'توصيات سياساتية موجزة للمشرعين والمنظمات حول حظر استخدام الزئبق وحماية الموارد المائية.',
    excerptEn: 'Concise policy recommendations for regulators on banning mercury and safeguarding water sources.',
    category: 'EnvironmentalPolicy',
    format: 'PolicyBrief',
    pages: 18,
    publishedDate: '2026-02-05',
  },
];

export interface LatestLibraryProps {
  currentLanguage: 'ar' | 'en';
  onExploreLibrary?: () => void;
  className?: string;
}

export const LatestLibrary: React.FC<LatestLibraryProps> = ({
  currentLanguage,
  onExploreLibrary,
  className = '',
}) => {
  const isArabic = currentLanguage === 'ar';

  const formatLabels: Record<string, { ar: string; en: string }> = {
    PDF: { ar: 'كتيب توثيقي PDF', en: 'Documentary PDF' },
    ResearchPaper: { ar: 'ورقة بحثية محكمة', en: 'Peer-Reviewed Paper' },
    PolicyBrief: { ar: 'موجز سياسات وتشريعات', en: 'Policy Brief' },
    Toolkit: { ar: 'حقيبة أدوات معرفية', en: 'Knowledge Toolkit' },
  };

  return (
    <section
      className={`space-y-6 ${className}`}
      aria-label={isArabic ? 'أحدث مواد المكتبة البيئية' : 'Latest Library Materials'}
    >
      {/* 3 Limited Curated Previews */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {MOCK_LIBRARY_PREVIEWS.map((item) => (
          <article
            key={item.id}
            className="flex flex-col justify-between bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 shadow-xs hover:border-emerald-500/50 hover:shadow-md transition-all duration-200"
          >
            <div>
              {/* Category & Format Badges */}
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60">
                  {getCategoryLabel(item.category, isArabic)}
                </span>
                <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
                  {isArabic ? formatLabels[item.format].ar : formatLabels[item.format].en}
                </span>
              </div>

              {/* Title */}
              <h3 className="text-base font-bold text-gray-900 dark:text-white leading-snug mb-2 line-clamp-2">
                {isArabic ? item.titleAr : item.titleEn}
              </h3>

              {/* Excerpt */}
              <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed line-clamp-3 mb-4">
                {isArabic ? item.excerptAr : item.excerptEn}
              </p>
            </div>

            {/* Footer Metadata */}
            <div className="pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>{item.pages ? (isArabic ? `${item.pages} صفحة` : `${item.pages} pages`) : ''}</span>
              <span className="font-mono">{item.publishedDate}</span>
            </div>
          </article>
        ))}
      </div>

      {/* Prominent CTA */}
      <div className="flex justify-center pt-2">
        <button
          type="button"
          onClick={onExploreLibrary}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-medium text-sm transition-colors shadow-sm"
        >
          <span>{isArabic ? 'استكشف المكتبة البيئية الكاملة' : 'Explore the Full Environmental Library'}</span>
          <span aria-hidden="true">{isArabic ? '←' : '→'}</span>
        </button>
      </div>
    </section>
  );
};
