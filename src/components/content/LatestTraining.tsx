import React from 'react';
import type { Category } from '../../types';
import { getCategoryLabel } from './contentFormatters';

export interface TrainingCoursePreview {
  id: string;
  titleAr: string;
  titleEn: string;
  summaryAr: string;
  summaryEn: string;
  category: Category;
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  durationHours: number;
  deliveryMode: 'OnlineSelfPaced' | 'LiveWorkshop' | 'FieldCohort';
  targetAudienceAr: string;
  targetAudienceEn: string;
}

const MOCK_TRAINING_COURSES: TrainingCoursePreview[] = [
  {
    id: 'course-01',
    titleAr: 'أساسيات الصحافة البيئية وتغطية أزمات المناخ في السودان',
    titleEn: 'Foundations of Environmental Journalism & Climate Reporting in Sudan',
    summaryAr: 'برنامج تدريبي يزود الصحفيين والباحثين بمهارات التحقق من البيانات المناخية وتوثيق الأثر المجتمعي.',
    summaryEn: 'Training curriculum equipping journalists with climate data verification and community impact storytelling.',
    category: 'Climate',
    level: 'Beginner',
    durationHours: 16,
    deliveryMode: 'OnlineSelfPaced',
    targetAudienceAr: 'الصحفيون، طلاب الإعلام، ونشطاء المجتمع المدني',
    targetAudienceEn: 'Journalists, media students, and civil society activists',
  },
  {
    id: 'course-02',
    titleAr: 'أدوات الاستشعار عن بعد ونظم المعلومات الجغرافية (GIS) في رصد التصحر',
    titleEn: 'Remote Sensing & GIS Tools for Desertification Tracking',
    summaryAr: 'تدريب تطبيقي على قراءة صور الأقمار الاصطناعية ومؤشرات الغطاء النباتي (NDVI) لتحليل تدهور الأراضي.',
    summaryEn: 'Hands-on training in satellite imagery analysis and vegetation indexes (NDVI) for land degradation.',
    category: 'Agriculture',
    level: 'Intermediate',
    durationHours: 24,
    deliveryMode: 'LiveWorkshop',
    targetAudienceAr: 'الباحثون البيئيون، المهندسون الزراعيون، ومحللو البيانات',
    targetAudienceEn: 'Environmental researchers, agronomists, and data analysts',
  },
  {
    id: 'course-03',
    titleAr: 'صحافة التحقيقات الاستقصائية الميدانية في حوكمة الموارد الطبيعية والمياه',
    titleEn: 'Investigative Field Reporting on Water Governance & Natural Resources',
    summaryAr: 'منهجية إعداد التحقيقات الميدانية المعمقة، حماية المصادر، وتوثيق انتهاكات استغلال الموارد.',
    summaryEn: 'Methodology for in-depth investigative reporting, source protection, and resource governance audits.',
    category: 'Water',
    level: 'Advanced',
    durationHours: 30,
    deliveryMode: 'FieldCohort',
    targetAudienceAr: 'المحققون الصحفيون، القانونيون، وفرق الاستقصاء البيئي',
    targetAudienceEn: 'Investigative journalists, legal researchers, and environmental investigators',
  },
];

export interface LatestTrainingProps {
  currentLanguage: 'ar' | 'en';
  onExploreTraining?: () => void;
  className?: string;
}

export const LatestTraining: React.FC<LatestTrainingProps> = ({
  currentLanguage,
  onExploreTraining,
  className = '',
}) => {
  const isArabic = currentLanguage === 'ar';

  const levelLabels: Record<string, { ar: string; en: string }> = {
    Beginner: { ar: 'مبتدئ / تأسيسي', en: 'Foundational' },
    Intermediate: { ar: 'متوسط / تطبيقي', en: 'Intermediate' },
    Advanced: { ar: 'متقدم / تخصصي', en: 'Advanced' },
  };

  const modeLabels: Record<string, { ar: string; en: string }> = {
    OnlineSelfPaced: { ar: 'تدريب رقمي ذاتي', en: 'Self-Paced Online' },
    LiveWorkshop: { ar: 'ورشة عمل تفاعلية', en: 'Interactive Workshop' },
    FieldCohort: { ar: 'تدريب ميداني تطبيقي', en: 'Field Practicum Cohort' },
  };

  return (
    <section
      className={`space-y-6 ${className}`}
      aria-label={isArabic ? 'أحدث البرامج التدريبية' : 'Latest Training Courses'}
    >
      {/* 3 Limited Curated Course Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {MOCK_TRAINING_COURSES.map((course) => (
          <article
            key={course.id}
            className="flex flex-col justify-between bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 shadow-xs hover:border-emerald-500/50 hover:shadow-md transition-all duration-200"
          >
            <div>
              {/* Header Badges */}
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60">
                  {getCategoryLabel(course.category, isArabic)}
                </span>
                <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 rounded border border-amber-200/60 dark:border-amber-900/60">
                  {isArabic ? levelLabels[course.level].ar : levelLabels[course.level].en}
                </span>
              </div>

              {/* Title */}
              <h3 className="text-base font-bold text-gray-900 dark:text-white leading-snug mb-2 line-clamp-2">
                {isArabic ? course.titleAr : course.titleEn}
              </h3>

              {/* Summary */}
              <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed line-clamp-3 mb-4">
                {isArabic ? course.summaryAr : course.summaryEn}
              </p>
            </div>

            {/* Meta and Audience Footer */}
            <div className="space-y-2 pt-3 border-t border-gray-100 dark:border-gray-800 text-xs">
              <div className="flex items-center justify-between text-gray-500 dark:text-gray-400">
                <span className="font-medium text-emerald-800 dark:text-emerald-400">
                  {isArabic ? modeLabels[course.deliveryMode].ar : modeLabels[course.deliveryMode].en}
                </span>
                <span>
                  {isArabic ? `${course.durationHours} ساعة تدريبية` : `${course.durationHours} Hours`}
                </span>
              </div>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                {isArabic ? `الفئة: ${course.targetAudienceAr}` : `Audience: ${course.targetAudienceEn}`}
              </p>
            </div>
          </article>
        ))}
      </div>

      {/* Prominent CTA */}
      <div className="flex justify-center pt-2">
        <button
          type="button"
          onClick={onExploreTraining}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-medium text-sm transition-colors shadow-sm"
        >
          <span>{isArabic ? 'استكشف مسارات وبرامج مركز التدريب' : 'Explore Training Center Programs'}</span>
          <span aria-hidden="true">{isArabic ? '←' : '→'}</span>
        </button>
      </div>
    </section>
  );
};
