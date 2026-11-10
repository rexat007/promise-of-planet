import React, { useEffect, useState } from 'react';
import {
  LibraryQuarantineBinarySafetyCaseController,
  type LibraryQuarantineBinarySafetyCaseControllerState,
  isLibraryQuarantineBinarySafetyCaseEnabled,
  canUserManageBinarySafetyCases,
} from '../../services/libraryQuarantineBinarySafetyCaseClient';
import {
  type LibraryQuarantineBinarySafetyDisposition,
  LIBRARY_QUARANTINE_BINARY_SAFETY_DISPOSITIONS,
} from '../../../functions/src/library/libraryQuarantineBinarySafetyCaseContract';
import type { AdminUser } from '../../types/admin';

export interface LibraryQuarantineBinarySafetyCasePanelProps {
  readonly receiptId: string;
  readonly currentUser: AdminUser | null;
  readonly lang?: 'ar' | 'en';
  readonly controllerOverride?: LibraryQuarantineBinarySafetyCaseController;
}

export const LibraryQuarantineBinarySafetyCasePanel: React.FC<LibraryQuarantineBinarySafetyCasePanelProps> = ({
  receiptId,
  currentUser,
  lang = 'ar',
  controllerOverride,
}) => {
  const [controller] = useState(
    () => controllerOverride || new LibraryQuarantineBinarySafetyCaseController(receiptId)
  );
  const [state, setState] = useState<LibraryQuarantineBinarySafetyCaseControllerState>(
    controller.getState()
  );

  const [disposition, setDisposition] = useState<LibraryQuarantineBinarySafetyDisposition>(
    'ISOLATED_ASSESSMENT_REQUIRED'
  );
  const [evidenceReference, setEvidenceReference] = useState('');
  const [evidenceNotes, setEvidenceNotes] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = controller.subscribe((newState) => {
      setState(newState);
      if (newState.snapshot?.binarySafetyCase) {
        const c = newState.snapshot.binarySafetyCase;
        setDisposition(c.disposition);
        setEvidenceReference(c.evidenceReference || '');
        setEvidenceNotes(c.evidenceNotes || '');
        setReviewNotes(c.reviewNotes || '');
      }
    });
    controller.loadCase();
    return () => {
      unsubscribe();
    };
  }, [controller]);

  if (!isLibraryQuarantineBinarySafetyCaseEnabled()) {
    return null;
  }

  const isOwner = canUserManageBinarySafetyCases(currentUser);
  if (!isOwner) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-800 dark:text-amber-200">
        {lang === 'ar'
          ? 'سجل سلامة الملفات الثنائية محصور بمسؤولي النظام (Owner) مع صلاحية المراجعة.'
          : 'Binary safety casework is restricted to system Owners with review permissions.'}
      </div>
    );
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessNotice(null);
    const currentRev = state.snapshot?.currentRevision ?? 0;
    const result = await controller.saveCase(currentRev, {
      disposition,
      evidenceReference,
      evidenceNotes,
      reviewNotes,
    });
    if (result && result.ok === true) {
      setSuccessNotice(
        lang === 'ar'
          ? 'تم حفظ سجل سلامة الملف الثنائي بنجاح.'
          : 'Binary safety case saved successfully.'
      );
    }
  };

  const handleVerifyOnly = async () => {
    setSuccessNotice(null);
    await controller.loadCase();
  };

  const isAr = lang === 'ar';

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {isAr ? 'سجل إحالة السلامة الثنائية (PDF/DOCX)' : 'Binary Safety Casework (PDF/DOCX)'}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {isAr
              ? 'متابعة بوابات الفحص المعزول وتقارير الأدلة الخارجية غير المعتمدة.'
              : 'Isolated inspection pipeline and unverified external report casework.'}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {isAr ? 'مراجعة المالك' : 'Owner Casework'}
        </span>
      </div>

      {/* Safety Notice & Posture */}
      <div className="mt-4 rounded-lg bg-blue-500/5 border border-blue-500/20 p-3 text-xs text-blue-900 dark:text-blue-200">
        <p className="font-semibold mb-1">
          {isAr ? 'تنبيه أمني تشغيلي:' : 'Operational Security Notice:'}
        </p>
        <p>
          {isAr
            ? 'لا يتم تشغيل فحص برمجيات خبيثة (AV) أو تطهير هيكلي (CDR) تلقائيًا في هذه الوحدة. الملف محجور ولا يمكن تنزيله أو نشره.'
            : 'No automated AV scan or structural CDR sanitization is executed in this unit. File is quarantined and cannot be downloaded or published.'}
        </p>
        {state.snapshot && (
          <div className="mt-2 flex flex-wrap gap-3 font-mono text-[11px]">
            <span>Format: {state.snapshot.sourceFormat}</span>
            <span>Inspection: {state.snapshot.deepInspectionStatus}</span>
            <span>Revision: {state.snapshot.currentRevision}</span>
          </div>
        )}
      </div>

      {state.phase === 'loading' && (
        <div className="py-6 text-center text-sm text-slate-500">
          {isAr ? 'جاري تحميل سجل السلامة الثنائية...' : 'Loading binary safety case...'}
        </div>
      )}

      {state.holdState && (
        <div className="mt-4 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
          <strong>HOLD:</strong> {state.holdState.errorMessage}
        </div>
      )}

      {state.conflictState && (
        <div className="mt-4 rounded-lg bg-red-500/10 p-3 text-xs text-red-800 dark:text-red-200">
          <strong>CONFLICT:</strong> {state.conflictState.errorMessage}
          <div className="mt-2">
            <button
              type="button"
              onClick={handleVerifyOnly}
              className="rounded bg-red-600 px-3 py-1 text-white hover:bg-red-700 text-xs"
            >
              {isAr ? 'تحديث السجل (قراءة فقط)' : 'Refresh Record (Verify Only)'}
            </button>
          </div>
        </div>
      )}

      {state.uncertainState && (
        <div className="mt-4 rounded-lg bg-purple-500/10 p-3 text-xs text-purple-800 dark:text-purple-200">
          <strong>UNKNOWN (Commit Uncertain):</strong> {state.uncertainState.errorMessage}
          <div className="mt-2">
            <button
              type="button"
              onClick={handleVerifyOnly}
              className="rounded bg-purple-600 px-3 py-1 text-white hover:bg-purple-700 text-xs"
            >
              {isAr ? 'التحقق من حالة السجل (GET-only)' : 'Verify Record State (GET-only)'}
            </button>
          </div>
        </div>
      )}

      {successNotice && (
        <div className="mt-4 rounded-lg bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-200">
          {successNotice}
        </div>
      )}

      {(state.phase === 'ready' || state.phase === 'saving') && (
        <form onSubmit={handleSave} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {isAr ? 'قرار الإحالة والتصنيف (Disposition)' : 'Case Disposition'}
            </label>
            <select
              value={disposition}
              onChange={(e) => setDisposition(e.target.value as LibraryQuarantineBinarySafetyDisposition)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              disabled={state.inFlight}
            >
              {LIBRARY_QUARANTINE_BINARY_SAFETY_DISPOSITIONS.map((d) => (
                <option key={d} value={d}>
                  {d === 'ISOLATED_ASSESSMENT_REQUIRED'
                    ? isAr
                      ? 'مطلوب تقييم معزول (ISOLATED_ASSESSMENT_REQUIRED)'
                      : 'Isolated Assessment Required'
                    : d === 'EXTERNAL_REPORT_NOT_VERIFIED'
                    ? isAr
                      ? 'تقرير خارجي غير مؤكد تقنياً (EXTERNAL_REPORT_NOT_VERIFIED)'
                      : 'External Report Not Verified'
                    : isAr
                    ? 'عدم المعالجة والرفض (DO_NOT_PROCESS)'
                    : 'Do Not Process'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {isAr ? 'مرجع الأدلة / رقم التذكرة (Evidence Reference)' : 'Evidence Reference / Ticket ID'}
            </label>
            <input
              type="text"
              value={evidenceReference}
              onChange={(e) => setEvidenceReference(e.target.value)}
              placeholder={isAr ? 'مثال: TICKET-99201 أو تقرير داخلي' : 'e.g. TICKET-99201'}
              maxLength={500}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              disabled={state.inFlight}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {isAr ? 'ملاحظات الأدلة (Evidence Notes)' : 'Evidence Notes'}
            </label>
            <textarea
              value={evidenceNotes}
              onChange={(e) => setEvidenceNotes(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={isAr ? 'تفاصيل الأدلة الخارجية أو ملاحظات الفحص...' : 'External evidence details or inspection notes...'}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              disabled={state.inFlight}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {isAr ? 'ملاحظات المراجعة والقرار (Review Notes)' : 'Review Notes & Justification'}
            </label>
            <textarea
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={isAr ? 'مبررات القرار التشغيلي...' : 'Operational decision justification...'}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              disabled={state.inFlight}
            />
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={state.inFlight}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {state.inFlight
                ? isAr
                  ? 'جاري الحفظ الذري...'
                  : 'Saving Atomic Casework...'
                : isAr
                ? 'حفظ سجل السلامة الثنائية'
                : 'Save Binary Safety Casework'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
