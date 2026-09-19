import React, { useState, useEffect } from 'react';
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

interface TrainingCourseEditorModalProps {
  course: TrainingCourse | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (savedCourse: TrainingCourse) => void;
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
  const [notificationVisible, setNotificationVisible] = useState(false);

  useEffect(() => {
    if (course) {
      setFormData({ ...course });
      setWorkflowComment('');
      setActiveTab('metadata');
      setIsSaveSuccess(false);
      setNotificationVisible(false);
    }
  }, [course]);

  useEffect(() => {
    if (isSaveSuccess) {
      const animFrame = requestAnimationFrame(() => {
        setNotificationVisible(true);
      });
      const dismissTimer = setTimeout(() => {
        setNotificationVisible(false);
        const cleanupTimer = setTimeout(() => {
          setIsSaveSuccess(false);
          onClose();
        }, 300);
        return () => clearTimeout(cleanupTimer);
      }, 2500);
      return () => {
        cancelAnimationFrame(animFrame);
        clearTimeout(dismissTimer);
      };
    } else {
      setNotificationVisible(false);
    }
  }, [isSaveSuccess, onClose]);

  if (!isOpen || !course || !formData) return null;

  const canEdit = AdminAccessService.hasPermission(currentUser, AdminPermission.Edit) ||
                  AdminAccessService.hasPermission(currentUser, AdminPermission.Create);

  const availableTransitions = WorkflowEngine.getAuthorizedTransitions(
    formData.workflowState || WorkflowState.Draft,
    currentUser
  );

