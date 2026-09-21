import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  GraduationCap,
  CheckCircle2,
  Lock,
  Clock,
  User,
  BookOpen,
  Calendar,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Loader2
} from 'lucide-react';
import type { TrainingCourse } from '../../types/training';
import { MemberTrainingAccessService, type DerivedAccessState } from '../../services/memberTrainingAccessService';
import { AccountAuthWidget } from '../auth/AccountAuthWidget';
import { ErrorBanner } from '../common/ErrorBanner';
import { getCategoryLabel } from '../content/contentFormatters';

interface CourseAccessModalProps {
  course: TrainingCourse | null;
  isOpen: boolean;
  onClose: () => void;
  isAr?: boolean;
}

export const CourseAccessModal: React.FC<CourseAccessModalProps> = ({
  course,
  isOpen,
  onClose,
  isAr = false,
}) => {
  const [accessState, setAccessState] = useState<DerivedAccessState>({
    status: 'loading',
    course: null,
    enrollment: null,
    account: null,
    error: null,
  });
  const [submitting, setSubmitting] = useState(false);
  const [showAuthForm, setShowAuthForm] = useState(false);

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

  const loadAccessState = useCallback(async () => {
    if (!course) return;
    setAccessState((prev) => ({ ...prev, status: 'loading', error: null }));
    const resolved = await MemberTrainingAccessService.resolveAccessState(course.id, course);
    setAccessState(resolved);
  }, [course]);

  useEffect(() => {
    if (isOpen && course) {
      setShowAuthForm(false);
      loadAccessState();
    }
  }, [isOpen, course, loadAccessState]);

  if (!isOpen || !course) return null;

  const handleEnrollClick = async () => {
    if (!course) return;
    setSubmitting(true);
    const result = await MemberTrainingAccessService.requestEnrollment(course.id);
    setAccessState(result);
    setSubmitting(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-950/70 backdrop-blur-xs overflow-y-auto pop-motion-panel"
      dir={isAr ? 'rtl' : 'ltr'}
      role="dialog"
      aria-modal="true"
      aria-labelledby="course-modal-title"
    >
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden my-8 max-h-[90vh] flex flex-col">
        {/* Header Bar */}
        <div className="p-5 sm:p-6 bg-emerald-950 text-white relative border-b border-emerald-900 shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2 max-w-xl">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-800/80 text-emerald-200 border border-emerald-700/50">
                  {getCategoryLabel(course.category, isAr)}
                </span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-950/80 text-amber-300 border border-amber-800/60">
                  {isAr ? levelLabels[course.level]?.ar : levelLabels[course.level]?.en}
                </span>
              </div>
              <h2 id="course-modal-title" className="text-lg sm:text-xl font-extrabold leading-snug">
                {isAr ? course.titleAr : course.titleEn}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-emerald-300 hover:text-white bg-emerald-900/60 hover:bg-emerald-800/80 rounded-full transition-colors shrink-0 cursor-pointer"
              aria-label={isAr ? 'إغلاق' : 'Close'}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-5 sm:p-6 space-y-6 overflow-y-auto flex-1 text-start">
          {/* Summary & Details */}
          <div className="space-y-4">
            <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed font-medium">
              {isAr ? course.summaryAr : course.summaryEn}
            </p>

            {(course.descriptionAr || course.descriptionEn) && (
              <div className="p-4 bg-gray-50 dark:bg-gray-800/40 rounded-2xl border border-gray-100 dark:border-gray-800 text-xs text-gray-600 dark:text-gray-300 leading-relaxed space-y-1">
                <h4 className="font-bold text-gray-900 dark:text-white flex items-center gap-1.5 mb-1">
                  <BookOpen className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>{isAr ? 'تفاصيل البرنامج التدريبي' : 'Curriculum & Program Overview'}</span>
                </h4>
                <p>{isAr ? course.descriptionAr : course.descriptionEn}</p>
              </div>
            )}

            {/* Meta Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-emerald-50/60 dark:bg-emerald-950/30 rounded-xl border border-emerald-100 dark:border-emerald-900/40 flex items-center gap-2.5">
                <Clock className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                <div>
                  <span className="text-gray-500 dark:text-gray-400 block text-[11px]">
                    {isAr ? 'نمط وصيغة التدريب' : 'Delivery Mode & Duration'}
                  </span>
                  <span className="font-bold text-gray-900 dark:text-white">
                    {isAr ? modeLabels[course.deliveryMode]?.ar : modeLabels[course.deliveryMode]?.en} ({course.durationHours} {isAr ? 'ساعة' : 'hrs'})
                  </span>
                </div>
              </div>

              <div className="p-3 bg-emerald-50/60 dark:bg-emerald-950/30 rounded-xl border border-emerald-100 dark:border-emerald-900/40 flex items-center gap-2.5">
                <User className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                <div>
                  <span className="text-gray-500 dark:text-gray-400 block text-[11px]">
                    {isAr ? 'الفئة المستهدفة' : 'Target Audience'}
                  </span>
                  <span className="font-bold text-gray-900 dark:text-white truncate block max-w-[200px]">
                    {isAr ? course.targetAudienceAr : course.targetAudienceEn}
                  </span>
                </div>
              </div>
            </div>

            {/* Instructor Box */}
            {(course.instructorNameAr || course.instructorNameEn) && (
              <div className="p-3.5 bg-white dark:bg-gray-800/80 rounded-xl border border-gray-200 dark:border-gray-700/80 flex items-start gap-3">
                <div className="p-2 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 rounded-lg shrink-0 mt-0.5">
                  <GraduationCap className="w-4 h-4" />
                </div>
                <div className="text-xs space-y-0.5">
                  <span className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider block">
                    {isAr ? 'مدرب / مدربة المسار' : 'Program Instructor'}
                  </span>
                  <h4 className="font-bold text-gray-900 dark:text-white">
                    {isAr ? course.instructorNameAr : course.instructorNameEn}
                  </h4>
                  {(course.instructorBioAr || course.instructorBioEn) && (
                    <p className="text-gray-500 dark:text-gray-400 text-[11px] leading-relaxed">
                      {isAr ? course.instructorBioAr : course.instructorBioEn}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <hr className="border-gray-200 dark:border-gray-800" />

          {/* Member Access Panel */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              <span>{isAr ? 'حالة المشاركة والتسجيل في التدريب' : 'Training Access & Enrollment Status'}</span>
            </h3>

            {/* Error Banner if error exists */}
            {accessState.error && (
              <ErrorBanner
                error={accessState.error}
                isAr={isAr}
                action={{
                  label: isAr ? 'إعادة المحاولة' : 'Retry',
                  onClick: loadAccessState,
                }}
              />
            )}

            {/* Status 1: Loading */}
            {accessState.status === 'loading' && (
              <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-200 dark:border-gray-800 text-center text-xs text-gray-500 dark:text-gray-400 flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                <span>{isAr ? 'جاري التحقق من حالة التسجيل والحساب...' : 'Verifying account and enrollment status...'}</span>
              </div>
            )}

            {/* Status 2: Unauthenticated */}
            {accessState.status === 'unauthenticated' && (
              <div className="space-y-3">
                <div className="p-4 bg-amber-50/80 dark:bg-amber-950/30 rounded-2xl border border-amber-200 dark:border-amber-900/50 text-xs text-amber-900 dark:text-amber-200 space-y-2">
                  <div className="flex items-center gap-2 font-bold">
                    <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>{isAr ? 'تسجيل الدخول مطلوب للمشاركة' : 'Authentication Required for Course Enrollment'}</span>
                  </div>
                  <p className="leading-relaxed text-amber-800 dark:text-amber-300">
                    {isAr
                      ? 'للتسجيل والحصول على حق الوصول المعتمد لهذا البرنامج التدريبي البيئي، يتوجب تسجيل الدخول بحساب المنصة المعتمد.'
                      : 'Sign in with your verified platform account to request enrollment and record your participation in this training program.'}
                  </p>
                </div>

                {!showAuthForm ? (
                  <button
                    type="button"
                    onClick={() => setShowAuthForm(true)}
                    className="w-full py-3 px-4 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer pop-motion-micro"
                  >
                    <Lock className="w-4 h-4" />
                    <span>{isAr ? 'تسجيل الدخول أو إنشاء حساب جديد للتسجيل' : 'Sign In / Register Account to Enroll'}</span>
                    {isAr ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                  </button>
                ) : (
                  <div className="space-y-2 pt-2">
                    <div className="flex justify-between items-center px-1">
                      <span className="text-xs font-bold text-gray-700 dark:text-gray-300">
                        {isAr ? 'بوابة مصادقة الحساب:' : 'Account Authentication Panel:'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowAuthForm(false)}
                        className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                      >
                        {isAr ? 'إلغاء' : 'Cancel'}
                      </button>
                    </div>
                    <AccountAuthWidget isAr={isAr} />
                  </div>
                )}
              </div>
            )}

            {/* Status 3: Account Unavailable */}
            {accessState.status === 'account_unavailable' && (
              <ErrorBanner
                title={isAr ? 'مستند الحساب غير متوفر' : 'Account Profile Record Unavailable'}
                message={isAr ? 'يتعذر العثور على مستند الحساب الأساسي المرتبط بهويتك. يرجى التواصل مع الدعم.' : 'Valid canonical Account profile record is required before enrolling in a course.'}
                isAr={isAr}
                action={{
                  label: isAr ? 'إعادة المحاولة' : 'Retry',
                  onClick: loadAccessState,
                }}
              />
            )}

            {/* Status 4: Not Enrolled */}
            {accessState.status === 'not_enrolled' && (
              <div className="p-4 bg-emerald-50/60 dark:bg-emerald-950/30 rounded-2xl border border-emerald-200/80 dark:border-emerald-800/80 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-emerald-600 text-white rounded-xl shrink-0">
                    <GraduationCap className="w-4 h-4" />
                  </div>
                  <div className="space-y-1 text-xs">
                    <h4 className="font-bold text-gray-900 dark:text-white">
                      {isAr ? 'جاهز للتسجيل في هذا المسار التدريبي' : 'Eligible for Direct Member Enrollment'}
                    </h4>
                    <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
                      {isAr
                        ? `أنت مسجل حالياً بحساب (${accessState.account?.displayName || accessState.account?.email}). يمكنك التسجيل المباشر في هذا البرنامج المنشور.`
                        : `Authenticated as (${accessState.account?.displayName || accessState.account?.email}). You can request enrollment in this published course.`}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleEnrollClick}
                  disabled={submitting}
                  className="w-full py-3 px-4 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer pop-motion-micro"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{isAr ? 'جاري إرسال طلب التسجيل الدائم...' : 'Processing durable enrollment...'}</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{isAr ? 'التسجيل في البرنامج التدريبي' : 'Enroll in Training Program'}</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Status 5: Enrolled */}
            {accessState.status === 'enrolled' && (
              <div className="p-4 bg-emerald-100/80 dark:bg-emerald-950/60 rounded-2xl border border-emerald-300 dark:border-emerald-800 space-y-2">
                <div className="flex items-center gap-2.5 text-emerald-900 dark:text-emerald-200 font-bold text-xs">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>
                    {isAr ? 'أنت مسجل حالياً في هذا البرنامج التدريبي' : 'Recognized Member Enrollment Active'}
                  </span>
                </div>
                <p className="text-xs text-emerald-800 dark:text-emerald-300 leading-relaxed ps-7">
                  {isAr
                    ? `تم تسجيلك بنجاح بحساب (${accessState.account?.displayName || accessState.account?.email}). سيعتمد سجل مشاركتك عند عقد الورش والجلسات التدريبية.`
                    : `Your canonical enrollment is confirmed for account (${accessState.account?.displayName || accessState.account?.email}).`}
                </p>
                {accessState.enrollment?.createdAt && (
                  <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400 ps-7 pt-1 font-medium">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>
                      {isAr ? 'تاريخ التسجيل: ' : 'Enrolled on: '}
                      {new Date(accessState.enrollment.createdAt).toLocaleDateString(isAr ? 'ar-SD' : 'en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 dark:bg-gray-800/60 border-t border-gray-200 dark:border-gray-800 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            {isAr ? 'إغلاق' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};
