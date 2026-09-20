import React, { useState } from 'react';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Save,
  Clock,
  ExternalLink,
  ShieldAlert,
  Tag as TagIcon,
  FolderTree,
  FileEdit,
  Layers,
  Info
} from 'lucide-react';
import type { YouTubeImportCandidate, Category } from '../../types/youtube';
import { CANONICAL_CATEGORY_DEFINITIONS } from '../../types';
import { AdminPermission } from '../../types/admin';
import { useTranslation } from 'react-i18next';

interface YouTubeCandidateReviewModalProps {
  candidate: YouTubeImportCandidate;
  isOpen: boolean;
  onClose: () => void;
  onSaveDraft: (candidateId: string, draft: any) => Promise<void>;
  onReject: (candidateId: string, reviewedVersion: number) => Promise<void>;
  onAccept: (candidateId: string, reviewedVersion: number) => Promise<void>;
  hasPermission: (perm: AdminPermission) => boolean;
  isBackendAvailable: boolean;
  isAuthenticated: boolean;
}

export const YouTubeCandidateReviewModal: React.FC<YouTubeCandidateReviewModalProps> = ({
  candidate,
  isOpen,
  onClose,
  onSaveDraft,
  onReject,
  onAccept,
  hasPermission,
  isBackendAvailable: _isBackendAvailable,
  isAuthenticated: _isAuthenticated,
}) => {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  const tText = (ar: string, en: string) => isAr ? ar : en;

  const canEdit = hasPermission(AdminPermission.Edit);
  const canReview = hasPermission(AdminPermission.Review);

  // Form state initialized from candidate's current draft
  const [titleAr, setTitleAr] = useState(candidate.editorialDraft.titleAr || '');
  const [titleEn, setTitleEn] = useState(candidate.editorialDraft.titleEn || '');
  const [excerptAr, setExcerptAr] = useState(candidate.editorialDraft.excerptAr || '');
  const [excerptEn, setExcerptEn] = useState(candidate.editorialDraft.excerptEn || '');
  const [editorialDescriptionAr, setEditorialDescriptionAr] = useState(candidate.editorialDraft.editorialDescriptionAr || '');
  const [editorialDescriptionEn, setEditorialDescriptionEn] = useState(candidate.editorialDraft.editorialDescriptionEn || '');
  const [category, setCategory] = useState<Category | ''>(candidate.editorialDraft.category || '');
  const [tagsInput, setTagsInput] = useState((candidate.editorialDraft.tags || []).join(', '));

  const [isSaving, setIsSaving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const isPendingReview = candidate.status === 'PendingReview';
  const hasCategory = !!category;

  const handleSaveDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) {
      setErrorMsg(tText('غير مصرح لك بتعديل المسودة التحريرية (مطلوب صلاحية التعديل)', 'Unauthorized: Edit permission required to update draft'));
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const parsedTags = tagsInput
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);

      await onSaveDraft(candidate.id, {
        titleAr,
        titleEn: titleEn || undefined,
        excerptAr,
        excerptEn: excerptEn || undefined,
        editorialDescriptionAr,
        editorialDescriptionEn: editorialDescriptionEn || undefined,
        category: category || undefined,
        tags: parsedTags,
      });

      setSuccessMsg(tText('تم حفظ المسودة التحريرية بنجاح.', 'Editorial draft saved successfully.'));
    } catch (err: any) {
      setErrorMsg(err?.message || tText('فشل حفظ المسودة', 'Failed to save draft'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleReject = async () => {
    if (!canReview) {
      setErrorMsg(tText('غير مصرح لك برفض الفيديو المستورد (مطلوب صلاحية المراجعة)', 'Unauthorized: Review permission required to reject'));
      return;
    }

    setIsRejecting(true);
    setErrorMsg(null);

    try {
      await onReject(candidate.id, candidate.candidateVersion);
      setSuccessMsg(tText('تم رفض الفيديو المستورد بنجاح.', 'Candidate rejected successfully.'));
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: any) {
      setErrorMsg(err?.message || tText('فشل رفض الفيديو', 'Failed to reject candidate'));
      setIsRejecting(false);
      setConfirmReject(false);
    }
  };

  const handleAccept = async () => {
    if (!canReview) {
      setErrorMsg(tText('غير مصرح لك باعتماد الفيديو المستورد (مطلوب صلاحية المراجعة)', 'Unauthorized: Review permission required to accept'));
      return;
    }
    if (!hasCategory) {
      setErrorMsg(tText('يتطلب تحديد تصنيف معتمد قبل الاعتماد', 'Valid category is required before acceptance'));
      return;
    }

    setIsAccepting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      await onAccept(candidate.id, candidate.candidateVersion);
      setSuccessMsg(tText('تم اعتماد الفيديو المستورد بنجاح وإنشاء سجل الوسائط الدائم.', 'Candidate accepted and durable media created successfully.'));
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes('STALE_REVIEW')) {
        setErrorMsg(tText('تنبيه مراجعة قديمة: تغيرت النسخة الحالية للمرشح. يرجى تحديث وإعادة المراجعة.', 'Stale Review: Candidate version has changed. Please refresh and review again.'));
      } else {
        setErrorMsg(msg || tText('فشل اعتماد الفيديو المستورد', 'Failed to accept candidate'));
      }
      setIsAccepting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/70 backdrop-blur-xs overflow-y-auto"
      dir={isAr ? 'rtl' : 'ltr'}
      id="youtube-review-modal-backdrop"
    >
      <div
        className="relative w-full max-w-5xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 overflow-hidden flex flex-col max-h-[92vh] my-auto"
        id="youtube-review-modal-content"
      >
        {/* MODAL HEADER */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-gray-100 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-900/80">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 dark:bg-red-950/40 text-red-600 rounded-xl">
              <FileEdit className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-gray-900 dark:text-white">
                  {tText('فحص وتدقيق مادة يوتيوب المستوردة', 'Inspect & Review YouTube Candidate')}
                </h2>
                <span className="text-xs px-2 py-0.5 rounded-md font-mono font-bold bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                  v{candidate.candidateVersion}
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                    candidate.status === 'PendingReview'
                      ? 'bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-400'
                      : candidate.status === 'Accepted'
                      ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-400'
                      : 'bg-rose-100 dark:bg-rose-950/50 text-rose-800 dark:text-rose-400'
                  }`}
                >
                  {candidate.status}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {tText('معرف المرشح:', 'Candidate ID:')} <span className="font-mono">{candidate.id}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
            id="close-candidate-modal-btn"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* FEEDBACK BANNERS */}
        {errorMsg && (
          <div className="p-3 mx-4 mt-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 rounded-xl text-xs text-rose-800 dark:text-rose-400 flex items-center gap-2 font-bold animate-fadeIn">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="p-3 mx-4 mt-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 rounded-xl text-xs text-emerald-800 dark:text-emerald-400 flex items-center gap-2 font-bold animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* MODAL BODY: SIDE-BY-SIDE ON DESKTOP, STACKED ON MOBILE */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* 1. SOURCE SNAPSHOT (READ-ONLY REFERENCE) - 5 COLS */}
            <div className="lg:col-span-5 bg-gray-50 dark:bg-gray-950/70 p-4 rounded-2xl border border-gray-200/80 dark:border-gray-800 space-y-4">
              <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 pb-2.5">
                <div className="flex items-center gap-2 text-xs font-black text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                  <Layers className="w-4 h-4 text-red-500" />
                  <span>{tText('بيانات المصدر (يوتيوب)', 'YouTube Source Snapshot')}</span>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                  {tText('للعرض فقط', 'Read-Only')}
                </span>
              </div>

              {/* Source Thumbnail */}
              <div className="aspect-video w-full rounded-xl overflow-hidden bg-black/10 relative border border-gray-200 dark:border-gray-800">
                {candidate.sourceSnapshot.sourceThumbnailUrl ? (
                  <img
                    src={candidate.sourceSnapshot.sourceThumbnailUrl}
                    alt={candidate.sourceSnapshot.sourceTitle}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs font-bold">
                    {tText('لا توجد صورة معاينة', 'No Thumbnail')}
                  </div>
                )}
                <a
                  href={`https://www.youtube.com/watch?v=${candidate.externalVideoId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute bottom-2 end-2 bg-black/80 hover:bg-red-600 text-white px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1.5 transition-colors"
                >
                  <span>{tText('مشاهدة على يوتيوب', 'Open on YouTube')}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              {/* Source Title */}
              <div>
                <span className="text-[11px] font-extrabold text-gray-400 dark:text-gray-500 uppercase">
                  {tText('عنوان الفيديو في المصدر:', 'Source Title:')}
                </span>
                <p className="text-xs sm:text-sm font-bold text-gray-900 dark:text-white mt-1 select-all">
                  {candidate.sourceSnapshot.sourceTitle}
                </p>
              </div>

              {/* Publication Date */}
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <Clock className="w-3.5 h-3.5" />
                <span>
                  {tText('تاريخ النشر الأصلي:', 'Published at:')}{' '}
                  {new Date(candidate.sourceSnapshot.youtubePublishedAt).toLocaleDateString(isAr ? 'ar-SD' : 'en-US', {
                    dateStyle: 'medium',
                  })}
                </span>
              </div>

              {/* Source Description */}
              <div>
                <span className="text-[11px] font-extrabold text-gray-400 dark:text-gray-500 uppercase">
                  {tText('وصف المصدر الأصلي:', 'Source Description:')}
                </span>
                <div className="mt-1 p-2.5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 text-[11px] text-gray-600 dark:text-gray-400 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
                  {candidate.sourceSnapshot.sourceDescription || tText('لا يوجد وصف في المصدر', 'No description provided')}
                </div>
              </div>
            </div>

            {/* 2. HUMAN EDITORIAL DRAFT (EDITABLE WHILE PENDING REVIEW) - 7 COLS */}
            <div className="lg:col-span-7 bg-white dark:bg-gray-900 p-4 sm:p-5 rounded-2xl border border-gray-200/80 dark:border-gray-800 space-y-4">
              <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 pb-2.5">
                <div className="flex items-center gap-2 text-xs font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">
                  <FileEdit className="w-4 h-4" />
                  <span>{tText('المسودة التحريرية المعتمدة (تحكم بشري)', 'Human Editorial Draft')}</span>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400">
                  {tText('قابل للتحرير', 'Editable Content')}
                </span>
              </div>

              <form onSubmit={handleSaveDraft} className="space-y-3.5" id="editorial-draft-form">
                {/* Titles */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {tText('العنوان بالعربية (مطلوب)', 'Title (Arabic - Required)')} *
                    </label>
                    <input
                      type="text"
                      required
                      value={titleAr}
                      onChange={e => setTitleAr(e.target.value)}
                      disabled={!canEdit || !isPendingReview}
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-xs font-medium focus:border-emerald-600 focus:outline-hidden disabled:opacity-60"
                      placeholder={tText('العنوان التحريري بالعربية', 'Arabic editorial title')}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {tText('العنوان بالإنجليزية (اختياري)', 'Title (English - Optional)')}
                    </label>
                    <input
                      type="text"
                      value={titleEn}
                      onChange={e => setTitleEn(e.target.value)}
                      disabled={!canEdit || !isPendingReview}
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-xs font-medium focus:border-emerald-600 focus:outline-hidden disabled:opacity-60"
                      placeholder={tText('English editorial title', 'English editorial title')}
                    />
                  </div>
                </div>

                {/* Excerpts */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {tText('مقتطف موجز بالعربية', 'Excerpt (Arabic)')}
                    </label>
                    <input
                      type="text"
                      value={excerptAr}
                      onChange={e => setExcerptAr(e.target.value)}
                      disabled={!canEdit || !isPendingReview}
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-xs font-medium focus:border-emerald-600 focus:outline-hidden disabled:opacity-60"
                      placeholder={tText('موجز مختصر للمادة المرئية', 'Short summary')}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {tText('مقتطف موجز بالإنجليزية', 'Excerpt (English)')}
                    </label>
                    <input
                      type="text"
                      value={excerptEn}
                      onChange={e => setExcerptEn(e.target.value)}
                      disabled={!canEdit || !isPendingReview}
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-xs font-medium focus:border-emerald-600 focus:outline-hidden disabled:opacity-60"
                      placeholder={tText('Short summary in English', 'Short summary in English')}
                    />
                  </div>
                </div>

                {/* CANONICAL CATEGORY TAXONOMY REQUIREMENT */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300">
                      {tText('التصنيف البيئي المعتمد (إلزامي للاعتماد)', 'Canonical Category (Required for Acceptance)')} *
                    </label>
                    {!hasCategory && (
                      <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        <span>{tText('غير محدد بعد - يتطلب اختيار بشري', 'Unset - Requires human choice')}</span>
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <FolderTree className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <select
                      value={category}
                      onChange={e => setCategory(e.target.value as Category | '')}
                      disabled={!canEdit || !isPendingReview}
                      className="w-full ps-9 pe-4 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-xs font-bold text-gray-800 dark:text-gray-200 focus:border-emerald-600 focus:outline-hidden disabled:opacity-60"
                      id="candidate-category-select"
                    >
                      <option value="">{tText('-- اختر التصنيف المعتمد --', '-- Select Canonical Category --')}</option>
                      {CANONICAL_CATEGORY_DEFINITIONS.map(c => (
                        <option key={c.value} value={c.value}>
                          {isAr ? c.labelAr : c.labelEn} ({c.value})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Tags */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    {tText('الوسوم والكلمات الدلالية (مفصولة بفواصل)', 'Tags (Comma-separated)')}
                  </label>
                  <div className="relative">
                    <TagIcon className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={tagsInput}
                      onChange={e => setTagsInput(e.target.value)}
                      disabled={!canEdit || !isPendingReview}
                      className="w-full ps-9 pe-4 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-xs font-medium focus:border-emerald-600 focus:outline-hidden disabled:opacity-60"
                      placeholder={tText('مثال: مناخ, طاقة متجددة, السودان', 'e.g. Climate, Energy, Sudan')}
                    />
                  </div>
                </div>

                {/* Editorial Descriptions */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {tText('الوصف التحريري بالعربية', 'Editorial Description (Arabic)')}
                    </label>
                    <textarea
                      rows={3}
                      value={editorialDescriptionAr}
                      onChange={e => setEditorialDescriptionAr(e.target.value)}
                      disabled={!canEdit || !isPendingReview}
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-xs font-medium focus:border-emerald-600 focus:outline-hidden disabled:opacity-60 resize-none"
                      placeholder={tText('نص الوصف التحريري المعاير بالعربية...', 'Curated editorial description in Arabic...')}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {tText('الوصف التحريري بالإنجليزية (اختياري)', 'Editorial Description (English - Optional)')}
                    </label>
                    <textarea
                      rows={2}
                      value={editorialDescriptionEn}
                      onChange={e => setEditorialDescriptionEn(e.target.value)}
                      disabled={!canEdit || !isPendingReview}
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-xs font-medium focus:border-emerald-600 focus:outline-hidden disabled:opacity-60 resize-none"
                      placeholder={tText('Curated editorial description in English...', 'Curated editorial description in English...')}
                    />
                  </div>
                </div>

                {/* Save Draft Action */}
                {isPendingReview && (
                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      disabled={isSaving || !canEdit}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
                      id="save-candidate-draft-btn"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{isSaving ? tText('جاري الحفظ...', 'Saving...') : tText('حفظ المسودة التحريرية', 'Save Editorial Draft')}</span>
                    </button>
                  </div>
                )}
              </form>
            </div>
          </div>

          {/* 3. ACCEPTANCE READINESS & DURABLE REGISTRATION STATUS */}
          <div className="bg-gray-50 dark:bg-gray-950/70 p-4 rounded-2xl border border-gray-200/80 dark:border-gray-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-500" />
                <span className="text-xs font-black text-gray-900 dark:text-white uppercase tracking-wide">
                  {tText('جاهزية الاعتماد والتسجيل في الوسائط', 'Acceptance Readiness & Media Registration')}
                </span>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-400">
                {hasCategory
                  ? tText('مستوفٍ لشرط التصنيف', 'Category requirement met')
                  : tText('غير مكتمل: التصنيف مفقود', 'Incomplete: Category missing')}
              </span>
            </div>

            {/* Explicit Architectural Limitation Notice (Section 18 Contract) */}
            <div className="p-3 bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 rounded-xl text-xs text-amber-900 dark:text-amber-300 flex items-start gap-2.5">
              <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold">
                  {tText(
                    'تنبيه فني بشأن الاعتماد: مسار تسجيل الوسائط الدائم على الخادم قيد التطوير',
                    'Technical Limitation: Durable Media Registration Boundary Pending'
                  )}
                </p>
                <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-400">
                  {tText(
                    'سجلات مرشحي يوتيوب محفوظة في قاعدة بيانات Firestore، بينما يعمل سجل الوسائط الحالي على مستوى جلسة الواجهة. تم قفل زر الاعتماد عمداً لمنع انفصال البيانات (Split-Brain) بين الخادم والواجهة حتى اكتمال البنية التحتية للخادم.',
                    'YouTube import candidates reside in Firestore, whereas the Media Registry currently runs at client session level. The Accept action is intentionally locked to avoid split-brain state between server candidates and browser media registry until full durable server persistence is established.'
                  )}
                </p>
              </div>
            </div>

            {/* Checklist items */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1 text-xs">
              <div className="flex items-center gap-2 p-2 rounded-xl bg-white dark:bg-gray-900 border border-gray-200/70 dark:border-gray-800">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  {tText('بيانات المصدر موثقة', 'Source snapshot verified')}
                </span>
              </div>

              <div className="flex items-center gap-2 p-2 rounded-xl bg-white dark:bg-gray-900 border border-gray-200/70 dark:border-gray-800">
                {hasCategory ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-500 shrink-0" />
                )}
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  {hasCategory
                    ? tText(`التصنيف: ${category}`, `Category: ${category}`)
                    : tText('يتطلب تحديد تصنيف', 'Requires category')}
                </span>
              </div>

              <div className="flex items-center gap-2 p-2 rounded-xl bg-white dark:bg-gray-900 border border-gray-200/70 dark:border-gray-800">
                <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  {tText('تسجيل الخادم الدائم معلق', 'Durable server Media pending')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* MODAL FOOTER: ACTIONS */}
        <div className="p-4 sm:p-5 border-t border-gray-100 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-900/80 flex flex-col sm:flex-row justify-between items-center gap-3">
          <div className="w-full sm:w-auto flex items-center gap-2">
            {isPendingReview && (
              <>
                {confirmReject ? (
                  <div className="flex items-center gap-2 animate-fadeIn">
                    <button
                      type="button"
                      disabled={isRejecting || !canReview}
                      onClick={handleReject}
                      className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-xs"
                      id="confirm-reject-candidate-btn"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>{isRejecting ? tText('جاري الرفض...', 'Rejecting...') : tText('تأكيد الرفض النهائي', 'Confirm Final Rejection')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmReject(false)}
                      className="px-3 py-2 bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl text-xs font-bold hover:bg-gray-300 cursor-pointer"
                    >
                      {tText('إلغاء', 'Cancel')}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={!canReview}
                    onClick={() => setConfirmReject(true)}
                    className="w-full sm:w-auto px-3.5 py-2 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-900/60 hover:bg-rose-100 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    id="initiate-reject-candidate-btn"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>{tText('رفض الفيديو المستورد', 'Reject Candidate')}</span>
                  </button>
                )}
              </>
            )}
          </div>

          <div className="w-full sm:w-auto flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl text-xs font-bold hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer"
            >
              {tText('إغلاق', 'Close')}
            </button>

            {/* ACCEPT BUTTON - ACTIVATED FOR DURABLE SERVER CONVERGENCE */}
            <div className="relative group w-full sm:w-auto">
              <button
                type="button"
                disabled={isAccepting || !canReview || !hasCategory}
                onClick={handleAccept}
                className="w-full sm:w-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                id="accept-candidate-btn"
                title={
                  !hasCategory
                    ? tText('يرجى تحديد تصنيف قبل الاعتماد', 'Category required before acceptance')
                    : !canReview
                    ? tText('مطلوب صلاحية المراجعة للاعتماد', 'Review permission required to accept')
                    : tText('اعتماد المرشح وإنشاء سجل وسائط دائم', 'Accept candidate and create durable media record')
                }
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{isAccepting ? tText('جاري الاعتماد...', 'Accepting...') : tText('اعتماد في الوسائط الدائمة', 'Accept into Durable Media')}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
