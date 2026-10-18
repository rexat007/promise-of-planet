import { useState, useEffect } from 'react';
import { 
  X, 
  ShieldCheck, 
  MapPin, 
  User, 
  Mail, 
  FileText, 
  Paperclip, 
  CheckCircle,
  FileCheck,
  Languages,
  AlertCircle,
  ExternalLink
} from 'lucide-react';
import type { CitizenSubmission, CitizenSubmissionAttachment } from '../../types/community';
import { SubmissionStatus } from '../../types/community';
import type { AdminUser } from '../../types/admin';
import { AdminPermission } from '../../types/admin';
import { AdminAccessService } from '../../services/adminAccess';
import { CitizenSubmissionService } from '../../services/citizenSubmissionService';
import { getCommunityCategoryLabel } from '../content/contentFormatters';
import { dynamicTranslationService } from '../../services/dynamicTranslation';

interface CitizenSubmissionReviewModalProps {
  submission: CitizenSubmission | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: (updated: CitizenSubmission) => void;
  currentUser: AdminUser;
  isAr: boolean;
}

export function CitizenSubmissionReviewModal({
  submission,
  isOpen,
  onClose,
  onUpdate,
  currentUser,
  isAr,
}: CitizenSubmissionReviewModalProps) {
  const [status, setStatus] = useState<SubmissionStatus>(SubmissionStatus.Received);
  const [moderatorNotes, setModeratorNotes] = useState<string>('');
  const [editorialReferenceId, setEditorialReferenceId] = useState<string>('');
  const [showOriginalSource, setShowOriginalSource] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [resolvingAttachmentId, setResolvingAttachmentId] = useState<string | null>(null);

  useEffect(() => {
    if (submission) {
      setStatus(submission.status);
      setModeratorNotes(submission.moderatorNotes || '');
      setEditorialReferenceId(submission.editorialReferenceId || '');
      setShowOriginalSource(false);
      setSaveError(null);
      setAttachmentError(null);
    }
  }, [submission]);

  if (!isOpen || !submission) return null;

  const targetLang = isAr ? 'ar' : 'en';
  const isTranslatedPresentation = submission.sourceLanguage !== targetLang;

  const displayTitle = showOriginalSource 
    ? submission.title 
    : dynamicTranslationService.translateText(submission.title, submission.sourceLanguage, targetLang, submission.id);

  const displayBody = showOriginalSource 
    ? submission.body 
    : dynamicTranslationService.translateText(submission.body, submission.sourceLanguage, targetLang, submission.id);

  const displayLocation = submission.locationDescription 
    ? (showOriginalSource 
        ? submission.locationDescription 
        : dynamicTranslationService.translateText(submission.locationDescription, submission.sourceLanguage, targetLang, submission.id))
    : undefined;

  const canReview = AdminAccessService.hasPermission(currentUser, AdminPermission.Review);

  const handleInspectAttachment = async (att: CitizenSubmissionAttachment) => {
    setAttachmentError(null);
    setResolvingAttachmentId(att.id);
    try {
      const resolvedUrl = await CitizenSubmissionService.resolveAttachmentAccessUrl(att, {
        adminUser: currentUser,
      });
      if (typeof window !== 'undefined' && resolvedUrl) {
        const anchor = document.createElement('a');
        anchor.href = resolvedUrl;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.click();
      }
    } catch (err: any) {
      setAttachmentError(
        err?.message ||
          (isAr
            ? 'تعذر فتح المرفق الخاص. تأكد من صلاحيات التخزين السحابي.'
            : 'Failed to resolve authorized access URL for private evidence attachment.')
      );
    } finally {
      setResolvingAttachmentId(null);
    }
  };

  const handleSave = async () => {
    setSaveError(null);
    setIsSaving(true);
    try {
      const persisted = await CitizenSubmissionService.moderateSubmission(
        submission.id,
        {
          status,
          moderatorNotes: moderatorNotes.trim() ? moderatorNotes.trim() : undefined,
          editorialReferenceId: editorialReferenceId.trim() ? editorialReferenceId.trim() : undefined,
        },
        currentUser
      );
      onUpdate(persisted);
      onClose();
    } catch (err: any) {
      setSaveError(
        err?.message ||
          (isAr
            ? 'تعذر حفظ قرار الإشراف في الخادم. لم يتم تعديل الحالة.'
            : 'Failed to persist moderation decision to backend. Status was not modified.')
      );
    } finally {
      setIsSaving(false);
    }
  };

  const getStatusBadge = (s: SubmissionStatus) => {
    switch (s) {
      case SubmissionStatus.Received:
        return (
          <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            {isAr ? 'مستلم جديد' : 'Received'}
          </span>
        );
      case SubmissionStatus.UnderReview:
        return (
          <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            {isAr ? 'قيد المراجعة' : 'Under Review'}
          </span>
        );
      case SubmissionStatus.AcceptedForEditorial:
        return (
          <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            {isAr ? 'مقبول للتحرير' : 'Accepted for Editorial'}
          </span>
        );
      case SubmissionStatus.Rejected:
        return (
          <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
            {isAr ? 'مرفوض' : 'Rejected'}
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden my-auto">
        
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/80 dark:bg-gray-950/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400">
              <FileCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-extrabold text-gray-900 dark:text-white">
                {isAr ? 'مراجعة بلاغ ومساهمة مواطن' : 'Citizen Submission Review'}
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                ID: {submission.id} • {new Date(submission.submittedAt).toLocaleDateString(isAr ? 'ar-SD' : 'en-US')}
                {submission.submittedByUid ? ` • UID: ${submission.submittedByUid}` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {saveError && (
            <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60 text-xs sm:text-sm text-red-700 dark:text-red-300 flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <span>{saveError}</span>
            </div>
          )}

          {/* Status & Meta Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
            <div className="space-y-1">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
                {isAr ? 'التصنيف والحالة الحالية' : 'Category & Current Status'}
              </span>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-md bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 text-xs font-bold">
                  {getCommunityCategoryLabel(submission.category, isAr)}
                </span>
                {getStatusBadge(submission.status)}
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
                {isAr ? 'لغة المصدر' : 'Source Language'}
              </span>
              <span className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">
                {submission.sourceLanguage}
              </span>
            </div>
          </div>

          {/* Contributor Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-3.5 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 space-y-1">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-emerald-600" />
                <span>{isAr ? 'اسم المساهم / المبلغ' : 'Contributor'}</span>
              </span>
              <p className="text-sm font-bold text-gray-900 dark:text-white">
                {submission.contributorName}
              </p>
            </div>

            <div className="p-3.5 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 space-y-1">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-emerald-600" />
                <span>{isAr ? 'وسيلة التواصل' : 'Contact'}</span>
              </span>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
                {submission.contributorContact || (isAr ? 'غير متوفر' : 'Not provided')}
              </p>
            </div>
          </div>

          {/* Translation Status & Original Source Access Notice */}
          {isTranslatedPresentation && (
            <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs">
              <div className="flex items-center gap-2">
                <Languages className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>
                  {isAr 
                    ? 'عرض ترجمة مشتقة تلقائية (المصدر الأصلي محفوظ ولا يتأثر)' 
                    : 'Dynamic translation presentation derivative (Original canonical source is preserved)'}
                </span>
              </div>
              <button
                onClick={() => setShowOriginalSource(!showOriginalSource)}
                className="px-2.5 py-1 rounded-lg bg-emerald-200/60 dark:bg-emerald-900/60 hover:bg-emerald-200 font-bold text-xs transition-colors cursor-pointer"
              >
                {showOriginalSource 
                  ? (isAr ? 'العودة للترجمة' : 'Show Translated') 
                  : (isAr ? 'عرض النص الأصلي' : 'View Original Source')}
              </button>
            </div>
          )}

          {/* Location if present */}
          {displayLocation && (
            <div className="p-3.5 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 space-y-1">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                <span>{isAr ? 'الموقع الجغرافي (وصف نصي)' : 'Location Description'}</span>
              </span>
              <p className="text-sm text-gray-800 dark:text-gray-200">
                {displayLocation}
              </p>
            </div>
          )}

          {/* Title & Body */}
          <div className="space-y-3">
            <h3 className="text-base sm:text-lg font-extrabold text-gray-900 dark:text-white leading-snug">
              {displayTitle}
            </h3>
            <div className="p-4 rounded-xl bg-gray-50/80 dark:bg-gray-950/40 border border-gray-100 dark:border-gray-800 text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
              {displayBody}
            </div>
          </div>

          {/* Attachments */}
          {submission.attachments && submission.attachments.length > 0 && (
            <div className="space-y-2">
              <span className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                <Paperclip className="w-4 h-4 text-emerald-600" />
                <span>{isAr ? `المرفقات والأدلة الميدانية الخاصة (${submission.attachments.length})` : `Private Evidence Attachments (${submission.attachments.length})`}</span>
              </span>
              {attachmentError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60 text-xs text-red-700 dark:text-red-300">
                  {attachmentError}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {submission.attachments.map((att) => (
                  <button
                    key={att.id}
                    type="button"
                    disabled={resolvingAttachmentId === att.id}
                    onClick={() => handleInspectAttachment(att)}
                    className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 hover:border-emerald-500 dark:hover:border-emerald-500 bg-white dark:bg-gray-900 flex items-center justify-between gap-3 transition-colors group text-start cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 group-hover:bg-emerald-100 transition-colors shrink-0">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-gray-900 dark:text-white truncate">{att.fileName}</p>
                        <span className="text-[10px] text-gray-500 uppercase">
                          {att.fileType}
                          {att.sizeBytes ? ` · ${(att.sizeBytes / (1024 * 1024)).toFixed(2)} MB` : ''}
                        </span>
                      </div>
                    </div>
                    <ExternalLink className="w-4 h-4 text-gray-400 group-hover:text-emerald-600 shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Moderation Controls Section */}
          <div className="border-t border-gray-100 dark:border-gray-800 pt-6 space-y-4">
            <h4 className="text-sm font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>{isAr ? 'أدوات الإشراف الإداري' : 'Moderation & Status Controls'}</span>
            </h4>

            {!canReview ? (
              <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/50 text-xs text-rose-700 dark:text-rose-400 font-semibold">
                {isAr ? 'ليس لديك صلاحية تعديل حالة البلاغ (يتطلب دور مراجع صحافة المواطن).' : 'You do not have permission to modify submission statuses (Review permission required).'}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-700 dark:text-gray-300">
                    {isAr ? 'تحديث حالة البلاغ' : 'Update Submission Status'}
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as SubmissionStatus)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm font-semibold text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 cursor-pointer"
                  >
                    <option value={SubmissionStatus.Received}>{isAr ? 'مستلم جديد (Received)' : 'Received'}</option>
                    <option value={SubmissionStatus.UnderReview}>{isAr ? 'قيد المراجعة (Under Review)' : 'Under Review'}</option>
                    <option value={SubmissionStatus.AcceptedForEditorial}>{isAr ? 'مقبول للتحرير (Accepted for Editorial)' : 'Accepted for Editorial'}</option>
                    <option value={SubmissionStatus.Rejected}>{isAr ? 'مرفوض (Rejected)' : 'Rejected'}</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-700 dark:text-gray-300">
                    {isAr ? 'مرجع المعالجة التحريرية (اختياري)' : 'Editorial Reference ID (Optional)'}
                  </label>
                  <input
                    type="text"
                    value={editorialReferenceId}
                    onChange={(e) => setEditorialReferenceId(e.target.value)}
                    placeholder={isAr ? 'مثال: news-ref-2026-01' : 'e.g. news-ref-2026-01'}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-700 dark:text-gray-300">
                {isAr ? 'ملاحظات المشرف (اختياري)' : 'Moderator Notes'}
              </label>
              <textarea
                value={moderatorNotes}
                onChange={(e) => setModeratorNotes(e.target.value)}
                disabled={!canReview}
                rows={3}
                placeholder={isAr ? 'أدخل ملاحظات المراجعة الإدارية للتوثيق...' : 'Enter administrative review notes...'}
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 disabled:opacity-60 resize-none"
              />
            </div>

            <div className="text-[11px] text-gray-500 dark:text-gray-400">
              {isAr
                ? 'ملاحظة: حالة "مقبول للتحرير" تعني إحالة البلاغ لفريق التحرير ولا تنشر الخبر تلقائياً للجمهور.'
                : 'Note: "Accepted for Editorial" marks the report for human editorial drafting and never automatically publishes a public News article.'}
            </div>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-950/50 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2 rounded-xl text-xs font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors cursor-pointer"
          >
            {isAr ? 'إغلاق' : 'Close'}
          </button>
          {canReview && (
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <CheckCircle className="w-4 h-4" />
              <span>{isSaving ? (isAr ? 'جاري الحفظ...' : 'Saving...') : (isAr ? 'حفظ التحديثات' : 'Save Changes')}</span>
            </button>
          )}
        </div>

      </div>
    </div>
  );
}

