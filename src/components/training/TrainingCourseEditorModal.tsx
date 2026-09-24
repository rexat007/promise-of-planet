import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  X, 
  BookOpen, 
  ShieldCheck, 
  User, 
  CheckCircle2, 
  Save, 
  GraduationCap
} from 'lucide-react';
import type { AdminUser } from '../../types/admin';
import { AdminPermission } from '../../types/admin';
import { WorkflowState } from '../../types/workflow';
import { WorkflowEngine } from '../../services/workflowEngine';
import { AdminAccessService } from '../../services/adminAccess';
import type { TrainingCourse, TrainingLevel, DeliveryMode } from '../../types/training';
import type { Category } from '../../types';
import { AdminModalViewport } from '../common/AdminModalViewport';

interface TrainingCourseEditorModalProps {
  course: TrainingCourse | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (savedCourse: TrainingCourse) => Promise<void> | void;
  currentUser: AdminUser;
}

export function TrainingCourseEditorModal({
  course,
  isOpen,
  onClose,
  onSave,
  currentUser,
}: TrainingCourseEditorModalProps) {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  const [activeTab, setActiveTab] = useState<'metadata' | 'instructor' | 'workflow'>('metadata');
  const [formData, setFormData] = useState<Partial<TrainingCourse>>({});
  const [workflowComment, setWorkflowComment] = useState('');

  // Save success feedback states
  const [isSaveSuccess, setIsSaveSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const prevCourseIdRef = useRef<string | null>(null);
  const prevIsOpenRef = useRef<boolean>(false);

  const isFormDirty = (): boolean => {
    if (isSaveSuccess) return false;
    if (!course) return false;
    
    const keysToCompare: (keyof TrainingCourse)[] = [
      'titleAr', 'titleEn', 'summaryAr', 'summaryEn', 'category', 'level',
      'durationHours', 'deliveryMode', 'targetAudienceAr', 'targetAudienceEn',
      'workflowState', 'language', 'descriptionAr', 'descriptionEn',
      'instructorNameAr', 'instructorNameEn', 'instructorBioAr', 'instructorBioEn'
    ];

    for (const key of keysToCompare) {
      const originalValue = course[key];
      const currentValue = formData[key];
      
      const normOriginal = (originalValue === undefined || originalValue === null) ? '' : String(originalValue);
      const normCurrent = (currentValue === undefined || currentValue === null) ? '' : String(currentValue);
      
      if (normOriginal !== normCurrent) {
        return true;
      }
    }

    const originalHistory = course.workflowHistory || [];
    const currentHistory = formData.workflowHistory || [];
    if (originalHistory.length !== currentHistory.length) {
      return true;
    }

    return false;
  };

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isFormDirty()) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [formData, course, isSaveSuccess]);

  const handleCloseAttempt = () => {
    if (isFormDirty()) {
      const msg = isAr
        ? "هل أنت متأكد من رغبتك في إغلاق المحرر دون حفظ التغييرات؟ ستفقد جميع التعديلات الحالية."
        : "Are you sure you want to close the editor without saving? All unsaved changes will be lost.";
      if (window.confirm(msg)) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  const modalContainerRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // Accessible Focus Restoration & Focus Trap initialization
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;

      timer = setTimeout(() => {
        const container = modalContainerRef.current;
        if (container) {
          const focusables = container.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          if (focusables.length > 0) {
            focusables[0].focus();
          } else {
            container.focus();
          }
        }
      }, 50);
    }

    return () => {
      if (timer) {
        clearTimeout(timer);
      }
      if (previousActiveElement.current && typeof previousActiveElement.current.focus === 'function') {
        previousActiveElement.current.focus();
        previousActiveElement.current = null;
      }
    };
  }, [isOpen]);

  // Trap keyboard focus and handle Escape
  useEffect(() => {
    if (!isOpen || !course) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCloseAttempt();
        return;
      }

      if (e.key === 'Tab') {
        const container = modalContainerRef.current;
        if (!container) return;

        const focusables = Array.from(
          container.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => {
          if ((el as any).disabled) return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });

        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement;

        if (e.shiftKey) {
          if (active === first || !focusables.includes(active)) {
            last.focus();
            e.preventDefault();
          }
        } else {
          if (active === last || !focusables.includes(active)) {
            first.focus();
            e.preventDefault();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen, course, formData, isSaveSuccess]);

  // Course prop and open state lifecycle synchronization
  useEffect(() => {
    if (!isOpen) {
      prevIsOpenRef.current = false;
      return;
    }

    const justOpened = !prevIsOpenRef.current && isOpen;
    prevIsOpenRef.current = true;

    if (course) {
      const isDifferentCourse = prevCourseIdRef.current !== course.id;

      if (justOpened || isDifferentCourse) {
        // Genuinely new or switched course: full re-initialization
        prevCourseIdRef.current = course.id;
        setFormData({ ...course });
        setActiveTab('metadata');
        setWorkflowComment('');
        setIsSaveSuccess(false);
        setIsSaving(false);
        setSaveError(null);
      } else {
        // Same course was updated in-place (e.g. persisted from save)
        // Keep isSaveSuccess intact so the success UI is preserved!
        setFormData({ ...course });
      }
    } else {
      prevCourseIdRef.current = null;
    }
  }, [course, isOpen]);

  // Move focus to success heading once on success
  useEffect(() => {
    if (isSaveSuccess) {
      const heading = document.getElementById('course-editor-modal-title');
      if (heading) heading.focus();
    }
  }, [isSaveSuccess]);

  if (!isOpen || !course || !formData) return null;

  const canEdit = AdminAccessService.hasPermission(currentUser, AdminPermission.Edit) ||
                  AdminAccessService.hasPermission(currentUser, AdminPermission.Create);

  const availableTransitions = WorkflowEngine.getAuthorizedTransitions(
    formData.workflowState || WorkflowState.Draft,
    currentUser
  );

  const handleWorkflowTransition = (toState: WorkflowState) => {
    setSaveError(null);
    try {
      if (!formData.workflowState) return;
      const updatedWorkflow = WorkflowEngine.executeTransition(
        {
          id: formData.id || '',
          titleAr: formData.titleAr || '',
          titleEn: formData.titleEn || '',
          contentType: 'Course',
          currentState: formData.workflowState,
          authorName: currentUser.name,
          createdAt: formData.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          category: formData.category || 'Climate',
          history: formData.workflowHistory || [],
        },
        toState,
        currentUser,
        workflowComment
      );

      setFormData((prev) => ({
        ...prev,
        workflowState: updatedWorkflow.currentState,
        workflowHistory: updatedWorkflow.history,
        updatedAt: new Date().toISOString(),
      }));
      setWorkflowComment('');
    } catch (err: any) {
      setSaveError(err.message || 'Workflow transition failed');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;

    setSaveError(null);
    setIsSaving(true);
    try {
      const updated: TrainingCourse = {
        ...(formData as TrainingCourse),
        updatedAt: new Date().toISOString(),
      };

      await onSave(updated);
      setIsSaveSuccess(true);
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save training course durably.');
    } finally {
      setIsSaving(false);
    }
  };

  const getWorkflowBadge = (state: WorkflowState) => {
    switch (state) {
      case WorkflowState.Published:
        return 'bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 border-blue-300';
      case WorkflowState.Approved:
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border-emerald-300';
      case WorkflowState.InReview:
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border-amber-300';
      case WorkflowState.ChangesRequested:
        return 'bg-orange-100 text-orange-800 dark:bg-orange-950/80 dark:text-orange-300 border-orange-300';
      default:
        return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border-gray-300';
    }
  };

  return (
    <AdminModalViewport
      isOpen={isOpen}
      onClose={handleCloseAttempt}
      onEscape={handleCloseAttempt}
      size="editor"
      dir={isAr ? 'rtl' : 'ltr'}
      titleId="course-editor-modal-title"
      containerRef={modalContainerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="course-editor-modal-title"
    >
      {isSaveSuccess ? (
        /* SUCCESS CONFIRMATION STATE */
        <div className="flex flex-col flex-1 items-center justify-center p-8 text-center space-y-6 overflow-y-auto bg-white dark:bg-gray-900 min-h-0">
          <div className="p-4 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="w-12 h-12 animate-bounce" />
          </div>
          <div className="space-y-2">
            <h2 
              id="course-editor-modal-title" 
              tabIndex={-1}
              className="text-2xl font-extrabold text-gray-900 dark:text-white outline-hidden"
            >
              {isAr ? 'تم حفظ البرنامج التدريبي بنجاح' : 'Training course saved successfully'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">
              {isAr 
                ? 'تم تحديث سجل البرنامج التدريبي وتخزينه بشكل دائم وآمن.' 
                : 'The training course record has been successfully updated and stored securely.'}
            </p>
          </div>
          
          {/* Saved Course Summary */}
          <div className="w-full max-w-md p-4 rounded-xl bg-gray-50 dark:bg-gray-950/50 border border-gray-100 dark:border-gray-800 text-left space-y-3">
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-bold tracking-wider text-gray-400 dark:text-gray-500">
                {isAr ? 'اسم البرنامج' : 'Course Title'}
              </span>
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                {isAr ? formData.titleAr : formData.titleEn}
              </p>
            </div>
            
            <div className="flex justify-between items-center pt-2 border-t border-gray-200/60 dark:border-gray-800/60">
              <div className="space-y-1">
                <span className="text-[10px] uppercase font-bold tracking-wider text-gray-400 dark:text-gray-500">
                  {isAr ? 'حالة سير العمل' : 'Workflow State'}
                </span>
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  {formData.workflowState}
                </p>
              </div>
              <div className="space-y-1 text-right">
                <span className="text-[10px] uppercase font-bold tracking-wider text-gray-400 dark:text-gray-500">
                  {isAr ? 'اللغة' : 'Language'}
                </span>
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  {formData.language === 'ar' ? 'العربية' : 'English'}
                </p>
              </div>
            </div>
          </div>

          {/* Explicit Dismiss Button */}
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold shadow-md transition-all cursor-pointer"
          >
            {isAr ? 'العودة إلى إدارة التدريب' : 'Return to Training Management'}
          </button>
        </div>
      ) : (
        /* EDIT / FORM VIEW */
        <>
          {/* Modal Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-gray-800 shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400">
                <GraduationCap className="w-5 h-5" />
              </div>
              <div>
                <h2 id="course-editor-modal-title" className="text-base font-bold text-gray-900 dark:text-white">
                  {isAr ? 'إدارة وتعديل برنامج التدريب' : 'Training Course Editor'}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                  ID: {formData.id} | {isAr ? 'الحالة:' : 'State:'} <span className="font-bold">{formData.workflowState}</span>
                </p>
              </div>
            </div>
            <button
              onClick={handleCloseAttempt}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
              aria-label={isAr ? 'إغلاق' : 'Close'}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-100 dark:border-gray-800 px-6 gap-6 bg-white dark:bg-gray-900 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('metadata')}
              className={`py-3 text-xs sm:text-sm font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
                activeTab === 'metadata'
                  ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400'
                  : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>{isAr ? 'البيانات الأساسية والتصنيف' : 'Metadata & Classification'}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('instructor')}
              className={`py-3 text-xs sm:text-sm font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
                activeTab === 'instructor'
                  ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400'
                  : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              <User className="w-4 h-4" />
              <span>{isAr ? 'معلومات المدرب / المحاضر' : 'Instructor & Audience'}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('workflow')}
              className={`py-3 text-xs sm:text-sm font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
                activeTab === 'workflow'
                  ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400'
                  : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{isAr ? 'سير العمل والموافقة' : 'Workflow & Lifecycle'}</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${getWorkflowBadge(formData.workflowState || WorkflowState.Draft)}`}>
                {formData.workflowState}
              </span>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-6 flex-1 min-h-0">
            {/* TAB 1: METADATA & CLASSIFICATION */}
            {activeTab === 'metadata' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {isAr ? 'عنوان البرنامج التدريبي (بالعربية)' : 'Course Title (Arabic)'} *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.titleAr || ''}
                      onChange={(e) => setFormData({ ...formData, titleAr: e.target.value })}
                      className="w-full px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:ring-2 focus:ring-emerald-500 outline-hidden"
                      dir="rtl"
                      placeholder="أدخل عنوان البرنامج التدريبي بالعربية..."
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {isAr ? 'عنوان البرنامج التدريبي (بالإنجليزية)' : 'Course Title (English)'} *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.titleEn || ''}
                      onChange={(e) => setFormData({ ...formData, titleEn: e.target.value })}
                      className="w-full px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:ring-2 focus:ring-emerald-500 outline-hidden"
                      dir="ltr"
                      placeholder="Enter course title in English..."
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {isAr ? 'ملخص البرنامج التدريبي (بالعربية)' : 'Summary (Arabic)'} *
                    </label>
                    <textarea
                      required
                      rows={2}
                      value={formData.summaryAr || ''}
                      onChange={(e) => setFormData({ ...formData, summaryAr: e.target.value })}
                      className="w-full px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:ring-2 focus:ring-emerald-500 outline-hidden"
                      dir="rtl"
                      placeholder="ملخص مكثف عن البرنامج وأهدافه..."
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {isAr ? 'ملخص البرنامج التدريبي (بالإنجليزية)' : 'Summary (English)'} *
                    </label>
                    <textarea
                      required
                      rows={2}
                      value={formData.summaryEn || ''}
                      onChange={(e) => setFormData({ ...formData, summaryEn: e.target.value })}
                      className="w-full px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:ring-2 focus:ring-emerald-500 outline-hidden"
                      dir="ltr"
                      placeholder="Concise summary of course objectives..."
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {isAr ? 'الوصف الشامل للمنهج (بالعربية)' : 'Full Description (Arabic)'}
                    </label>
                    <textarea
                      rows={4}
                      value={formData.descriptionAr || ''}
                      onChange={(e) => setFormData({ ...formData, descriptionAr: e.target.value })}
                      className="w-full px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:ring-2 focus:ring-emerald-500 outline-hidden"
                      dir="rtl"
                      placeholder="تفاصيل الوحدات والمخرجات التعليمية..."
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {isAr ? 'الوصف الشامل للمنهج (بالإنجليزية)' : 'Full Description (English)'}
                    </label>
                    <textarea
                      rows={4}
                      value={formData.descriptionEn || ''}
                      onChange={(e) => setFormData({ ...formData, descriptionEn: e.target.value })}
                      className="w-full px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:ring-2 focus:ring-emerald-500 outline-hidden"
                      dir="ltr"
                      placeholder="Curriculum modules and learning outcomes..."
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-gray-100 dark:border-gray-800">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {isAr ? 'المجال البيئي' : 'Environmental Category'}
                    </label>
                    <select
                      value={formData.category || 'Climate'}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value as Category })}
                      className="w-full px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:ring-2 focus:ring-emerald-500 outline-hidden cursor-pointer"
                    >
                      <option value="Climate">{isAr ? 'المناخ' : 'Climate'}</option>
                      <option value="Water">{isAr ? 'المياه' : 'Water'}</option>
                      <option value="Biodiversity">{isAr ? 'التنوع البيولوجي' : 'Biodiversity'}</option>
                      <option value="Energy">{isAr ? 'الطاقة المستدامة' : 'Renewable Energy'}</option>
                      <option value="Waste">{isAr ? 'إدارة النفايات' : 'Waste Management'}</option>
                      <option value="AirQuality">{isAr ? 'جودة الهواء' : 'Air Quality'}</option>
                      <option value="Forests">{isAr ? 'الغابات والتشجير' : 'Forests & Reforestation'}</option>
                      <option value="Community">{isAr ? 'العمل المجتمعي البيئي' : 'Community Action'}</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {isAr ? 'المستوى التدريبي' : 'Training Level'}
                    </label>
                    <select
                      value={formData.level || 'Beginner'}
                      onChange={(e) => setFormData({ ...formData, level: e.target.value as TrainingLevel })}
                      className="w-full px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:ring-2 focus:ring-emerald-500 outline-hidden cursor-pointer"
                    >
                      <option value="Beginner">{isAr ? 'مبتدئ / تأسيسي' : 'Foundational / Beginner'}</option>
                      <option value="Intermediate">{isAr ? 'متوسط / تطبيقي' : 'Intermediate / Applied'}</option>
                      <option value="Advanced">{isAr ? 'متقدم / تخصصي' : 'Advanced / Specialized'}</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {isAr ? 'نمط التقديم' : 'Delivery Mode'}
                    </label>
                    <select
                      value={formData.deliveryMode || 'OnlineSelfPaced'}
                      onChange={(e) => setFormData({ ...formData, deliveryMode: e.target.value as DeliveryMode })}
                      className="w-full px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:ring-2 focus:ring-emerald-500 outline-hidden cursor-pointer"
                    >
                      <option value="OnlineSelfPaced">{isAr ? 'تعلم ذاتي عبر الإنترنت' : 'Online (Self-Paced)'}</option>
                      <option value="OnlineLive">{isAr ? 'جلسات تفاعلية حية' : 'Online (Live Interactive)'}</option>
                      <option value="InPerson">{isAr ? 'حضوري / ميداني' : 'In-Person / Field Work'}</option>
                      <option value="Hybrid">{isAr ? 'مدمج (حضوري وعن بعد)' : 'Hybrid (Blended)'}</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {isAr ? 'عدد الساعات المعتمدة' : 'Estimated Duration (Hours)'}
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={formData.durationHours || 10}
                      onChange={(e) => setFormData({ ...formData, durationHours: parseInt(e.target.value, 10) || 1 })}
                      className="w-full px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:ring-2 focus:ring-emerald-500 outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {isAr ? 'لغة المحتوى' : 'Content Language'}
                    </label>
                    <select
                      value={formData.language || 'ar'}
                      onChange={(e) => setFormData({ ...formData, language: e.target.value as 'ar' | 'en' })}
                      className="w-full px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:ring-2 focus:ring-emerald-500 outline-hidden cursor-pointer"
                    >
                      <option value="ar">{isAr ? 'العربية' : 'Arabic'}</option>
                      <option value="en">{isAr ? 'الإنجليزية' : 'English'}</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: INSTRUCTOR & AUDIENCE */}
            {activeTab === 'instructor' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {isAr ? 'اسم المدرب / الجهة المدربة (بالعربية)' : 'Instructor Name (Arabic)'} *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.instructorNameAr || ''}
                      onChange={(e) => setFormData({ ...formData, instructorNameAr: e.target.value })}
                      className="w-full px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:ring-2 focus:ring-emerald-500 outline-hidden"
                      dir="rtl"
                      placeholder="اسم المدرب أو المنظمة المقدمة..."
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {isAr ? 'اسم المدرب / الجهة المدربة (بالإنجليزية)' : 'Instructor Name (English)'} *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.instructorNameEn || ''}
                      onChange={(e) => setFormData({ ...formData, instructorNameEn: e.target.value })}
                      className="w-full px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:ring-2 focus:ring-emerald-500 outline-hidden"
                      dir="ltr"
                      placeholder="Instructor or organization name..."
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {isAr ? 'السيرة الذاتية للمدرب (بالعربية)' : 'Instructor Bio (Arabic)'}
                    </label>
                    <textarea
                      rows={3}
                      value={formData.instructorBioAr || ''}
                      onChange={(e) => setFormData({ ...formData, instructorBioAr: e.target.value })}
                      className="w-full px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:ring-2 focus:ring-emerald-500 outline-hidden"
                      dir="rtl"
                      placeholder="الخبرات والمؤهلات الأكاديمية والعملية..."
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {isAr ? 'السيرة الذاتية للمدرب (بالإنجليزية)' : 'Instructor Bio (English)'}
                    </label>
                    <textarea
                      rows={3}
                      value={formData.instructorBioEn || ''}
                      onChange={(e) => setFormData({ ...formData, instructorBioEn: e.target.value })}
                      className="w-full px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:ring-2 focus:ring-emerald-500 outline-hidden"
                      dir="ltr"
                      placeholder="Professional background and credentials..."
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-gray-100 dark:border-gray-800">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {isAr ? 'الجمهور المستهدف (بالعربية)' : 'Target Audience (Arabic)'}
                    </label>
                    <input
                      type="text"
                      value={formData.targetAudienceAr || ''}
                      onChange={(e) => setFormData({ ...formData, targetAudienceAr: e.target.value })}
                      className="w-full px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:ring-2 focus:ring-emerald-500 outline-hidden"
                      dir="rtl"
                      placeholder="مثال: الباحثون، المزارعون، نشطاء المناخ..."
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {isAr ? 'الجمهور المستهدف (بالإنجليزية)' : 'Target Audience (English)'}
                    </label>
                    <input
                      type="text"
                      value={formData.targetAudienceEn || ''}
                      onChange={(e) => setFormData({ ...formData, targetAudienceEn: e.target.value })}
                      className="w-full px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:ring-2 focus:ring-emerald-500 outline-hidden"
                      dir="ltr"
                      placeholder="e.g. Researchers, environmental officers, students..."
                    />
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: WORKFLOW & LIFECYCLE */}
            {activeTab === 'workflow' && (
              <div className="space-y-6">
                <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-gray-900 dark:text-white">
                        {isAr ? 'حالة سير العمل الحالية' : 'Current Workflow State'}
                      </h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {isAr ? 'تتحكم الحالة في إمكانية الوصول والنشر للمتدربين وعموم الزوار.' : 'Controls visibility and access in public and member spaces.'}
                      </p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-extrabold border ${getWorkflowBadge(formData.workflowState || WorkflowState.Draft)}`}>
                      {formData.workflowState}
                    </span>
                  </div>

                  {availableTransitions.length > 0 ? (
                    <div className="space-y-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                      <label className="block text-xs font-bold text-gray-700 dark:text-gray-300">
                        {isAr ? 'ملاحظة الانتقال / سبب الإجراء (اختياري)' : 'Transition Comment / Reason (Optional)'}
                      </label>
                      <input
                        type="text"
                        value={workflowComment}
                        onChange={(e) => setWorkflowComment(e.target.value)}
                        placeholder={isAr ? 'أضف ملاحظة توثيقية لهذا الإجراء...' : 'Add a note explaining this transition...'}
                        className="w-full px-3.5 py-2 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-sm focus:ring-2 focus:ring-emerald-500 outline-hidden"
                      />
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <span className="text-xs font-bold text-gray-500 dark:text-gray-400">
                          {isAr ? 'الإجراءات المتاحة لرتبتك:' : 'Available actions for your role:'}
                        </span>
                        {availableTransitions.map((transition) => (
                          <button
                            key={transition.toState}
                            type="button"
                            onClick={() => handleWorkflowTransition(transition.toState)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                          >
                            → {isAr ? `الانتقال إلى: ${transition.labelAr || transition.toState}` : `Move to: ${transition.labelEn || transition.toState}`}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 italic pt-2">
                      {isAr ? 'لا توجد انتقالات إضافية متاحة لحسابك على هذه الحالة.' : 'No additional workflow transitions available for your role on this state.'}
                    </p>
                  )}
                </div>

                {/* Audit & Workflow History */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                    {isAr ? 'سجل العمليات والتعديلات السابقة' : 'Workflow Transition History'}
                  </h4>
                  {(!formData.workflowHistory || formData.workflowHistory.length === 0) ? (
                    <p className="text-xs text-gray-400 italic">
                      {isAr ? 'لا يوجد سجل سابق لهذا البرنامج.' : 'No previous history recorded.'}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {formData.workflowHistory.map((h) => (
                        <div key={h.id} className="p-3 rounded-xl bg-gray-50 dark:bg-gray-950/40 border border-gray-100 dark:border-gray-800 text-xs space-y-1">
                          <div className="flex items-center justify-between font-semibold text-gray-800 dark:text-gray-200">
                            <span>{h.action} : <span className="text-emerald-600 dark:text-emerald-400">{h.fromState} → {h.toState}</span></span>
                            <span className="font-mono text-[10px] text-gray-400">{new Date(h.timestamp).toLocaleString()}</span>
                          </div>
                          <p className="text-gray-600 dark:text-gray-400">
                            {h.actorName} <span className="font-mono text-[10px] text-emerald-700 dark:text-emerald-400">({h.actorRole})</span>
                          </p>
                          {h.comment && (
                            <p className="text-gray-500 dark:text-gray-400 italic bg-white dark:bg-gray-900 p-2 rounded-lg border border-gray-200 dark:border-gray-800">
                              "{h.comment}"
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Save/Workflow Error Banner */}
            {saveError && (
              <div className="p-3.5 mt-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900/60 text-xs text-red-600 dark:text-red-400">
                <p className="font-bold">{isAr ? 'فشل إتمام العملية:' : 'Operation failed:'}</p>
                <p className="font-medium text-[11px] mt-1">{saveError}</p>
              </div>
            )}

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 pt-6 border-t border-gray-100 dark:border-gray-800 shrink-0">
              <button
                type="button"
                onClick={handleCloseAttempt}
                disabled={isSaving}
                className="px-4 py-2 rounded-xl text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors cursor-pointer"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              {canEdit && (
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-semibold text-xs sm:text-sm shadow-sm transition-colors cursor-pointer"
                >
                  {isSaving ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  <span>{isSaving ? (isAr ? 'جاري الحفظ...' : 'Saving...') : (isAr ? 'حفظ التغييرات' : 'Save Changes')}</span>
                </button>
              )}
            </div>
          </form>
        </>
      )}
    </AdminModalViewport>
  );
}
