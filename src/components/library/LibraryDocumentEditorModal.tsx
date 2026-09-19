import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  X, 
  BookOpen, 
  ShieldCheck, 
  Scale, 
  FileText, 
  History, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  Plus, 
  Save, 
  Sparkles
} from 'lucide-react';
import type { AdminUser } from '../../types/admin';
import { WorkflowState } from '../../types/workflow';
import { WorkflowEngine } from '../../services/workflowEngine';
import { AdminAccessService } from '../../services/adminAccess';
import { AdminPermission } from '../../types/admin';
import { 
  LibraryDocumentType, 
  LibraryRightsStatus 
} from '../../types/library';
import type { 
  LibraryDocument, 
  LibraryOrganization, 
  LibrarySource,
  LibraryDocumentVersion 
} from '../../types/library';

interface LibraryDocumentEditorModalProps {
  document: LibraryDocument | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedDoc: LibraryDocument) => void;
  organizations: LibraryOrganization[];
  sources: LibrarySource[];
  currentUser: AdminUser;
}

export function LibraryDocumentEditorModal({
  document,
  isOpen,
  onClose,
  onSave,
  organizations,
  sources,
  currentUser
}: LibraryDocumentEditorModalProps) {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  const [activeTab, setActiveTab] = useState<'metadata' | 'content' | 'rights' | 'workflow' | 'versions'>('metadata');
  const [formData, setFormData] = useState<Partial<LibraryDocument>>({});
  const [workflowComment, setWorkflowComment] = useState('');
  const [newVersionNum, setNewVersionNum] = useState('');
  const [newVersionDescAr, setNewVersionDescAr] = useState('');
  const [newVersionDescEn, setNewVersionDescEn] = useState('');

  // Notification and save confirmation states
  const [isSaveSuccess, setIsSaveSuccess] = useState(false);
  const [successNotification, setSuccessNotification] = useState<string | null>(null);
  const [notificationVisible, setNotificationVisible] = useState(false);

  useEffect(() => {
    if (document) {
      setFormData({ ...document });
      setWorkflowComment('');
      setActiveTab('metadata');
      setIsSaveSuccess(false);
      setSuccessNotification(null);
      setNotificationVisible(false);
    }
  }, [document]);

  // Auto-dismiss and animate success notification after 3 seconds within the single modal container
  useEffect(() => {
    if (isSaveSuccess) {
      const animFrame = requestAnimationFrame(() => {
        setNotificationVisible(true);
      });

      const dismissTimer = setTimeout(() => {
        setNotificationVisible(false);
        const cleanupTimer = setTimeout(() => {
          setIsSaveSuccess(false);
          setSuccessNotification(null);
          onClose();
        }, 300);
        return () => clearTimeout(cleanupTimer);
      }, 3000);

      return () => {
        cancelAnimationFrame(animFrame);
        clearTimeout(dismissTimer);
      };
    } else {
      setNotificationVisible(false);
    }
  }, [isSaveSuccess, onClose]);

  const handleCloseModal = () => {
    setNotificationVisible(false);
    setTimeout(() => {
      setIsSaveSuccess(false);
      setSuccessNotification(null);
      onClose();
    }, 200);
  };

  if (!isOpen || !document || !formData) return null;

  const canEdit = AdminAccessService.hasPermission(currentUser, AdminPermission.Edit) ||
                  AdminAccessService.hasPermission(currentUser, AdminPermission.Create);
  const canManageRights = AdminAccessService.hasPermission(currentUser, AdminPermission.ManageRights) ||
                          AdminAccessService.hasPermission(currentUser, AdminPermission.Review);

  const availableTransitions = WorkflowEngine.getAuthorizedTransitions(
    formData.workflowState || WorkflowState.Draft,
    currentUser
  );

  const handleWorkflowTransition = (toState: WorkflowState) => {
    try {
      if (!formData.workflowState) return;
      const updatedItem = WorkflowEngine.executeTransition(
        {
          id: formData.id || '',
          titleAr: formData.titleAr || '',
          titleEn: formData.titleEn || '',
          contentType: 'LibraryItem',
          currentState: formData.workflowState,
          authorName: currentUser.name,
          createdAt: formData.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          category: formData.documentType || 'Law',
          history: formData.workflowHistory || []
        },
        toState,
        currentUser,
        workflowComment
      );

      const nextDoc: LibraryDocument = {
        ...(formData as LibraryDocument),
        workflowState: updatedItem.currentState,
        workflowHistory: updatedItem.history,
        updatedAt: new Date().toISOString()
      };

      setFormData(nextDoc);
      onSave(nextDoc);
      setWorkflowComment('');
    } catch (err: any) {
      alert(err.message || 'Transition error');
    }
  };

  const handleSaveMetadata = () => {
    const updatedDoc: LibraryDocument = {
      ...(formData as LibraryDocument),
      updatedAt: new Date().toISOString()
    };
    onSave(updatedDoc);
    setSuccessNotification(
      isAr ? 'تم حفظ بيانات الوثيقة البيئية بنجاح' : 'Environmental document saved successfully'
    );
    setIsSaveSuccess(true);
  };

  const handleAddVersion = () => {
    if (!newVersionNum.trim()) return;
    const newVer: LibraryDocumentVersion = {
      id: `ver-${Date.now()}`,
      documentId: formData.id || '',
      versionNumber: newVersionNum.trim(),
      publishedDate: new Date().toISOString().split('T')[0],
      changeDescriptionAr: newVersionDescAr.trim() || 'تحديث وثائقي إضافي',
      changeDescriptionEn: newVersionDescEn.trim() || 'Document version update'
    };
    const updatedVersions = [...(formData.versions || []), newVer];
    const updatedDoc: LibraryDocument = {
      ...(formData as LibraryDocument),
      versions: updatedVersions,
      updatedAt: new Date().toISOString()
    };
    setFormData(updatedDoc);
    onSave(updatedDoc);
    setNewVersionNum('');
    setNewVersionDescAr('');
    setNewVersionDescEn('');
  };

  const getRightsBadgeColor = (status?: LibraryRightsStatus) => {
    switch (status) {
      case 'OpenPubliclyAvailable':
      case 'PermissionGranted':
        return 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800';
      case 'ReviewRequired':
      case 'PermissionRequired':
        return 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800';
      case 'Restricted':
      case 'NotRedistributable':
        return 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700';
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto pop-motion-modal">
      {isSaveSuccess ? (
        /* SUCCESS CONFIRMATION CONTENT IN SAME OVERLAY */
        <div 
          className={`bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl max-w-md w-full p-6 sm:p-8 flex flex-col items-center text-center shadow-2xl transition-all duration-[var(--pop-duration-modal)] ease-[var(--pop-ease-out)] transform my-auto ${
            notificationVisible
              ? 'opacity-100 scale-100 translate-y-0'
              : 'opacity-0 scale-95 -translate-y-2 pointer-events-none'
          }`}
          dir={isAr ? 'rtl' : 'ltr'}
        >
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-100 dark:border-emerald-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-4 shadow-inner">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
            {isAr ? 'تم الحفظ بنجاح' : 'Successfully Saved'}
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-300 font-medium mb-6">
            {successNotification}
          </p>
          <button
            onClick={handleCloseModal}
            className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold rounded-xl shadow-xs pop-motion-micro pop-hover-lift cursor-pointer flex items-center justify-center gap-2"
          >
            <span>{isAr ? 'موافق' : 'OK'}</span>
          </button>
        </div>
      ) : (
        /* EDIT CONTENT IN SAME OVERLAY */
        <div 
          data-responsive-guard
          className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl my-auto overflow-hidden text-gray-900 dark:text-gray-100 w-full max-w-full min-w-0"
          dir={isAr ? 'rtl' : 'ltr'}
        >
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between bg-gray-50/80 dark:bg-gray-950/60 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <BookOpen className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 className="font-extrabold text-base sm:text-lg truncate">
                  {isAr ? formData.titleAr : formData.titleEn}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {isAr ? 'محرر بيانات الوثيقة البيئية المعرفية' : 'Environmental Knowledge Document Editor'}
                </p>
              </div>
            </div>
            <button
              onClick={handleCloseModal}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

        {/* Tab Navigation Bar */}
        <div className="flex border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 overflow-x-auto no-scrollbar shrink-0 gap-1 text-xs sm:text-sm font-semibold">
          <button
            onClick={() => setActiveTab('metadata')}
            className={`py-3 px-3 border-b-2 flex items-center gap-2 transition-colors whitespace-nowrap ${
              activeTab === 'metadata'
                ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <FileText className="h-4 w-4" />
            <span>{isAr ? 'البيانات الأساسية' : 'Basic Metadata'}</span>
          </button>
          <button
            onClick={() => setActiveTab('content')}
            className={`py-3 px-3 border-b-2 flex items-center gap-2 transition-colors whitespace-nowrap ${
              activeTab === 'content'
                ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <Sparkles className="h-4 w-4" />
            <span>{isAr ? 'الملخص والمجالات' : 'Summaries & Domains'}</span>
          </button>
          <button
            onClick={() => setActiveTab('rights')}
            className={`py-3 px-3 border-b-2 flex items-center gap-2 transition-colors whitespace-nowrap ${
              activeTab === 'rights'
                ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <ShieldCheck className="h-4 w-4" />
            <span>{isAr ? 'الحقوق والوضع القانوني' : 'Rights & Legal Status'}</span>
          </button>
          <button
            onClick={() => setActiveTab('workflow')}
            className={`py-3 px-3 border-b-2 flex items-center gap-2 transition-colors whitespace-nowrap ${
              activeTab === 'workflow'
                ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <Clock className="h-4 w-4" />
            <span>{isAr ? 'دورة الاعتماد والتحرير' : 'Editorial Workflow'}</span>
          </button>
          <button
            onClick={() => setActiveTab('versions')}
            className={`py-3 px-3 border-b-2 flex items-center gap-2 transition-colors whitespace-nowrap ${
              activeTab === 'versions'
                ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <History className="h-4 w-4" />
            <span>{isAr ? 'تاريخ الإصدارات' : 'Version History'}</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-6">

          {/* TAB 1: BASIC METADATA */}
          {activeTab === 'metadata' && (
            <div className="space-y-4 text-xs sm:text-sm">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                    {isAr ? 'العنوان بالعربية' : 'Arabic Title'} *
                  </label>
                  <input
                    type="text"
                    disabled={!canEdit}
                    value={formData.titleAr || ''}
                    onChange={(e) => setFormData({ ...formData, titleAr: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                    {isAr ? 'العنوان بالإنجليزية' : 'English Title'} *
                  </label>
                  <input
                    type="text"
                    disabled={!canEdit}
                    value={formData.titleEn || ''}
                    onChange={(e) => setFormData({ ...formData, titleEn: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                    {isAr ? 'العنوان الأصلي للمستند (إن وجد)' : 'Original Title'}
                  </label>
                  <input
                    type="text"
                    disabled={!canEdit}
                    value={formData.originalTitle || ''}
                    onChange={(e) => setFormData({ ...formData, originalTitle: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                    {isAr ? 'نوع الوثيقة البيئية' : 'Document Type'} *
                  </label>
                  <select
                    disabled={!canEdit}
                    value={formData.documentType}
                    onChange={(e) => setFormData({ ...formData, documentType: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    {Object.values(LibraryDocumentType).map((dt) => (
                      <option key={dt} value={dt}>
                        {dt}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                    {isAr ? 'المؤسسة/الجهة المسؤولة' : 'Responsible Organization'} *
                  </label>
                  <select
                    disabled={!canEdit}
                    value={formData.organizationId}
                    onChange={(e) => setFormData({ ...formData, organizationId: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    {organizations.map((org) => (
                      <option key={org.id} value={org.id}>
                        {isAr ? org.nameAr : org.nameEn}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                    {isAr ? 'المصدر الأصلي للوثيقة' : 'Original Source Record'} *
                  </label>
                  <select
                    disabled={!canEdit}
                    value={formData.sourceId}
                    onChange={(e) => setFormData({ ...formData, sourceId: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    {sources.map((src) => (
                      <option key={src.id} value={src.id}>
                        {isAr ? src.sourceNameAr : src.sourceNameEn}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                    {isAr ? 'النطاق الجغرافي (عربي)' : 'Geography (Ar)'}
                  </label>
                  <input
                    type="text"
                    disabled={!canEdit}
                    value={formData.geographyAr || ''}
                    onChange={(e) => setFormData({ ...formData, geographyAr: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                    {isAr ? 'تاريخ النشر الأصلي' : 'Original Publication Date'}
                  </label>
                  <input
                    type="date"
                    disabled={!canEdit}
                    value={formData.publicationDate || ''}
                    onChange={(e) => setFormData({ ...formData, publicationDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                    {isAr ? 'لغة النص' : 'Language'}
                  </label>
                  <select
                    disabled={!canEdit}
                    value={formData.language || 'ar'}
                    onChange={(e) => setFormData({ ...formData, language: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    <option value="ar">{isAr ? 'العربية' : 'Arabic'}</option>
                    <option value="en">{isAr ? 'الإنجليزية' : 'English'}</option>
                    <option value="bilingual">{isAr ? 'مزدوج اللغتين (عربي/إنجليزي)' : 'Bilingual (Ar/En)'}</option>
                    <option value="other">{isAr ? 'لغة أخرى' : 'Other'}</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: SUMMARIES & DOMAINS */}
          {activeTab === 'content' && (
            <div className="space-y-4 text-xs sm:text-sm">
              <div>
                <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                  {isAr ? 'ملخص الوثيقة بالعربية' : 'Arabic Summary'} *
                </label>
                <textarea
                  rows={4}
                  disabled={!canEdit}
                  value={formData.summaryAr || ''}
                  onChange={(e) => setFormData({ ...formData, summaryAr: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                  {isAr ? 'ملخص الوثيقة بالإنجليزية' : 'English Summary'} *
                </label>
                <textarea
                  rows={4}
                  disabled={!canEdit}
                  value={formData.summaryEn || ''}
                  onChange={(e) => setFormData({ ...formData, summaryEn: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                    {isAr ? 'الموضوعات والوسوم (عربي - مفصولة بفواصل)' : 'Topics (Arabic - comma separated)'}
                  </label>
                  <input
                    type="text"
                    disabled={!canEdit}
                    value={formData.topicsAr ? formData.topicsAr.join(', ') : ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      topicsAr: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                    })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                    {isAr ? 'المجالات البيئية المحددة' : 'Environmental Domains'}
                  </label>
                  <input
                    type="text"
                    disabled={!canEdit}
                    value={formData.environmentalDomains ? formData.environmentalDomains.join(', ') : ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      environmentalDomains: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                    })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: RIGHTS & LEGAL STATUS */}
          {activeTab === 'rights' && (
            <div className="space-y-5 text-xs sm:text-sm">
              {/* Rights Decoupling Safety Banner */}
              <div className="p-4 rounded-xl border bg-amber-50/90 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/80 text-amber-900 dark:text-amber-200 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="font-bold text-sm">
                    {isAr ? 'تنبيه السلامة الحقوقية والقانونية المستقلة' : 'Decoupled Rights & Legal Safety Notice'}
                  </h4>
                  <p className="leading-relaxed">
                    {isAr 
                      ? 'اعتماد التحرير الصحفي (Approved) لا يعني إطلاقاً الترخيص بالترويج أو إعادة النشر الحقوقي. يظل وضع الحقوق يدار بشكل مستقل تماماً عبر "مراجع الحقوق والملكية".'
                      : 'Editorial Workflow approval (Approved) does NOT imply legal redistribution clearance. Rights clearance remains independently managed.'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                    {isAr ? 'حالة الحقوق وإعادة النشر' : 'Rights & Redistribution Status'} *
                  </label>
                  <select
                    disabled={!canManageRights}
                    value={formData.rightsStatus}
                    onChange={(e) => setFormData({ ...formData, rightsStatus: e.target.value as any })}
                    className={`w-full px-3 py-2 rounded-lg border font-bold ${getRightsBadgeColor(formData.rightsStatus)} focus:ring-2 focus:ring-emerald-500 outline-none`}
                  >
                    {Object.values(LibraryRightsStatus).map((rs) => (
                      <option key={rs} value={rs}>
                        {rs}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                    {isAr ? 'بيان الحقوق (عربي)' : 'Rights Statement (Ar)'}
                  </label>
                  <input
                    type="text"
                    disabled={!canManageRights}
                    value={formData.rightsNotesAr || ''}
                    onChange={(e) => setFormData({ ...formData, rightsNotesAr: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
              </div>

              {/* Descriptive Legal Status Section */}
              <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/40 space-y-3">
                <div className="flex items-center gap-2 font-bold text-gray-800 dark:text-gray-200">
                  <Scale className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <span>{isAr ? 'الوصف التوثيقي للوضع القانوني (بيان استرشادي غير أوتوماتيكي)' : 'Descriptive Legal Status Record'}</span>
                </div>
                <p className="text-gray-500 dark:text-gray-400 text-xs">
                  {isAr 
                    ? 'النظام لا يصدر أحكاماً قانونية أوتوماتيكية بنفاذ أو إلغاء التشريعات، بل يسجل الوصف التوثيقي الصادر عن الجهة الموثقة.'
                    : 'The platform records descriptive metadata from official registries and does not issue automated legal determinations.'}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                  <div>
                    <label className="block font-semibold mb-1 text-gray-700 dark:text-gray-300">
                      {isAr ? 'وصف الوضع القانوني (عربي)' : 'Legal Status Description (Ar)'}
                    </label>
                    <textarea
                      rows={3}
                      disabled={!canEdit}
                      value={formData.legalStatusDescriptionAr || ''}
                      onChange={(e) => setFormData({ ...formData, legalStatusDescriptionAr: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1 text-gray-700 dark:text-gray-300">
                      {isAr ? 'وصف الوضع القانوني (إنجليزية)' : 'Legal Status Description (En)'}
                    </label>
                    <textarea
                      rows={3}
                      disabled={!canEdit}
                      value={formData.legalStatusDescriptionEn || ''}
                      onChange={(e) => setFormData({ ...formData, legalStatusDescriptionEn: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: EDITORIAL WORKFLOW */}
          {activeTab === 'workflow' && (
            <div className="space-y-6 text-xs sm:text-sm">
              <div className="p-4 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/80 flex items-center justify-between">
                <div>
                  <span className="text-gray-500 dark:text-gray-400 font-semibold block text-xs">
                    {isAr ? 'حالة الاعتماد الحالية:' : 'Current Workflow State:'}
                  </span>
                  <span className="text-base font-extrabold text-emerald-800 dark:text-emerald-300">
                    {formData.workflowState}
                  </span>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {isAr ? 'المستخدم الحالي:' : 'Active User:'} <strong className="text-gray-800 dark:text-gray-200">{currentUser.name} ({currentUser.role})</strong>
                </div>
              </div>

              {/* Transition actions */}
              <div className="space-y-3">
                <h4 className="font-bold text-gray-800 dark:text-gray-200">
                  {isAr ? 'الإجراءات المتاحة بحسب صلاحيتك:' : 'Available Authorized Transitions:'}
                </h4>

                {availableTransitions.length === 0 ? (
                  <p className="text-gray-500 dark:text-gray-400 italic">
                    {isAr ? 'لا توجد انتقالات مسموحة لدورك الحقيقي في هذه الحالة.' : 'No authorized workflow actions available for your role.'}
                  </p>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <input
                        type="text"
                        placeholder={isAr ? 'ملاحظة التدقيق والاعتماد (اختياري)...' : 'Audit comment (optional)...'}
                        value={workflowComment}
                        onChange={(e) => setWorkflowComment(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 outline-none"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {availableTransitions.map((tr) => (
                        <button
                          key={tr.toState}
                          onClick={() => handleWorkflowTransition(tr.toState)}
                          className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold transition-all shadow-xs flex items-center gap-2"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          <span>{isAr ? tr.labelAr : tr.labelEn}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* History Timeline */}
              <div className="space-y-3 pt-3 border-t border-gray-200 dark:border-gray-800">
                <h4 className="font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                  <History className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <span>{isAr ? 'سجل انتقالات الاعتماد الموثقة:' : 'Audit History Timeline:'}</span>
                </h4>
                {(!formData.workflowHistory || formData.workflowHistory.length === 0) ? (
                  <p className="text-gray-500 text-xs italic">{isAr ? 'لا يوجد سجل سابق' : 'No history records'}</p>
                ) : (
                  <div className="space-y-2">
                    {formData.workflowHistory.map((h) => (
                      <div key={h.id} className="p-3 rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/40 text-xs flex justify-between items-start">
                        <div>
                          <p className="font-bold text-gray-800 dark:text-gray-200">
                            {h.action} : {h.fromState} &rarr; {h.toState}
                          </p>
                          <p className="text-gray-500 dark:text-gray-400 mt-0.5">
                            {h.actorName} ({h.actorRole})
                          </p>
                          {h.comment && (
                            <p className="text-emerald-700 dark:text-emerald-400 font-medium mt-1">
                              &ldquo;{h.comment}&rdquo;
                            </p>
                          )}
                        </div>
                        <span className="text-[10px] text-gray-400 whitespace-nowrap">
                          {new Date(h.timestamp).toLocaleString(isAr ? 'ar-EG' : 'en-US')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 5: VERSION HISTORY */}
          {activeTab === 'versions' && (
            <div className="space-y-5 text-xs sm:text-sm">
              <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/40 space-y-3">
                <h4 className="font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                  <Plus className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <span>{isAr ? 'تسجيل رقم إصدار توثيقي جديد' : 'Record New Document Version'}</span>
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input
                    type="text"
                    placeholder={isAr ? 'رقم الإصدار (مثال: 1.1)' : 'Version Number (e.g. 1.1)'}
                    value={newVersionNum}
                    onChange={(e) => setNewVersionNum(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                  />
                  <input
                    type="text"
                    placeholder={isAr ? 'وصف التعديل (عربي)' : 'Description (Arabic)'}
                    value={newVersionDescAr}
                    onChange={(e) => setNewVersionDescAr(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                  />
                  <input
                    type="text"
                    placeholder={isAr ? 'وصف التعديل (إنجليزي)' : 'Description (English)'}
                    value={newVersionDescEn}
                    onChange={(e) => setNewVersionDescEn(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                  />
                </div>
                <button
                  onClick={handleAddVersion}
                  className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold transition-all shadow-xs"
                >
                  {isAr ? 'إضافة الإصدار لسجل الوثيقة' : 'Add Version Entry'}
                </button>
              </div>

              <div className="space-y-2">
                <h4 className="font-bold text-gray-800 dark:text-gray-200">
                  {isAr ? 'تاريخ الإصدارات المسجلة:' : 'Recorded Document Versions:'}
                </h4>
                {(!formData.versions || formData.versions.length === 0) ? (
                  <p className="text-gray-500 italic text-xs">{isAr ? 'لا يوجد إصدارات سابقة' : 'No recorded versions'}</p>
                ) : (
                  formData.versions.map((v) => (
                    <div key={v.id} className="p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex justify-between items-center text-xs">
                      <div>
                        <span className="font-extrabold text-emerald-700 dark:text-emerald-400 text-sm mr-2">
                          v{v.versionNumber}
                        </span>
                        <span className="text-gray-800 dark:text-gray-200">
                          {isAr ? v.changeDescriptionAr : v.changeDescriptionEn}
                        </span>
                      </div>
                      <span className="text-gray-400 text-[10px]">
                        {v.publishedDate}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-950/60 flex items-center justify-between shrink-0">
          <button
            onClick={handleCloseModal}
            className="px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-bold hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
          >
            {isAr ? 'إغلاق' : 'Close'}
          </button>
          {canEdit && (
            <button
              onClick={handleSaveMetadata}
              className="px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold transition-all shadow-md flex items-center gap-2 cursor-pointer"
            >
              <Save className="h-4 w-4" />
              <span>{isAr ? 'حفظ البيانات الأساسية' : 'Save Metadata'}</span>
            </button>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
