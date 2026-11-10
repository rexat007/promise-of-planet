import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  GitCompare,
  Loader2,
  Lock,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import type { AdminUser } from '../../types/admin';
import type { SanitizedLibraryQuarantineHumanReviewCaseDto } from '../../services/libraryQuarantineHumanReviewClient';
import {
  LibraryQuarantineCatalogCaseAlignmentPanelController,
  areLibraryQuarantineCaseAlignmentReleaseFlagsEnabled,
  canCurrentAdminAlignQuarantineCatalogDraft,
  type GetLibraryQuarantineCatalogCaseAlignmentSuccessDto,
  type LibraryQuarantineCatalogCaseAlignmentPanelState,
  type LibraryQuarantineCatalogCaseFourFieldKey,
} from '../../services/libraryQuarantineCatalogCaseAlignmentClient';

export interface LibraryQuarantineCatalogCaseAlignmentPanelProps {
  readonly controller: LibraryQuarantineCatalogCaseAlignmentPanelController;
  readonly currentUser?: AdminUser | null;
  readonly savedReviewCase: SanitizedLibraryQuarantineHumanReviewCaseDto | null;
  readonly hasUnsavedCaseEdits?: boolean;
  readonly envOverride?: Record<string, unknown>;
  readonly onAlignmentReconciled?: (
    snapshot: GetLibraryQuarantineCatalogCaseAlignmentSuccessDto
  ) => void;
  readonly catalogDocument?: unknown;
  readonly isAr?: boolean;
}

const FIELD_LABELS: Readonly<
  Record<
    LibraryQuarantineCatalogCaseFourFieldKey,
    { readonly ar: string; readonly en: string }
  >
> = Object.freeze({
  titleAr: { ar: 'العنوان بالعربية', en: 'Arabic Title (titleAr)' },
  titleEn: { ar: 'العنوان بالإنجليزية', en: 'English Title (titleEn)' },
  summaryAr: { ar: 'الملخص بالعربية', en: 'Arabic Summary (summaryAr)' },
  summaryEn: { ar: 'الملخص بالإنجليزية', en: 'English Summary (summaryEn)' },
});

export const LibraryQuarantineCatalogCaseAlignmentPanel: React.FC<
  LibraryQuarantineCatalogCaseAlignmentPanelProps