  const handleWorkflowTransition = (toState: WorkflowState) => {
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
      alert(err.message || 'Workflow transition failed');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;

    const updated: TrainingCourse = {
      ...(formData as TrainingCourse),
      updatedAt: new Date().toISOString(),
    };

    onSave(updated);
    setIsSaveSuccess(true);
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
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-xs overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-white">
                {isAr ? 'إدارة وتعديل برنامج التدريب' : 'Training Course Editor'}
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                ID: {formData.id} | {isAr ? 'الحالة:' : 'State:'} <span className="font-bold">{formData.workflowState}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
            aria-label={isAr ? 'إغلاق' : 'Close'}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Success Banner (Within Modal Layer) */}
        {isSaveSuccess && (
          <div className={`mx-6 mt-4 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 flex items-center gap-3 transition-all duration-300 ${notificationVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}>
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="text-sm font-semibold">
              {isAr ? 'تم حفظ التحديثات بنجاح!' : 'Training course saved successfully!'}
            </span>
          </div>
        )}

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

        {/* Modal Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {activeTab === 'metadata' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    {isAr ? 'عنوان البرنامج (بالعربية)' : 'Course Title (Arabic)'}
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.titleAr || ''}
                    onChange={(e) => setFormData({ ...formData, titleAr: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    {isAr ? 'عنوان البرنامج (بالإنجليزية)' : 'Course Title (English)'}
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.titleEn || ''}
                    onChange={(e) => setFormData({ ...formData, titleEn: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    {isAr ? 'الملخص التعريفي (بالعربية)' : 'Summary (Arabic)'}
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={formData.summaryAr || ''}
                    onChange={(e) => setFormData({ ...formData, summaryAr: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    {isAr ? 'الملخص التعريفي (بالإنجليزية)' : 'Summary (English)'}
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={formData.summaryEn || ''}
                    onChange={(e) => setFormData({ ...formData, summaryEn: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    {isAr ? 'المجال البيئي' : 'Category'}
                  </label>
                  <select
                    value={formData.category || 'Climate'}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value as Category })}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  >
                    <option value="Climate">Climate</option>
                    <option value="Water">Water</option>
                    <option value="Biodiversity">Biodiversity</option>
                    <option value="Pollution">Pollution</option>
                    <option value="Energy">Energy</option>
                    <option value="Agriculture">Agriculture</option>
                    <option value="EnvironmentalPolicy">EnvironmentalPolicy</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    {isAr ? 'المستوى' : 'Level'}
                  </label>
                  <select
                    value={formData.level || 'Beginner'}
                    onChange={(e) => setFormData({ ...formData, level: e.target.value as TrainingLevel })}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  >
                    <option value="Beginner">Beginner</option>
                    <option value="Intermediate">Intermediate</option>
                    <option value="Advanced">Advanced</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    {isAr ? 'طريقة التدريب' : 'Delivery Mode'}
                  </label>
                  <select
                    value={formData.deliveryMode || 'OnlineSelfPaced'}
                    onChange={(e) => setFormData({ ...formData, deliveryMode: e.target.value as DeliveryMode })}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  >
                    <option value="OnlineSelfPaced">OnlineSelfPaced</option>
                    <option value="LiveWorkshop">LiveWorkshop</option>
                    <option value="FieldCohort">FieldCohort</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    {isAr ? 'عدد الساعات' : 'Duration (Hours)'}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={formData.durationHours || 16}
                    onChange={(e) => setFormData({ ...formData, durationHours: parseInt(e.target.value) || 16 })}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'instructor' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    {isAr ? 'اسم المدرب / المحاضر (بالعربية)' : 'Instructor Name (Arabic)'}
                  </label>
                  <input
                    type="text"
                    value={formData.instructorNameAr || ''}
                    onChange={(e) => setFormData({ ...formData, instructorNameAr: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    {isAr ? 'اسم المدرب / المحاضر (بالإنجليزية)' : 'Instructor Name (English)'}
                  </label>
                  <input
                    type="text"
                    value={formData.instructorNameEn || ''}
                    onChange={(e) => setFormData({ ...formData, instructorNameEn: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    {isAr ? 'نبذة عن المدرب (بالعربية)' : 'Instructor Bio (Arabic)'}
                  </label>
                  <textarea
                    rows={3}
                    value={formData.instructorBioAr || ''}
                    onChange={(e) => setFormData({ ...formData, instructorBioAr: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    {isAr ? 'نبذة عن المدرب (بالإنجليزية)' : 'Instructor Bio (English)'}
                  </label>
                  <textarea
                    rows={3}
                    value={formData.instructorBioEn || ''}
                    onChange={(e) => setFormData({ ...formData, instructorBioEn: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    {isAr ? 'الفئة المستهدفة (بالعربية)' : 'Target Audience (Arabic)'}
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.targetAudienceAr || ''}
                    onChange={(e) => setFormData({ ...formData, targetAudienceAr: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    {isAr ? 'الفئة المستهدفة (بالإنجليزية)' : 'Target Audience (English)'}
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.targetAudienceEn || ''}
                    onChange={(e) => setFormData({ ...formData, targetAudienceEn: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'workflow' && (
            <div className="space-y-6">
              <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-950/60 border border-gray-200 dark:border-gray-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                      {isAr ? 'حالة دورة التدريب الحالية' : 'Current Workflow State'}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {isAr ? 'تدار وفق معايير المحتوى المعتمدة للمنصة' : 'Managed via accepted platform workflow lifecycle.'}
                    </p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-extrabold border ${getWorkflowBadge(formData.workflowState || WorkflowState.Draft)}`}>
                    {formData.workflowState}
                  </span>
                </div>

                {/* Transition Actions */}
                {availableTransitions.length > 0 && (
                  <div className="pt-3 border-t border-gray-200 dark:border-gray-800 space-y-3">
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
                      {isAr ? `إجراءات سير العمل المتاحة لدورك (${currentUser.role}):` : `Available Actions for your role (${currentUser.role}):`}
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {availableTransitions.map((t) => (
                        <button
                          key={t.action}
                          type="button"
                          onClick={() => handleWorkflowTransition(t.toState)}
                          className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white transition-colors shadow-xs cursor-pointer"
                        >
                          {isAr ? t.labelAr : t.labelEn} ({t.toState})
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Workflow History Timeline */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                  {isAr ? 'سجل مراحل التدقيق والموافقة' : 'Workflow History & Audit Trail'}
                </h4>
                {(!formData.workflowHistory || formData.workflowHistory.length === 0) ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                    {isAr ? 'لا توجد سجلات انتقالية مسجلة بعد.' : 'No transition records logged yet.'}
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

          {/* Modal Footer */}
          <div className="flex items-center justify-end gap-3 pt-6 border-t border-gray-100 dark:border-gray-800 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
            >
              {isAr ? 'إلغاء' : 'Cancel'}
            </button>
            {canEdit && (
              <button
                type="submit"
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs sm:text-sm shadow-sm transition-colors cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>{isAr ? 'حفظ التغييرات' : 'Save Changes'}</span>
              </button>
            )}
          </div>
        </form>

      </div>
    </div>
  );
}
