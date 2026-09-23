import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, BookOpen } from 'lucide-react';
import { getCategoryLabel } from './contentFormatters';
import type { TrainingCourse } from '../../types/training';
import { TrainingCourseService } from '../../services/trainingCourseService';
import { CourseAccessModal } from '../training/CourseAccessModal';
import { ErrorBanner } from '../common/ErrorBanner';

export type TrainingCoursePreview = TrainingCourse;

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
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<unknown | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<TrainingCourse | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const loadPublishedCourses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fetched = await TrainingCourseService.listCourses();
      // Canonical repository filters for WorkflowState.Published when includeUnpublished is false
      setCourses(fetched.slice(0, 3));
    } catch (err: unknown) {
      setError(err);
      setCourses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPublishedCourses();
  }, [loadPublishedCourses]);

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

  const handleCardClick = (course: TrainingCourse) => {
    setSelectedCourse(course);
    setIsModalOpen(true);
  };

  const handleExploreClick = () => {
    if (onExploreTraining) {
      onExploreTraining();
    }
  };

  return (
    <section
      className={`space-y-6 ${className}`}
      aria-label={isArabic ? 'أحدث البرامج التدريبية' : 'Latest Training Courses'}
    >
      {/* 1. Loading State */}
      {loading && (
        <div className="p-8 text-center bg-gray-50 dark:bg-gray-900/60 rounded-xl border border-gray-200 dark:border-gray-800 space-y-3">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-600 mx-auto" />
          <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
            {isArabic ? 'جاري تحميل البرامج التدريبية المنشورة...' : 'Loading published training courses...'}
          </p>
        </div>
      )}

      {/* 2. Error State */}
      {!loading && Boolean(error) && (
        <ErrorBanner
          error={error}
          isAr={isArabic}
          action={{
            label: isArabic ? 'إعادة المحاولة' : 'Retry',
            onClick: loadPublishedCourses,
          }}
        />
      )}

      {/* 3. Truthful Empty State */}
      {!loading && !error && courses.length === 0 && (
        <div className="p-8 text-center bg-gray-50 dark:bg-gray-900/60 rounded-xl border border-gray-200 dark:border-gray-800 space-y-2">
          <BookOpen className="w-8 h-8 text-gray-400 mx-auto mb-1" />
          <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">
            {isArabic ? 'لا توجد برامج تدريبية منشورة حالياً' : 'No Published Training Courses Available'}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md mx-auto leading-relaxed">
            {isArabic
              ? 'لا توجد برامج تدريبية منشورة حالياً في مركز التدريب. يرجى التحقق لاحقاً للحصول على المسارات المعتمدة الجديدة.'
              : 'There are currently no published training programs in the training center. Please check back later for newly approved programs.'}
          </p>
        </div>
      )}

      {/* 4. Canonical Published Course Cards */}
      {!loading && !error && courses.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {courses.map((course) => (
            <article
              key={course.id}
              onClick={() => handleCardClick(course)}
              className="flex flex-col justify-between bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 shadow-xs hover:border-emerald-500/80 hover:shadow-md transition-all duration-200 cursor-pointer group"
            >
              <div>
                {/* Header Badges */}
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60">
                    {getCategoryLabel(course.category, isArabic)}
                  </span>
                  <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 rounded border border-amber-200/60 dark:border-amber-900/60">
                    {isArabic ? levelLabels[course.level]?.ar : levelLabels[course.level]?.en}
                  </span>
                </div>

                {/* Title */}
                <h3 className="text-base font-bold text-gray-900 dark:text-white leading-snug mb-2 line-clamp-2 group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors">
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
                    {isArabic ? modeLabels[course.deliveryMode]?.ar : modeLabels[course.deliveryMode]?.en}
                  </span>
                  <span>
                    {isArabic ? `${course.durationHours} ساعة تدريبية` : `${course.durationHours} Hours`}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-gray-400 dark:text-gray-500 pt-1">
                  <span className="truncate max-w-[180px]">
                    {isArabic ? `الفئة: ${course.targetAudienceAr}` : `Audience: ${course.targetAudienceEn}`}
                  </span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold group-hover:underline shrink-0">
                    {isArabic ? 'عرض التفاصيل والوصول ←' : 'View Access →'}
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Prominent CTA */}
      {onExploreTraining && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={handleExploreClick}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-medium text-sm transition-colors shadow-sm cursor-pointer"
          >
            <span>{isArabic ? 'استكشف مسارات وبرامج مركز التدريب' : 'Explore Training Center Programs'}</span>
            <span aria-hidden="true">{isArabic ? '←' : '→'}</span>
          </button>
        </div>
      )}

      {/* Member Training Course Access Modal */}
      <CourseAccessModal
        course={selectedCourse}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        isAr={isArabic}
      />
    </section>
  );
};


