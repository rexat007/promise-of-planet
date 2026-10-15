import React from 'react';
import { BookOpen, FileCheck, Scale, Sparkles } from 'lucide-react';

export interface LatestLibraryProps {
  currentLanguage: 'ar' | 'en';
  onExploreLibrary?: () => void;
  className?: string;
}

export const LatestLibrary: React.FC<LatestLibraryProps> = ({
  currentLanguage,
  className = '',
}) => {
  const isArabic = currentLanguage === 'ar';

  const plannedTracks = [
    {
      id: 'handbooks',
      icon: BookOpen,
      titleAr: 'أدلة إرشادية للمياه والأراضي',
      titleEn: 'Water & Land Practice Handbooks',
      descAr: 'يجري حصر وجمع الأدلة الإرشادية والتطبيقية لإدارة الموارد المائية ومكافحة التصحر تمهيداً لإتاحتها مستقبلاً.',
      descEn: 'Applied guides and handbooks for water management and anti-desertification are being gathered for future publication.',
    },
    {
      id: 'research',
      icon: FileCheck,
      titleAr: 'دراسات وأوراق بيئية',
      titleEn: 'Environmental Studies & Papers',
      descAr: 'يجري رصد ومراجعة الأوراق البحثية والدراسات البيئية المعنية بآثار التغير المناخي والغطاء النباتي لإدراجها في الأرشيف.',
      descEn: 'Environmental research papers on climate impacts and vegetation trends are being surveyed and reviewed for future archiving.',
    },
    {
      id: 'policy',
      icon: Scale,
      titleAr: 'مواجز السياسات والتشريعات البيئية',
      titleEn: 'Policy & Legislative Briefs',
      descAr: 'يجري تجميع ومراجعة أوراق الموقف والتوصيات التنظيمية الخاصة بحوكمة الموارد الطبيعية لإتاحتها للباحثين.',
      descEn: 'Policy briefs and regulatory recommendations on natural resource governance are being compiled for researchers.',
    },
  ];

  return (
    <section
      className={`space-y-6 ${className}`}
      aria-label={isArabic ? 'المكتبة البيئية والمصادر المعرفية' : 'Environmental Library & Knowledge Resources'}
    >
      {/* Editorial Curation Banner */}
      <div className="bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/60 rounded-2xl p-6 sm:p-8 text-center max-w-3xl mx-auto space-y-3">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300">
          <Sparkles className="w-3.5 h-3.5" />
          <span>{isArabic ? 'المكتبة الرقمية — قيد التجميع والمراجعة' : 'Digital Library — Curation & Review in Progress'}</span>
        </div>
        <h3 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">
          {isArabic ? 'قيد التجميع والمراجعة التحريرية' : 'Curation & Review in Progress'}
        </h3>
        <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 leading-relaxed max-w-2xl mx-auto">
          {isArabic
            ? 'تعمل المنصة حالياً على جمع ومراجعة وتدقيق المواد المعرفية والأدلة الإرشادية البيئية تمهيداً لنشرها تباعاً، لضمان مصداقية المصادر ودقتها التحريرية.'
            : 'Environmental knowledge resources and practice guides are currently being compiled and reviewed for future public release, ensuring source credibility and editorial accuracy.'}
        </p>
      </div>

      {/* Forthcoming Curated Collections */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plannedTracks.map((track) => {
          const Icon = track.icon;
          return (
            <div
              key={track.id}
              className="flex flex-col justify-between bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 shadow-xs transition-all duration-200"
            >
              <div className="space-y-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
                  <Icon className="w-5 h-5" />
                </div>
                <h4 className="text-base font-bold text-gray-900 dark:text-white leading-snug">
                  {isArabic ? track.titleAr : track.titleEn}
                </h4>
                <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                  {isArabic ? track.descAr : track.descEn}
                </p>
              </div>

              <div className="pt-4 mt-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
                <span className="inline-block px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-medium">
                  {isArabic ? 'قيد التجميع' : 'In Compilation'}
                </span>
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                  {isArabic ? 'مراجعة وتدقيق' : 'Under Review'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};


