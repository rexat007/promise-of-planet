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
  Sparkles,
  Lock
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
import { LibraryAdminClient } from '../../services/libraryAdminClient';
import { isQuarantineCatalogDocumentId } from '../../services/libraryQuarantineCatalogHandoffClient';

export interface SparseLibraryMetadataUpdatePayload {
  titleAr: string;
  titleEn: string;
  originalTitle?: string;
  documentType: LibraryDocumentType;
  organizationId: string;
  sourceId: string;
  geographyAr: string;
  geographyEn: string;
  publicationDate: string;
  language: 'ar' | 'en' | 'bilingual' | 'other';
  summaryAr: string;
  summaryEn: string;
  topicsAr: string[];
  topicsEn: string[];
  environmentalDomains: string[];
  legalStatusDescriptionAr: string;
  legalStatusDescriptionEn: string;
  authorMetadataAr?: string;
  authorMetadataEn?: string;
}

export function buildSparseLibraryMetadataUpdatePayload(
  formData: Partial<LibraryDocument>,
  fallbackDoc?: LibraryDocument | null
): SparseLibraryMetadataUpdatePayload {
  const pickRequiredString = (val: unknown, fallbackVal: unknown): string => {
    if (typeof val === 'string') {
      return val.trim();
    }
    if (typeof fallbackVal === 'string') {
      return fallbackVal.trim();
    }
    return '';
  };

  const pickStringArray = (val: unknown, fallbackVal: unknown): string[] => {
    const source = Array.isArray(val)
      ? val
      : Array.isArray(fallbackVal)
        ? fallbackVal
        : [];
    return source
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  };

  const documentType =
    typeof formData.documentType === 'string' &&
    Object.values(LibraryDocumentType).includes(formData.documentType as LibraryDocumentType)
      ? (formData.documentType as LibraryDocumentType)
      : fallbackDoc?.documentType || LibraryDocumentType.Law;

  const language: 'ar' | 'en' | 'bilingual' | 'other' =
    typeof formData.language === 'string' &&
    ['ar', 'en', 'bilingual', 'other'].includes(formData.language)
      ? (formData.language as 'ar' | 'en' | 'bilingual' | 'other')
      : fallbackDoc?.language || 'ar';

  const payload: SparseLibraryMetadataUpdatePayload = {
    titleAr: pickRequiredString(formData.titleAr, fallbackDoc?.titleAr),
    titleEn: pickRequiredString(formData.titleEn, fallbackDoc?.titleEn),
    documentType,
    organizationId: pickRequiredString(formData.organizationId, fallbackDoc?.organizationId),
    sourceId: pickRequiredString(formData.sourceId, fallbackDoc?.sourceId),
    geographyAr: pickRequiredString(formData.geographyAr, fallbackDoc?.geographyAr),
    geographyEn: pickRequiredString(formData.geographyEn, fallbackDoc?.geographyEn),
    publicationDate: pickRequiredString(formData.publicationDate, fallbackDoc?.publicationDate),
    language,
    summaryAr: pickRequiredString(formData.summaryAr, fallbackDoc?.summaryAr),
    summaryEn: pickRequiredString(formData.summaryEn, fallbackDoc?.summaryEn),
    topicsAr: pickStringArray(formData.topicsAr, fallbackDoc?.topicsAr),
    topicsEn: pickStringArray(formData.topicsEn, fallbackDoc?.topicsEn),
    environmentalDomains: pickStringArray(
      formData.environmentalDomains,
      fallbackDoc?.environmentalDomains
    ),
    legalStatusDescriptionAr: pickRequiredString(
      formData.legalStatusDescriptionAr,
      fallbackDoc?.legalStatusDescriptionAr
    ),
    legalStatusDescriptionEn: pickRequiredString(
      formData.legalStatusDescriptionEn,
      fallbackDoc?.legalStatusDescriptionEn
    ),
    ...(typeof formData.originalTitle === 'string'
      ? { originalTitle: formData.originalTitle.trim() }
      : {}),
    ...(typeof formData.authorMetadataAr === 'string'
      ? { authorMetadataAr: formData.authorMetadataAr.trim() }
      : {}),
    ...(typeof formData.authorMetadataEn === 'string'
      ? { authorMetadataEn: formData.authorMetadataEn.trim() }
      : {}),
  };

  return payload;
}