> = ({
  controller,
  currentUser,
  savedReviewCase,
  hasUnsavedCaseEdits = false,
  envOverride,
  onAlignmentReconciled,
  catalogDocument: _catalogDocument,
  isAr = true,
}) => {
  const [state, setState] =
    useState<LibraryQuarantineCatalogCaseAlignmentPanelState>(() =>
      controller.getState()
    );

  useEffect(() => {
    setState(controller.getState());
    return controller.subscribe((nextState) => {
      setState(nextState);
    });
  }, [controller]);

  useEffect(() => {
    controller.setHasUnsavedCaseEdits(hasUnsavedCaseEdits);
  }, [controller, hasUnsavedCaseEdits]);

  const isEnabled =
    envOverride !== undefined
      ? areLibraryQuarantineCaseAlignmentReleaseFlagsEnabled(envOverride)
      : typeof (controller as any)?.isCaseAlignmentEnabled === 'function'
      ? (controller as any).isCaseAlignmentEnabled()
      : areLibraryQuarantineCaseAlignmentReleaseFlagsEnabled(envOverride);

  useEffect(() => {
    if (
      !savedReviewCase ||
      savedReviewCase.status !== 'METADATA_RECORDED' ||
      !isEnabled ||
      (currentUser !== undefined &&
        !canCurrentAdminAlignQuarantineCatalogDraft(currentUser))
    ) {
      controller.reset();
      return;
    }

    const current = controller.getState();
    if (
      current.receiptId !== savedReviewCase.receiptId ||
      current.phase === 'idle' ||
      (current.snapshot?.currentHumanCaseRevision !== undefined &&
        current.snapshot.currentHumanCaseRevision !== null &&
        current.snapshot.currentHumanCaseRevision !== savedReviewCase.revision &&
        !current.inFlight &&
        current.phase !== 'uncertain')
    ) {
      void controller.openPanelForCase(savedReviewCase, {
        hasUnsavedCaseEdits,
      });
    }
  }, [
    controller,
    currentUser,
    isEnabled,
    hasUnsavedCaseEdits,
    savedReviewCase?.receiptId,
    savedReviewCase?.status,
    savedReviewCase?.revision,
    savedReviewCase?.updatedAt,
  ]);

  if (!isEnabled) {
    return null;
  }

  if (
    currentUser !== undefined &&
    !canCurrentAdminAlignQuarantineCatalogDraft(currentUser)
  ) {
    return null;
  }

  if (!savedReviewCase || savedReviewCase.status !== 'METADATA_RECORDED') {
    return null;
  }

  const snapshot = state.snapshot;
  const isUncertain = state.phase === 'uncertain';
  const isAligning = state.phase === 'aligning' || state.inFlight;

  // Initial / Collapsed state: snapshot has not been loaded yet
  if (!snapshot) {
    return (
      <div
        className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 space-y-4"
        data-testid="quarantine-catalog-case-alignment-panel"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <GitCompare className="w-4 h-4 text-indigo-700 shrink-0" />
            <h5 className="text-xs font-bold text-indigo-950">
              {isAr
                ? 'مواءمة بيانات ملف المراجعة مع مسودة الفهرس / Case-to-Catalog Metadata Alignment'
                : 'Align Catalog Draft with Human Review Case'}
            </h5>
          </div>
          <button
            type="button"
            onClick={() => {
              if (savedReviewCase) {
                void controller.openPanelForCase(savedReviewCase, {
                  hasUnsavedCaseEdits,
                });
              }
            }}
            data-testid="open-quarantine-catalog-case-alignment-btn"
            disabled={state.inFlight}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {state.inFlight ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{isAr ? 'جاري الفحص...' : 'Checking...'}</span>
              </>
            ) : (
              <>
                <GitCompare className="w-3.5 h-3.5" />
                <span>
                  {isAr
                    ? 'فحص المواءمة ومقارنة الحقول'
                    : 'Check Alignment & Compare Fields'}
                </span>
              </>
            )}
          </button>
        </div>

        {state.phase === 'loading' && (
          <div
            className="flex items-center gap-2 text-xs text-indigo-800 py-2"
            data-testid="quarantine-case-alignment-loading"
          >
            <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
            <span>
              {isAr
                ? 'جاري تحميل حالة مواءمة المسودة... / Loading catalog alignment status...'
                : 'Loading catalog alignment status...'}
            </span>
          </div>
        )}
      </div>
    );
  }

  // Helper to extract field diff from backend diff or client diffSummary
  const getFieldDiff = (
    fieldKey: LibraryQuarantineCatalogCaseFourFieldKey
  ) => {
    if (snapshot.diff && (snapshot.diff as any)[fieldKey]) {
      const f = (snapshot.diff as any)[fieldKey];
      return {
        changed: Boolean(f.changed),
        caseValue: String(f.caseValue ?? ''),
        catalogValue: String(f.catalogValue ?? ''),
      };
    }
    if (
      (snapshot as any).diffSummary?.fields &&
      (snapshot as any).diffSummary.fields[fieldKey]
    ) {
      const f = (snapshot as any).diffSummary.fields[fieldKey];
      return {
        changed: Boolean(f.hasDiff),
        caseValue: String(f.currentCaseValue ?? ''),
        catalogValue: String(f.catalogDraftValue ?? ''),
      };
    }
    return { changed: false, caseValue: '', catalogValue: '' };
  };

  const needsRealignment = Boolean(
    snapshot.diff?.hasAnyChange ||
    (snapshot as any).hasDiff ||
    (snapshot as any).diffSummary?.hasDiff ||
    snapshot.requiresCaseRealignment ||
    (snapshot.alignmentStatus as string) === 'NEEDS_REALIGNMENT'
  );

  const handleAlignClick = async () => {
    const result = await controller.alignCatalogDraft();
    const latest = controller.getState().snapshot;
    if (result && result.ok && latest && onAlignmentReconciled) {
      onAlignmentReconciled(latest);
    }
  };

  const handleVerifyClick = async () => {
    const result = await controller.verifyAlignmentStatus();
    const latest = controller.getState().snapshot;
    if (result && result.ok && latest && onAlignmentReconciled) {
      onAlignmentReconciled(latest);
    }
  };

  const showRightsWarning =
    Boolean(state.rightsInvalidatedNotice) ||
    Boolean(snapshot.requiresFreshRightsReview) ||
    Boolean((snapshot as any).hasDiff) ||
    Boolean((snapshot as any).diffSummary?.hasDiff) ||
    Boolean(
      snapshot.currentHumanCaseRevision !== undefined &&
        (snapshot.effectiveAlignedCaseRevision !== undefined
          ? snapshot.currentHumanCaseRevision !==
            snapshot.effectiveAlignedCaseRevision
          : (snapshot as any).catalogHandoffCaseRevision !== undefined &&
            snapshot.currentHumanCaseRevision !==
              (snapshot as any).catalogHandoffCaseRevision)
    );

  return (
    <div
      className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 space-y-4"
      data-testid="quarantine-catalog-case-alignment-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-200/80 pb-3">
        <div className="flex items-center gap-2">
          <GitCompare className="w-4 h-4 text-indigo-700 shrink-0" />
          <h5 className="text-xs font-bold text-indigo-950">
            {isAr
              ? 'مواءمة بيانات ملف المراجعة مع مسودة الفهرس / Case-to-Catalog Metadata Alignment'
              : 'Align Catalog Draft with Human Review Case'}
          </h5>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
            needsRealignment
              ? 'border-amber-300 bg-amber-100 text-amber-900'
              : 'border-emerald-300 bg-emerald-100 text-emerald-900'
          }`}
          data-testid="quarantine-case-alignment-status-badge"
        >
          {isAr
            ? needsRealignment
              ? 'تتطلب مواءمة / NEEDS_REALIGNMENT'
              : 'مواءمة مكتملة / ALIGNED'
            : needsRealignment
            ? 'Differences Detected'
            : 'Aligned'}
        </span>
      </div>

      {/* Uncertain Commit Outcome Banner */}
      {isUncertain && state.uncertainState && (
        <div
          className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 space-y-2"
          role="alert"
          data-testid="quarantine-catalog-case-alignment-uncertain-banner"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-bold">
                حالة حفظ المواءمة غير مؤكدة / Alignment Commit Outcome Uncertain (
                {state.uncertainState.errorCode})
              </div>
              <p className="text-amber-800">{state.uncertainState.errorMessage}</p>
              <p className="text-[11px] text-amber-900 font-medium">
                تم إيقاف إعادة المحاولة التلقائية. استخدم زر التحقق أدناه لقراءة
                الحالة الفعلية من الخادم.
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleVerifyClick}
              disabled={state.inFlight}
              data-testid="verify-quarantine-catalog-case-alignment-btn"
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-900 disabled:opacity-50"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Verify alignment / تحقق من المواءمة
            </button>
          </div>
        </div>
      )}

      {/* Conflict Banner */}
      {state.phase === 'conflict' && state.conflictState && (
        <div
          className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-950 space-y-2"
          role="alert"
          data-testid="quarantine-case-alignment-conflict-banner"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-bold">
                تعارض في النسخة / Concurrency Conflict (
                {state.conflictState.errorCode})
              </div>
              <p className="text-rose-800">{state.conflictState.errorMessage}</p>
              <p className="text-[11px] text-rose-900">
                تم تحديث مقارنة الحقول بالنسخة الأحدث على الخادم. راجع الفروق
                ثم أعد التأكيد للمواءمة.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Fail-Closed Hold Banner */}
      {state.phase === 'hold' && state.holdState && (
        <div
          className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-950 space-y-1.5"
          role="alert"
          data-testid="quarantine-case-alignment-hold-banner"
        >
          <div className="flex items-center gap-1.5 font-bold">
            <Lock className="w-4 h-4 text-red-700 shrink-0" />
            <span>
              توقف احترازي للمواءمة / Alignment Hold ({state.holdState.errorCode})
            </span>
          </div>
          <p className="text-red-800">{state.holdState.errorMessage}</p>
        </div>
      )}

      {/* Dirty Unsaved Case Edits Warning */}
      {(state.hasUnsavedCaseEdits || hasUnsavedCaseEdits) && (
        <div
          className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 flex items-start gap-2"
          data-testid="alignment-unsaved-case-edits-warning"
        >
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold">
              تعديلات غير محفوظة في ملف المراجعة / Unsaved Human Review Case Edits Present
            </div>
            <p className="text-amber-800 mt-0.5">
              يوجد تعديل غير محفوظ في نموذج المراجعة البشرية أعلاه. يجب حفظ
              تعديلات ملف المراجعة البشري أولاً قبل مواءمة مسودة الفهرس
              الداخلية. لا يمكن تطبيق قيم غير محفوظة.
            </p>
          </div>
        </div>
      )}

      {/* Independent Rights Re-Review Required Warning Banner */}
      {showRightsWarning && (
        <div
          className="rounded-lg border border-purple-300 bg-purple-50 p-3 text-xs text-purple-950 flex items-start gap-2"
          role="status"
          data-testid="quarantine-rights-rereview-warning-banner"
        >
          <ShieldAlert className="w-4 h-4 text-purple-700 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-bold">
              {isAr
                ? 'مراجعة الحقوق تتطلب تجديداً مستقلاً للنسخة الحالية / Independent Rights Re-Review Required'
                : 'Independent Rights Re-Review Required'}
            </div>
            <p className="text-purple-900">
              {isAr
                ? `أدت مواءمة البيانات الوصفية الجديدة إلى إبطال سريان قرار الحقوق السابق للنسخة الأقدم. يجب أن يقوم مراجع حقوق مخوّل (Owner أو RightsReviewer بصلاحيتي Review + ManageRights) بتسجيل قرار حقوق بشري جديد ومستقل للنسخة الحالية (${
                    snapshot.effectiveAlignedCaseRevision ??
                    snapshot.currentHumanCaseRevision ??
                    savedReviewCase.revision
                  }).`
                : 'Case alignment to a newer revision invalidates prior human rights determinations. An authorized rights reviewer must perform an independent review of this revision.'}
            </p>
          </div>
        </div>
      )}

      {/* Snapshot Lineage & 4-Field Comparison */}
      <div className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] bg-white rounded-lg border border-indigo-100 p-2.5">
          <div>
            <span className="text-slate-500 block">Original Handoff Rev:</span>
            <span
              className="font-mono font-bold text-slate-800"
              data-testid="alignment-original-handoff-rev"
            >
              v
              {snapshot.originalHandoffCaseRevision ??
                (snapshot as any).catalogHandoffCaseRevision ??
                1}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">Effective Aligned Rev:</span>
            <span
              className="font-mono font-bold text-indigo-900"
              data-testid="alignment-effective-case-rev"
            >
              v
              {snapshot.effectiveAlignedCaseRevision ??
                (snapshot as any).catalogHandoffCaseRevision ??
                1}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">Current Case Rev:</span>
            <span
              className="font-mono font-bold text-slate-900"
              data-testid="alignment-current-case-rev"
            >
              v{snapshot.currentHumanCaseRevision ?? savedReviewCase.revision}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">Alignment Revision:</span>
            <span
              className="font-mono font-bold text-slate-800"
              data-testid="alignment-revision-count"
            >
              #{snapshot.currentAlignmentRevision ?? (snapshot as any).alignmentRevision ?? 0}
            </span>
          </div>
        </div>

        <div
          className="space-y-2"
          data-testid="alignment-diff-grid"
        >
          {(
            ['titleAr', 'titleEn', 'summaryAr', 'summaryEn'] as const
          ).map((fieldKey) => {
            const fieldDiff = getFieldDiff(fieldKey);
            const labels = FIELD_LABELS[fieldKey];
            return (
              <div
                key={fieldKey}
                className={`rounded-lg border p-2.5 text-xs ${
                  fieldDiff.changed
                    ? 'border-amber-300 bg-amber-50/60'
                    : 'border-slate-200 bg-white'
                }`}
                data-testid={`alignment-diff-field-${fieldKey}`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="font-bold text-slate-800">
                    {labels.ar} / {labels.en}
                  </span>
                  <span
                    className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      fieldDiff.changed
                        ? 'bg-amber-200 text-amber-950'
                        : 'bg-emerald-100 text-emerald-900'
                    }`}
                    data-testid={`alignment-diff-badge-${fieldKey}`}
                  >
                    {fieldDiff.changed
                      ? isAr
                        ? 'متغير / Changed'
                        : 'Changed'
                      : isAr
                      ? 'مطابق / Aligned'
                      : 'Aligned'}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded bg-slate-50 p-2 border border-slate-200/80">
                    <span className="text-slate-500 block font-medium mb-0.5">
                      قيمة مسودة الفهرس الحالية / Catalog Draft:
                    </span>
                    <div
                      className="text-slate-800 break-words"
                      data-testid={`alignment-catalog-val-${fieldKey}`}
                    >
                      {fieldDiff.catalogValue}
                    </div>
                  </div>
                  <div className="rounded bg-indigo-50/60 p-2 border border-indigo-200/80">
                    <span className="text-indigo-700 block font-medium mb-0.5">
                      قيمة ملف المراجعة المحفوظة / Saved Case:
                    </span>
                    <div
                      className="text-indigo-950 font-medium break-words"
                      data-testid={`alignment-case-val-${fieldKey}`}
                    >
                      {fieldDiff.caseValue}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Action / Confirmation Area */}
        {needsRealignment ? (
          <div className="rounded-lg border border-indigo-200 bg-white p-3 space-y-3">
            <label className="flex items-start gap-2 text-xs text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={state.confirmedApplyCaseMetadata}
                disabled={isAligning || isUncertain || state.hasUnsavedCaseEdits || hasUnsavedCaseEdits}
                onChange={(e) =>
                  controller.setConfirmedApplyCaseMetadata(e.target.checked)
                }
                data-testid="quarantine-catalog-case-alignment-confirm-checkbox"
                className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span>
                {isAr
                  ? `أؤكد مراجعة الفروق في الحقول الوصفية الأربعة وتحديث مسودة الفهرس الداخلية لتطابق النسخة المحفوظة رقم v${
                      snapshot.currentHumanCaseRevision ?? savedReviewCase.revision
                    } من ملف المراجعة البشري، مع بقاء حالة المسودة UnderReview وحجب النشر العام.`
                  : 'I confirm reviewing the 4 descriptive metadata field differences and applying them to the catalog draft.'}
              </span>
            </label>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleAlignClick}
                disabled={
                  isAligning ||
                  isUncertain ||
                  state.hasUnsavedCaseEdits ||
                  hasUnsavedCaseEdits ||
                  !state.confirmedApplyCaseMetadata
                }
                data-testid="align-quarantine-catalog-case-btn"
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {isAligning ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>
                      {isAr
                        ? 'جاري مواءمة المسودة... / Aligning draft...'
                        : 'Aligning draft...'}
                    </span>
                  </>
                ) : (
                  <>
                    <GitCompare className="w-3.5 h-3.5" />
                    <span>
                      {isAr
                        ? 'مراجعة الاختلافات ومواءمة المسودة / Review changes & align draft'
                        : 'Review changes & align draft'}
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div
            className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-950"
            data-testid="quarantine-case-alignment-aligned-summary"
          >
            <div className="flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                {isAr
                  ? `مسودة الفهرس الداخلية مطابقة للنسخة الحالية المحفوظة من ملف المراجعة (v${
                      snapshot.effectiveAlignedCaseRevision ??
                      snapshot.currentHumanCaseRevision ??
                      savedReviewCase.revision
                    }).`
                  : 'Catalog draft is aligned with current human review case revision.'}
              </span>
            </div>
            <button
              type="button"
              onClick={handleVerifyClick}
              disabled={isAligning}
              data-testid="refresh-quarantine-catalog-case-alignment-btn"
              className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-white px-2 py-1 text-[11px] font-medium text-emerald-900 hover:bg-emerald-50 disabled:opacity-50"
            >
              <RefreshCw className="w-3 h-3" />
              <span>{isAr ? 'تحديث / Refresh' : 'Refresh'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
