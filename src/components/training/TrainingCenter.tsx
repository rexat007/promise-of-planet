import { useState, useEffect, useCallback } from 'react';
import { Loader2, BookOpen, Users, Clock, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Container } from '../layout/Container';
import { ErrorBanner } from '../common/ErrorBanner';
import { getCategoryLabel } from '../content/contentFormatters';
import { TrainingCourseService } from '../../services/trainingCourseService';
import { CourseAccessModal } from './CourseAccessModal';
import type { TrainingCourse } from '../../types/training';

export function TrainingCenter() {
  const { i18n } = useTranslation();
  const isArabic = i18n.language === 'ar';
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
      // Service automatically resolves ONLY Published courses (workflowState === WorkflowState.Published) when includeUnpublished is false
      setCourses(fetched);
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

  return (
    <div className="bg-gray-50/50 dark:bg-gray-950 min-h-screen py-6 sm:py-10 pop-page-fade">
      <Container>
        {/* Navigation Breadcrumb Header */}
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-200/80 dark:border-gray-800/80">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
            {isArabic ? 'مركز التدريب والأبحاث البيئية' : 'Environmental Training & Research Center'}
          </span>
        </div>

        {/* Main Title Banner */}
        <div className="mb-10 text-center max-w-3xl mx-auto space-y-3">
          <h1 className="text-2xl sm:text-4xl font-extrabold text-emerald-950 dark:text-emerald-300 tracking-tight leading-tight">
            {isArabic ? 'منصة التدريب والتمكين البيئي' : 'Environmental Empowerment & Training Hub'}
          </h1>
          <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 leading-relaxed">
            {isArabic
              ? 'مجموعة متكاملة من المسارات والبرامج التدريبية المنشورة لتمكين الباحثين والناشطين والمجتمعات المحلية من أدوات الإدارة المستدامة للبيئة والمياه.'
              : 'Integrated training paths and curriculums engineered to empower field researchers, environmental advocates, and local communities with key resources.'}
          </p>
        </div>

        {/* Catalog Body States */}
        <div className="space-y-6">
          {/* 1. Loading State */}
          {loading && (
            <div className="p-16 text-center bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 space-y-4 shadow-xs">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mx-auto" />
              <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">
                {isArabic ? 'جاري تحميل دليل البرامج التدريبية...' : 'Loading complete training catalog...'}
              </p>
            </div>
          )}

          {/* 2. Error State */}
          {!loading && Boolean(error) && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-xs">
              <ErrorBanner
                error={error}
                isAr={isArabic}
                action={{
                  label: isArabic ? 'إعادة المحاولة' : 'Retry Loading',
                  onClick: loadPublishedCourses,
                }}
              />
            </div>
          )}

          {/* 3. Truthful Empty State */}
          {!loading && !error && courses.length === 0 && (
            <div className="p-16 text-center bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/80 dark:border-gray-800/80 space-y-4 max-w-2xl mx-auto shadow-xs">
              <BookOpen className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto" />
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                {isArabic ? 'لا توجد برامج تدريبية منشورة حالياً' : 'No Published Training Programs Available'}
              </h2>
              <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                {isArabic
                  ? 'لم يتم نشر أي برامج تدريبية رسمية في المنصة حالياً. يرجى مراجعة إدارة التدريب أو التحقق لاحقاً للحصول على المسارات البيئية المعتمدة الجديدة.'
                  : 'There are currently no official training curriculums published on the portal. Please contact administrative staff or check back soon.'}
              </p>
            </div>
          )}

          {/* 4. Success Catalog Cards Grid */}
          {!loading && !error && courses.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
              {courses.map((course) => (
                <button
                  type="button"
                  key={course.id}
                  onClick={() => handleCardClick(course)}
                  className="w-full flex flex-col justify-between bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-xs hover:border-emerald-500/80 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer group text-start focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  aria-label={isArabic ? `عرض تفاصيل ${course.titleAr}` : `View details of ${course.titleEn}`}
                >
                  <div className="space-y-4 w-full">
                    {/* Header Badges */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/60">
                        {getCategoryLabel(course.category, isArabic)}
                      </span>
                      <span className="inline-flex items-center text-[11px] font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded border border-amber-100 dark:border-amber-900/40">
                        {isArabic ? levelLabels[course.level]?.ar : levelLabels[course.level]?.en}
                      </span>
                    </div>

                    {/* Course Title */}
                    <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white leading-snug group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors line-clamp-2">
                      {isArabic ? course.titleAr : course.titleEn}
                    </h3>

                    {/* Summary */}
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 leading-relaxed line-clamp-3">
                      {isArabic ? course.summaryAr : course.summaryEn}
                    </p>
                  </div>

                  {/* Metadata and Audience Footer */}
                  <div className="mt-6 pt-4 border-t border-gray-100 dark:border-gray-800 text-xs space-y-3 w-full">
                    <div className="grid grid-cols-2 gap-2 text-gray-500 dark:text-gray-400">
                      <span className="font-semibold text-emerald-800 dark:text-emerald-400 flex items-center gap-1">
                        <Globe className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{isArabic ? modeLabels[course.deliveryMode]?.ar : modeLabels[course.deliveryMode]?.en}</span>
                      </span>
                      <span className="flex items-center gap-1 justify-end font-medium">
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        <span>{isArabic ? `${course.durationHours} ساعة` : `${course.durationHours} Hours`}</span>
                      </span>
                    </div>
                    
                    <div className="flex items-center justify-between text-[11px] text-gray-400 dark:text-gray-500 pt-1">
                      <span className="truncate max-w-[180px] flex items-center gap-1">
                        <Users className="w-3.5 h-3.5 shrink-0" />
                        <span>{isArabic ? `الفئة: ${course.targetAudienceAr}` : `Audience: ${course.targetAudienceEn}`}</span>
                      </span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold group-hover:underline shrink-0">
                        {isArabic ? 'تفاصيل والوصول ←' : 'View Access →'}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </Container>

      {/* Member Training Course Access Modal (Fully Reused without modifying internal auth/member boundaries) */}
      <CourseAccessModal
        course={selectedCourse}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        isAr={isArabic}
      />
    </div>
  );
}
