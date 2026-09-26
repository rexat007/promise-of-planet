import React from 'react';
import { 
  X, 
  Sparkles, 
  AlertTriangle, 
  Info, 
  Clock, 
  ShieldCheck, 
  HelpCircle,
  Lightbulb,
  FileCheck
} from 'lucide-react';
import { AdminModalViewport } from '../common/AdminModalViewport';
import type { AIReviewArtifact, AIReviewFinding } from '../../types/aiReview';
import { AIReviewSeverity } from '../../types/aiReview';
import { 
  resolveReviewTarget, 
  getTargetTypeLabel, 
  getCategoryLabel, 
  getSeverityLabel, 
  getFactualFlagLabel, 
  getExecutionStateLabel 
} from './aiReviewFormatters';
import { AIReviewService } from '../../services/aiReviewService';
import { dynamicTranslationService } from '../../services/dynamicTranslation';

interface AIReviewInspectorModalProps {
  review: AIReviewArtifact | null;
  isOpen: boolean;
  onClose: () => void;
  isAr: boolean;
}

export const AIReviewInspectorModal: React.FC<AIReviewInspectorModalProps> = ({
  review,
  isOpen,
  onClose,
  isAr,
}) => {
  if (!isOpen || !review) return null;

  const targetLang = isAr ? 'ar' : 'en';
  const resolvedTarget = resolveReviewTarget(review.target.targetType, review.target.targetId, isAr);
  const isStale = resolvedTarget.isAvailable 
    ? AIReviewService.isReviewStale(review, resolvedTarget.sourceUpdatedAt)
    : false;

  const getSeverityBadge = (sev: AIReviewSeverity) => {
    switch (sev) {
      case AIReviewSeverity.ReviewRecommended:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />
            {getSeverityLabel(sev, isAr)}
          </span>
        );
      case AIReviewSeverity.Warning:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-orange-50 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300 border border-orange-200 dark:border-orange-800">
            <AlertTriangle className="w-3 h-3 text-orange-600 shrink-0" />
            {getSeverityLabel(sev, isAr)}
          </span>
        );
      case AIReviewSeverity.Info:
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            <Info className="w-3 h-3 text-blue-600 shrink-0" />
            {getSeverityLabel(sev, isAr)}
          </span>
        );
    }
  };

  return (
    <AdminModalViewport
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      role="dialog"
      aria-labelledby="review-inspector-title"
      dir={isAr ? 'rtl' : 'ltr'}
      closeOnBackdropClick={false}
    >
      <div className="flex flex-col flex-1 min-h-0 min-w-0" id="ai-review-inspector-modal">
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-gray-100 dark:border-gray-800 flex items-start justify-between gap-4 bg-gray-50/50 dark:bg-gray-800/30 shrink-0">
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800 shrink-0">
                <Sparkles className="w-3.5 h-3.5" />
                {getTargetTypeLabel(review.target.targetType, isAr)}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate min-w-0" title={review.target.targetId}>
                {review.target.targetId}
              </span>
              {isStale ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200 border border-amber-300 dark:border-amber-700 shrink-0">
                  <Clock className="w-3 h-3" />
                  {isAr ? 'مراجعة قديمة (تم تعديل المحتوى بعد المراجعة)' : 'Stale Review (Content modified after review)'}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 shrink-0">
                  <FileCheck className="w-3 h-3" />
                  {isAr ? 'مراجعة حديثة ومتطابقة' : 'Current & Synced'}
                </span>
              )}
            </div>
            <h2 id="review-inspector-title" className="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate">
              {resolvedTarget.title}
            </h2>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0 cursor-pointer"
            aria-label={isAr ? 'إغلاق' : 'Close'}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Advisory Authority Notice */}
        <div className="px-4 sm:px-6 py-2.5 bg-emerald-50/70 dark:bg-emerald-950/30 border-b border-emerald-100 dark:border-emerald-900/40 flex items-center gap-2 text-xs text-emerald-800 dark:text-emerald-300 shrink-0">
          <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="min-w-0 truncate sm:whitespace-normal" title={
            isAr 
              ? 'تنبيه تدقيق: نتائج المراجعة استشارية فقط. تظل صلاحيات الاعتماد والنشر والرفض خاضعة كلياً للقرار البشري في مسار العمل المخصص.'
              : 'Audit Notice: AI review findings are advisory. Approval, publishing, and rejection decisions remain exclusively with human reviewers in the domain workflow.'
          }>
            {isAr 
              ? 'تنبيه تدقيق: نتائج المراجعة استشارية فقط. تظل صلاحيات الاعتماد والنشر والرفض خاضعة كلياً للقرار البشري في مسار العمل المخصص.'
              : 'Audit Notice: AI review findings are advisory. Approval, publishing, and rejection decisions remain exclusively with human reviewers in the domain workflow.'}
          </span>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-4 sm:p-6 flex-1 min-h-0 overflow-y-auto space-y-6 min-w-0">
          {/* Metadata Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4 bg-gray-50 dark:bg-gray-800/40 rounded-xl border border-gray-100 dark:border-gray-800 text-xs min-w-0">
            <div className="min-w-0">
              <span className="text-gray-500 dark:text-gray-400 block">{isAr ? 'حالة التنفيذ' : 'Execution State'}</span>
              <span className="font-bold text-gray-800 dark:text-gray-200 block truncate" title={getExecutionStateLabel(review.executionState, isAr)}>
                {getExecutionStateLabel(review.executionState, isAr)}
              </span>
            </div>
            <div className="min-w-0">
              <span className="text-gray-500 dark:text-gray-400 block">{isAr ? 'تاريخ التوليد' : 'Generated Timestamp'}</span>
              <span className="font-semibold text-gray-800 dark:text-gray-200 block truncate">
                {new Date(review.generatedAt).toLocaleString(isAr ? 'ar-SD' : 'en-US')}
              </span>
            </div>
            <div className="min-w-0">
              <span className="text-gray-500 dark:text-gray-400 block">{isAr ? 'معرف المحرك / المزود' : 'Provider Engine'}</span>
              <span className="font-mono text-gray-800 dark:text-gray-200 block truncate" title={review.providerId}>
                {review.providerId === 'mock-audit-engine' 
                  ? (isAr ? 'محاكي التدقيق التجريبي' : 'Demo Simulation Engine') 
                  : review.providerId}
              </span>
            </div>
            <div className="min-w-0">
              <span className="text-gray-500 dark:text-gray-400 block">{isAr ? 'حالة المحتوى الأصلية' : 'Domain Workflow State'}</span>
              <span className="font-bold text-emerald-700 dark:text-emerald-400 block truncate" title={resolvedTarget.domainWorkflowStatus || ''}>
                {resolvedTarget.domainWorkflowStatus || (isAr ? 'غير متوفر' : 'N/A')}
              </span>
            </div>
          </div>

          {/* Stale Warning Banner if applicable */}
          {isStale && (
            <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/60 flex items-start gap-3 text-xs text-amber-900 dark:text-amber-200 min-w-0">
              <Clock className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
              <div className="min-w-0">
                <p className="font-bold mb-0.5 truncate">
                  {isAr ? 'تم رصد تحديث في المحتوى الأصلي بعد تاريخ هذا التدقيق' : 'Source content was updated after this review was generated'}
                </p>
                <p className="text-amber-800 dark:text-amber-300">
                  {isAr 
                    ? 'قد لا تعكس بعض الملاحظات أدناه النسخة الحالية للمحتوى. يُرجى مراجعة التعديلات الحديثة في مسار العمل قبل اتخاذ القرار.'
                    : 'Some findings below may refer to an older version. Please inspect the latest modifications in the domain editor.'}
                </p>
              </div>
            </div>
          )}

          {/* Findings List */}
          <div className="space-y-4 min-w-0">
            <div className="flex items-center justify-between min-w-0">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2 min-w-0">
                <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="truncate">{isAr ? 'الملاحظات والنتائج الاستشارية المرصودة' : 'Structured Advisory Findings'}</span>
                <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-bold shrink-0">
                  {review.findings.length}
                </span>
              </h3>
            </div>

            {review.findings.length === 0 ? (
              <div className="p-8 text-center bg-gray-50 dark:bg-gray-800/30 rounded-xl border border-gray-100 dark:border-gray-800 text-gray-500 dark:text-gray-400 text-sm">
                <HelpCircle className="w-8 h-8 mx-auto mb-2 opacity-40 text-gray-400" />
                <p>{isAr ? 'لم يتم رصد أي ملاحظات تدقيق على هذا المحتوى.' : 'No audit findings recorded for this item.'}</p>
              </div>
            ) : (
              <div className="space-y-3 min-w-0">
                {review.findings.map((finding: AIReviewFinding, index: number) => {
                  const displayMessage = dynamicTranslationService.translateText(
                    finding.message,
                    finding.sourceLanguage,
                    targetLang,
                    finding.id
                  );
                  const displaySuggestion = finding.suggestion 
                    ? dynamicTranslationService.translateText(
                        finding.suggestion,
                        finding.sourceLanguage,
                        targetLang,
                        `${finding.id}-sug`
                      )
                    : null;

                  return (
                    <div 
                      key={finding.id || index}
                      className="p-4 rounded-xl bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700/80 space-y-3 min-w-0"
                    >
                      {/* Finding Tags */}
                      <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="px-2.5 py-0.5 rounded-md text-xs font-bold bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 shrink-0">
                            {getCategoryLabel(finding.category, isAr)}
                          </span>
                          {getSeverityBadge(finding.severity)}
                          {finding.flag && (
                            <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800 shrink-0">
                              {getFactualFlagLabel(finding.flag, isAr)}
                            </span>
                          )}
                        </div>

                        {finding.affectedField && (
                          <span className="text-[11px] font-mono text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900 px-2 py-0.5 rounded-md border border-gray-100 dark:border-gray-800 truncate max-w-full" title={finding.affectedField}>
                            {isAr ? 'الحقل المعني:' : 'Field:'} {finding.affectedField}
                          </span>
                        )}
                      </div>

                      {/* Finding Message */}
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 leading-relaxed break-words">
                        {displayMessage}
                      </p>

                      {/* Advisory Suggestion */}
                      {displaySuggestion && (
                        <div className="p-3 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/40 text-xs space-y-1 min-w-0">
                          <div className="flex items-center gap-1.5 font-bold text-emerald-800 dark:text-emerald-300">
                            <Lightbulb className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span>{isAr ? 'توصية تحريرية استشارية:' : 'Advisory Editorial Suggestion:'}</span>
                          </div>
                          <p className="text-gray-700 dark:text-gray-300 leading-normal pl-5 rtl:pl-0 rtl:pr-5 break-words">
                            {displaySuggestion}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-gray-500 dark:text-gray-400 min-w-0 max-w-[280px] sm:max-w-none">
            {isAr 
              ? 'مراجعة الملاحظات تتم بالتنسيق مع المحرر المسؤول في القسم المعني.' 
              : 'Audit findings should be coordinated with the responsible domain editor.'}
          </div>

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-white font-bold text-xs transition-colors cursor-pointer shrink-0"
          >
            {isAr ? 'إغلاق المعاينة' : 'Close Inspector'}
          </button>
        </div>
      </div>
    </AdminModalViewport>
  );
};