interface LibraryDocumentEditorModalProps {
  document: LibraryDocument | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedDoc: LibraryDocument) => void | Promise<void>;
  organizations: LibraryOrganization[];
  sources: LibrarySource[];
  currentUser: AdminUser;
  isNewDocument?: boolean;
}

export function LibraryDocumentEditorModal({
  document,
  isOpen,
  onClose,
  onSave,
  organizations,
  sources,
  currentUser,
  isNewDocument = false,
}: LibraryDocumentEditorModalProps) {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  const [activeTab, setActiveTab] = useState<'metadata' | 'content' | 'rights' | 'workflow' | 'versions'>('metadata');
  const [formData, setFormData] = useState<Partial<LibraryDocument>>({});
  const [workflowComment, setWorkflowComment] = useState('');
  const [newVersionNum, setNewVersionNum] = useState('');
  const [newVersionDescAr, setNewVersionDescAr] = useState('');
  const [newVersionDescEn, setNewVersionDescEn] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  // Notification and save confirmation states
  const [isSaveSuccess, setIsSaveSuccess] = useState(false);
  const [successNotification, setSuccessNotification] = useState<string | null>(null);
  const [notificationVisible, setNotificationVisible] = useState(false);

  useEffect(() => {
    if (document) {
      setFormData({ ...document });
      setWorkflowComment('');
      setActiveTab('metadata');
      setActionError(null);
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
    setActionError(null);
    setTimeout(() => {
      setIsSaveSuccess(false);
      setSuccessNotification(null);
      onClose();
    }, 200);
  };

  if (!isOpen || !document || !formData) return null;

  const isQuarantineCatalogDraft = isQuarantineCatalogDocumentId(formData.id || document.id);

  const canEdit = AdminAccessService.hasPermission(currentUser, AdminPermission.Edit) ||
                  AdminAccessService.hasPermission(currentUser, AdminPermission.Create);
  const canManageRights = !isQuarantineCatalogDraft && (
    AdminAccessService.hasPermission(currentUser, AdminPermission.ManageRights) ||
    AdminAccessService.hasPermission(currentUser, AdminPermission.Review)
  );

  const availableTransitions = isQuarantineCatalogDraft
    ? []
    : WorkflowEngine.getAuthorizedTransitions(
        formData.workflowState || WorkflowState.Draft,
        currentUser
      );

  const handleWorkflowTransition = async (toState: WorkflowState) => {
    setActionError(null);
    if (isQuarantineCatalogDraft) {
      setActionError(
        isAr
          ? 'انتقالات سير العمل والنشر العام مقفلة لمسودات الفهرسة المحجورة (qcat-)؛ المسار الوحيد المعتمد هو ملف قرار الحقوق البشري وملف السلامة الثنائية.'
          : 'Workflow transitions and publication are locked for private quarantine catalog drafts (qcat-); dedicated human rights and binary safety casework is the only path.'
      );
      return;
    }
    try {
      if (!formData.id || !formData.workflowState) return;
      let updatedDoc: LibraryDocument;
      if (LibraryAdminClient.isBackendAvailable() && LibraryAdminClient.isAuthenticated()) {
        updatedDoc = await LibraryAdminClient.transitionWorkflow(formData.id, toState, workflowComment);
      } else {
        // Fallback local simulation if backend unconfigured for normal doc- items
        const updatedItem = WorkflowEngine.executeTransition(
          {
            id: formData.id,
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
        updatedDoc = {
          ...(formData as LibraryDocument),
          workflowState: updatedItem.currentState,
          workflowHistory: updatedItem.history,
          updatedAt: new Date().toISOString()
        };
      }

      setFormData(updatedDoc);
      setWorkflowComment('');
      setSuccessNotification(isAr ? 'تم تنفيذ انتقال حالة التحرير بنجاح' : 'Workflow transition executed successfully');
      setIsSaveSuccess(true);
      try {
        await Promise.resolve(onSave(updatedDoc));
      } catch {
        // Refresh errors after a confirmed transition must not mask the transition result.
      }
    } catch (err: any) {
      setActionError(err.message || 'Transition error');
    }
  };

  const handleSaveMetadata = async () => {
    setActionError(null);
    try {
      if (!formData.id) return;
      const sparsePayload = buildSparseLibraryMetadataUpdatePayload(formData, document);

      if (
        !sparsePayload.titleAr ||
        !sparsePayload.titleEn ||
        !sparsePayload.organizationId ||
        !sparsePayload.sourceId ||
        !sparsePayload.geographyAr ||
        !sparsePayload.geographyEn ||
        !sparsePayload.publicationDate ||
        !sparsePayload.summaryAr ||
        !sparsePayload.summaryEn ||
        !sparsePayload.legalStatusDescriptionAr ||
        !sparsePayload.legalStatusDescriptionEn
      ) {
        setActionError(
          isAr
            ? 'يرجى استكمال جميع الحقول الوصفية الإلزامية قبل الحفظ.'
            : 'Please complete all required descriptive metadata fields before saving.'
        );
        return;
      }

      if (isQuarantineCatalogDraft) {
        if (!LibraryAdminClient.isBackendAvailable() || !LibraryAdminClient.isAuthenticated()) {
          setActionError(
            isAr
              ? 'يتطلب حفظ مسودة الفهرسة المحجورة (qcat-) جلسة مسؤول موثقة واتصالاً نشطاً بالخادم؛ لا يُسمح بالمحاكاة المحلية.'
              : 'Saving a private quarantine catalog draft (qcat-) requires an authenticated admin backend session; offline simulation is forbidden.'
          );
          return;
        }
        const updatedDoc = await LibraryAdminClient.updateMetadata(formData.id, sparsePayload);
        setFormData(updatedDoc);
        setSuccessNotification(
          isAr ? 'تم حفظ بيانات الوثيقة البيئية بنجاح' : 'Environmental document saved successfully'
        );
        setIsSaveSuccess(true);
        try {
          await Promise.resolve(onSave(updatedDoc));
        } catch {
          // Wait/refresh errors after a confirmed save must not look like the save failed or cause a second write.
        }
        return;
      }

      if (isNewDocument) {
        const draftToCreate: LibraryDocument = {
          ...(document as LibraryDocument),
          ...(formData as LibraryDocument),
          ...sparsePayload,
          updatedAt: new Date().toISOString(),
        };
        await Promise.resolve(onSave(draftToCreate));
        setFormData(draftToCreate);
        setSuccessNotification(
          isAr ? 'تم حفظ بيانات الوثيقة البيئية بنجاح' : 'Environmental document saved successfully'
        );
        setIsSaveSuccess(true);
        return;
      }

      let updatedDoc: LibraryDocument;
      if (LibraryAdminClient.isBackendAvailable() && LibraryAdminClient.isAuthenticated()) {
        updatedDoc = await LibraryAdminClient.updateMetadata(formData.id, sparsePayload);

        // If rights status was also modified locally on a normal doc- record, update rights via dedicated endpoint
        if (formData.rightsStatus && formData.rightsStatus !== document.rightsStatus) {
          updatedDoc = await LibraryAdminClient.updateRights(
            formData.id, 
            formData.rightsStatus, 
            formData.rightsNotesAr, 
            formData.rightsNotesEn
          );
        }
      } else {
        updatedDoc = {
          ...(formData as LibraryDocument),
          ...sparsePayload,
          updatedAt: new Date().toISOString()
        };
      }

      setFormData(updatedDoc);
      setSuccessNotification(
        isAr ? 'تم حفظ بيانات الوثيقة البيئية بنجاح' : 'Environmental document saved successfully'
      );
      setIsSaveSuccess(true);
      try {
        await Promise.resolve(onSave(updatedDoc));
      } catch {
        // Wait/refresh errors after a confirmed save must not look like the save failed or cause a second write.
      }
    } catch (err: any) {
      setActionError(err.message || 'Failed to save document');
    }
  };

  const handleAddVersion = async () => {
    setActionError(null);
    if (isQuarantineCatalogDraft) {
      setActionError(
        isAr
          ? 'سجل الإصدار التاريخي (1.0) مقفل للقراءة فقط لمسودات الفهرسة المحجورة (qcat-)؛ إضافة إصدارات جديدة غير متاحة.'
          : 'Historical version 1.0 is locked read-only for private quarantine catalog drafts (qcat-); adding versions is disabled.'
      );
      return;
    }
    if (!newVersionNum.trim() || !formData.id) return;
    try {
      const versionInput = {
        versionNumber: newVersionNum.trim(),
        changeDescriptionAr: newVersionDescAr.trim() || 'تحديث وثائقي إضافي',
        changeDescriptionEn: newVersionDescEn.trim() || 'Document version update',
        publishedDate: new Date().toISOString().split('T')[0]
      };

      let updatedDoc: LibraryDocument;
      if (LibraryAdminClient.isBackendAvailable() && LibraryAdminClient.isAuthenticated()) {
        updatedDoc = await LibraryAdminClient.addVersion(formData.id, versionInput);
      } else {
        const newVer: LibraryDocumentVersion = {
          id: `ver-${Date.now()}`,
          documentId: formData.id,
          versionNumber: versionInput.versionNumber,
          publishedDate: versionInput.publishedDate,
          changeDescriptionAr: versionInput.changeDescriptionAr,
          changeDescriptionEn: versionInput.changeDescriptionEn
        };
        updatedDoc = {
          ...(formData as LibraryDocument),
          versions: [newVer, ...(formData.versions || [])],
          updatedAt: new Date().toISOString()
        };
      }

      setFormData(updatedDoc);
      setNewVersionNum('');
      setNewVersionDescAr('');
      setNewVersionDescEn('');
      try {
        await Promise.resolve(onSave(updatedDoc));
      } catch {
        // Refresh errors after a confirmed version addition must not mask the result.
      }
    } catch (err: any) {
      setActionError(err.message || 'Failed to add version');
    }
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
          {actionError && (
            <div
              role="alert"
              data-testid="library-editor-action-error"
              className="p-3.5 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50/90 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200 text-xs sm:text-sm flex items-start justify-between gap-3"
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <span className="font-medium leading-relaxed">{actionError}</span>
              </div>
              <button
                type="button"
                onClick={() => setActionError(null)}
                className="text-rose-500 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-200 shrink-0 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {isQuarantineCatalogDraft && (
            <div
              data-testid="quarantine-catalog-draft-banner"
              className="p-3.5 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2.5"
            >
              <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-bold">
                  {isAr
                    ? `مسودة فهرسة داخلية مقيدة (${formData.id}) — الحقول الوصفية فقط قابلة للتحديث`
                    : `Private Quarantine Catalog Draft (${formData.id}) — Descriptive Metadata Only`}
                </p>
                <p className="leading-relaxed">
                  {isAr
                    ? 'حالة الحقوق (ReviewRequired) وحالة سير العمل (Draft) والإصدار التاريخي (1.0) مقفلة للقراءة فقط. المسار الوحيد المعتمد لمراجعة الحقوق والسلامة الثنائية هو ملفات المراجعة البشرية المخصصة، ويظل النشر العام محظوراً.'
                    : 'Rights status (ReviewRequired), workflow state (Draft), and historical version (1.0) are read-only. Dedicated human rights and binary safety casework is the only authorized path, and public publication remains blocked.'}
                </p>
              </div>
            </div>
          )}

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

              {isQuarantineCatalogDraft ? (
                <div
                  data-testid="quarantine-catalog-draft-rights-readonly"
                  className="p-4 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/30 space-y-3"
                >
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                      <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      <span>
                        {isAr
                          ? 'حالة الحقوق وإعادة النشر (للقراءة فقط):'
                          : 'Rights & Redistribution Status (Read-Only):'}
                      </span>
                    </span>
                    <span
                      data-testid="quarantine-catalog-draft-rights-status-badge"
                      className={`px-3 py-1 rounded-lg border font-extrabold text-xs ${getRightsBadgeColor(LibraryRightsStatus.ReviewRequired)}`}
                    >
                      {LibraryRightsStatus.ReviewRequired}
                    </span>
                  </div>
                  <p className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                    {isAr
                      ? 'هذه الوثيقة مسودة فهرسة محجورة خاصة (qcat-). حالة الحقوق مقفلة على ReviewRequired ولا يُسمح باختيار OpenPubliclyAvailable أو تعديل قرار الحقوق من هذا المحرر. المسار الوحيد المعتمد هو ملف قرار الحقوق البشري وملف السلامة الثنائية المخصصان، ويظل النشر العام محظوراً.'
                      : 'This record is a private quarantine catalog draft (qcat-). Rights status is locked to ReviewRequired and OpenPubliclyAvailable cannot be selected here. Dedicated human rights and binary safety casework is the only authorized path, and public publication remains blocked.'}
                  </p>
                  {formData.rightsNotesAr && (
                    <div className="text-xs text-gray-600 dark:text-gray-300 pt-1 border-t border-amber-200/70 dark:border-amber-800/60">
                      <strong className="block mb-0.5">
                        {isAr ? 'بيان الحقوق المسجل (للقراءة فقط):' : 'Recorded Rights Statement (Read-Only):'}
                      </strong>
                      <span>{formData.rightsNotesAr}</span>
                    </div>
                  )}
                </div>
              ) : (
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
              )}

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
                  <span
                    data-testid="editor-workflow-state-display"
                    className="text-base font-extrabold text-emerald-800 dark:text-emerald-300"
                  >
                    {isQuarantineCatalogDraft ? WorkflowState.Draft : formData.workflowState}
                  </span>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {isAr ? 'المستخدم الحالي:' : 'Active User:'} <strong className="text-gray-800 dark:text-gray-200">{currentUser.name} ({currentUser.role})</strong>
                </div>
              </div>

              {/* Transition actions */}
              {isQuarantineCatalogDraft ? (
                <div
                  data-testid="quarantine-catalog-draft-workflow-readonly"
                  className="p-4 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/30 space-y-2"
                >
                  <div className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-200">
                    <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <span>
                      {isAr
                        ? 'دورة الاعتماد مقفلة على مسودة (Draft) للقراءة فقط'
                        : 'Workflow State Locked to Draft (Read-Only)'}
                    </span>
                  </div>
                  <p className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                    {isAr
                      ? 'لا تتوفر أزرار انتقال سير العمل لمسودات الفهرسة المحجورة (qcat-). المسار الوحيد المعتمد هو استكمال ملف قرار الحقوق البشري وملف السلامة الثنائية المخصصين، ويظل النشر العام محظوراً.'
                      : 'Workflow transition actions are disabled for private quarantine catalog drafts (qcat-). Dedicated human rights and binary safety casework is the only authorized path, and public publication remains blocked.'}
                  </p>
                </div>
              ) : (
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
                            className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold transition-all shadow-xs flex items-center gap-2 cursor-pointer"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            <span>{isAr ? tr.labelAr : tr.labelEn}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

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
              {isQuarantineCatalogDraft ? (
                <div
                  data-testid="quarantine-catalog-draft-versions-readonly"
                  className="p-4 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/30 space-y-2"
                >
                  <div className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-200">
                    <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <span>
                      {isAr
                        ? 'الإصدار التاريخي (1.0) مقفل للقراءة فقط'
                        : 'Historical Version 1.0 Locked (Read-Only)'}
                    </span>
                  </div>
                  <p className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                    {isAr
                      ? 'إضافة إصدارات جديدة أو روابط مرجعية غير متاحة لمسودات الفهرسة المحجورة (qcat-). المسار الوحيد المعتمد هو ملف قرار الحقوق البشري وملف السلامة الثنائية المخصصان، ويظل النشر العام محظوراً.'
                      : 'Adding new document versions or reference URLs is disabled for private quarantine catalog drafts (qcat-). Dedicated human rights and binary safety casework is the only authorized path, and public publication remains blocked.'}
                  </p>
                </div>
              ) : (
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
                    className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold transition-all shadow-xs cursor-pointer"
                  >
                    {isAr ? 'إضافة الإصدار لسجل الوثيقة' : 'Add Version Entry'}
                  </button>
                </div>
              )}

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
