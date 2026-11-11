import React, { useEffect, useRef, useState } from 'react';
import {
  BINARY_SAFETY_EVIDENCE_REFERENCE_MAX_LENGTH,
  BINARY_SAFETY_NOTES_MAX_LENGTH,
  LIBRARY_QUARANTINE_BINARY_SAFETY_DISPOSITIONS,
  LibraryQuarantineBinarySafetyCaseController,
  QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS,
  canUserManageBinarySafetyCases,
  isLibraryQuarantineBinarySafetyCaseEnabled,
  type LibraryQuarantineBinarySafetyCaseControllerState,
  type LibraryQuarantineBinarySafetyDisposition,
} from '../../services/libraryQuarantineBinarySafetyCaseClient';
import {
  LibraryQuarantineIsolatedInspectionRequestController,
  isLibraryQuarantineAvExecutionEnabled,
  isLibraryQuarantineIsolatedInspectionRequestEnabled,
  type LibraryQuarantineIsolatedInspectionControllerState,
  type QuarantineAvInspectionOverallStatus,
} from '../../services/libraryQuarantineIsolatedInspectionRequestClient';
import type { SanitizedLibraryQuarantineHumanReviewCaseDto } from '../../services/libraryQuarantineHumanReviewClient';
import type { AdminUser } from '../../types/admin';

export interface LibraryQuarantineBinarySafetyCasePanelProps {
  readonly receiptId: string;
  readonly currentUser: AdminUser | null;
  readonly lang?: 'ar' | 'en';
  readonly controllerOverride?: LibraryQuarantineBinarySafetyCaseController;
  readonly inspectionControllerOverride?: LibraryQuarantineIsolatedInspectionRequestController;
  readonly savedReviewCase?: SanitizedLibraryQuarantineHumanReviewCaseDto | null;
  readonly hasUnsavedCaseEdits?: boolean;
  readonly envOverride?: Record<string, unknown>;
}

function getAvExecutionStatusLabel(
  status: QuarantineAvInspectionOverallStatus | null,
  isUnknownPhase: boolean,
  isAr: boolean
): string {
  if (isUnknownPhase || status === 'DISPATCH_UNKNOWN') {
    return isAr
      ? 'إرسال غير مؤكد/قيد الإطلاق'
      : 'Dispatch uncertain / launching';
  }
  switch (status) {
    case 'DISPATCH_PENDING':
    case 'DISPATCHED_WAITING_WORKER':
    case 'RUNNING':
      return isAr ? 'الفحص يعمل' : 'AV scan running';
    case 'AV_NO_THREAT_DETECTED':
      return isAr ? 'لم يُكتشف تهديد بواسطة AV' : 'No threat detected by AV';
    case 'AV_THREAT_DETECTED':
      return isAr ? 'رُصد تهديد' : 'Threat detected by AV';
    case 'AV_SCAN_FAILED':
    case 'DISPATCH_FAILED':
    case 'STALE_HOLD':
      return isAr ? 'تعذر الفحص' : 'AV scan failed / held';
    case 'NOT_DISPATCHED':
    default:
      return isAr ? 'لم يُرسل' : 'Not dispatched';
  }
}

export const LibraryQuarantineBinarySafetyCasePanel: React.FC<
  LibraryQuarantineBinarySafetyCasePanelProps
> = ({
  receiptId,
  currentUser,
  lang = 'ar',
  controllerOverride,
  inspectionControllerOverride,
  savedReviewCase,
  hasUnsavedCaseEdits = false,
  envOverride,
}) => {
  const isEnabled = isLibraryQuarantineBinarySafetyCaseEnabled(envOverride);
  const isIsolatedInspectionEnabled =
    isLibraryQuarantineIsolatedInspectionRequestEnabled(envOverride);
  const isAvExecutionEnabled =
    isLibraryQuarantineAvExecutionEnabled(envOverride);
  const isOwner = canUserManageBinarySafetyCases(currentUser);

  const [controller] = useState(
    () =>
      controllerOverride ||
      new LibraryQuarantineBinarySafetyCaseController(receiptId, {
        ...(envOverride !== undefined ? { envOverride } : {}),
        currentUser,
      })
  );

  const [inspectionController] = useState(
    () =>
      inspectionControllerOverride ||
      new LibraryQuarantineIsolatedInspectionRequestController(receiptId, {
        ...(envOverride !== undefined ? { envOverride } : {}),
        currentUser,
      })
  );

  const [state, setState] =
    useState<LibraryQuarantineBinarySafetyCaseControllerState>(() =>
      controller.getState()
    );

  const [inspectionState, setInspectionState] =
    useState<LibraryQuarantineIsolatedInspectionControllerState>(() =>
      inspectionController.getState()
    );

  const [disposition, setDisposition] =
    useState<LibraryQuarantineBinarySafetyDisposition>(
      'ISOLATED_ASSESSMENT_REQUIRED'
    );
  const [evidenceReference, setEvidenceReference] = useState('');
  const [evidenceNotes, setEvidenceNotes] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [acknowledgedCurrentCaseRevision, setAcknowledgedCurrentCaseRevision] =
    useState(false);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [confirmedInspectionRequestOnly, setConfirmedInspectionRequestOnly] =
    useState(false);
  const [confirmedAvDispatch, setConfirmedAvDispatch] = useState(false);

  const lastHydratedKeyRef = useRef<string>('');
  const lastInspectionVersionKeyRef = useRef<string>('');
  const previousReceiptIdRef = useRef<string>(receiptId);

  useEffect(() => {
    controller.setCurrentUser(currentUser);
    inspectionController.setCurrentUser(currentUser);
  }, [controller, inspectionController, currentUser]);

  useEffect(() => {
    const unsubscribeInspection = inspectionController.subscribe(
      (nextInspectionState) => {
        setInspectionState(nextInspectionState);
        setConfirmedInspectionRequestOnly(
          nextInspectionState.confirmedRequestOnly
        );
        setConfirmedAvDispatch(nextInspectionState.confirmedAvDispatch);
      }
    );
    return () => {
      unsubscribeInspection();
    };
  }, [inspectionController]);

  useEffect(() => {
    if (previousReceiptIdRef.current !== receiptId) {
      previousReceiptIdRef.current = receiptId;
      lastHydratedKeyRef.current = '';
      lastInspectionVersionKeyRef.current = '';
      setDisposition('ISOLATED_ASSESSMENT_REQUIRED');
      setEvidenceReference('');
      setEvidenceNotes('');
      setReviewNotes('');
      setAcknowledgedCurrentCaseRevision(false);
      setSuccessNotice(null);
      setConfirmedInspectionRequestOnly(false);
      setConfirmedAvDispatch(false);
      controller.switchReceipt(receiptId);
      inspectionController.switchReceipt(receiptId);
      if (isEnabled && isOwner) {
        void controller.loadCase();
      }
    }
  }, [
    controller,
    inspectionController,
    receiptId,
    isEnabled,
    isOwner,
  ]);

  useEffect(() => {
    const unsubscribe = controller.subscribe((newState) => {
      setState(newState);
      const snap = newState.snapshot;
      if (!snap) {
        return;
      }
      const hydrationKey = `${newState.receiptId}:${snap.currentRevision}:${snap.effectiveHumanCaseRevision}:${snap.isCaseCurrent}:${snap.requiresFreshEvidence}`;
      if (lastHydratedKeyRef.current === hydrationKey) {
        return;
      }
      lastHydratedKeyRef.current = hydrationKey;

      if (
        snap.binarySafetyCase &&
        snap.isCaseCurrent &&
        !snap.requiresFreshEvidence
      ) {
        const c = snap.binarySafetyCase;
        setDisposition(c.disposition);
        setEvidenceReference(c.evidenceReference || '');
        setEvidenceNotes(c.evidenceNotes || '');
        setReviewNotes(c.reviewNotes || '');
        setAcknowledgedCurrentCaseRevision(false);
      } else {
        // Stale or new record: never auto-populate stale evidence into editable form
        setDisposition('ISOLATED_ASSESSMENT_REQUIRED');
        setEvidenceReference('');
        setEvidenceNotes('');
        setReviewNotes('');
        setAcknowledgedCurrentCaseRevision(false);
      }
    });

    if (isEnabled && isOwner) {
      void controller.loadCase();
    }

    return () => {
      unsubscribe();
    };
  }, [controller, isEnabled, isOwner]);

  // Synchronize isolated inspection request readback whenever the saved safety case version changes
  useEffect(() => {
    if (!isEnabled || !isIsolatedInspectionEnabled || !isOwner) {
      return;
    }
    const snap = state.snapshot;
    if (!snap) {
      return;
    }
    const savedSafetyCase = snap.binarySafetyCase;
    const isEligibleSafetyCase =
      savedSafetyCase !== null &&
      snap.isCaseCurrent &&
      !snap.requiresFreshEvidence &&
      savedSafetyCase.disposition === 'ISOLATED_ASSESSMENT_REQUIRED';

    const versionKey = isEligibleSafetyCase
      ? `${receiptId}:${snap.sourceRevision}:${savedSafetyCase.revision}:${snap.effectiveHumanCaseRevision}`
      : `${receiptId}:ineligible:${snap.currentRevision}:${snap.effectiveHumanCaseRevision}:${snap.isCaseCurrent}`;

    if (lastInspectionVersionKeyRef.current === versionKey) {
      return;
    }
    lastInspectionVersionKeyRef.current = versionKey;
    setConfirmedInspectionRequestOnly(false);
    setConfirmedAvDispatch(false);
    inspectionController.resetForSafetyOrCaseChange();

    if (isEligibleSafetyCase) {
      void (async () => {
        await inspectionController.loadRequest();
        if (isAvExecutionEnabled) {
          await inspectionController.loadAvInspectionStatus();
        }
      })();
    }
  }, [
    isEnabled,
    isIsolatedInspectionEnabled,
    isAvExecutionEnabled,
    isOwner,
    receiptId,
    state.snapshot,
    inspectionController,
  ]);

  if (!isEnabled) {
    return null;
  }

  const isAr = lang === 'ar';

  if (!isOwner) {
    return (
      <div
        dir={isAr ? 'rtl' : 'ltr'}
        data-testid="binary-safety-owner-restricted-notice"
        className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-800 dark:text-amber-200"
      >
        {isAr
          ? 'سجل سلامة الملفات الثنائية محصور بمسؤولي النظام (Owner) النشطين مع صلاحية المراجعة.'
          : 'Binary safety casework is restricted to active system Owners with review permissions.'}
      </div>
    );
  }

  const readiness =
    state.snapshot?.readiness ?? QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS;

  const isCaseNotMetadataRecorded =
    savedReviewCase !== undefined &&
    (savedReviewCase === null || savedReviewCase.status !== 'METADATA_RECORDED');

  const isStaleCaseDriftWithParent =
    savedReviewCase !== undefined &&
    savedReviewCase !== null &&
    state.snapshot !== null &&
    savedReviewCase.revision !== state.snapshot.effectiveHumanCaseRevision;

  const isSaveLockedByCaseState =
    hasUnsavedCaseEdits ||
    isCaseNotMetadataRecorded ||
    isStaleCaseDriftWithParent;

  const canSubmitSave =
    state.phase === 'ready' &&
    !state.inFlight &&
    !isSaveLockedByCaseState &&
    acknowledgedCurrentCaseRevision &&
    (state.snapshot?.effectiveHumanCaseRevision ?? 0) >= 1;

  const handleAcknowledgeChange = (checked: boolean) => {
    setAcknowledgedCurrentCaseRevision(checked);
    controller.setAcknowledgedCurrentCaseRevision(checked);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessNotice(null);

    if (isSaveLockedByCaseState || !acknowledgedCurrentCaseRevision) {
      return;
    }

    const currentRev = state.snapshot?.currentRevision ?? 0;
    const effectiveCaseRev = state.snapshot?.effectiveHumanCaseRevision;

    const result = (await controller.saveCase(
      currentRev,
      {
        disposition,
        evidenceReference,
        evidenceNotes,
        reviewNotes,
      },
      {
        ...(effectiveCaseRev !== undefined
          ? { acknowledgedHumanCaseRevision: effectiveCaseRev }
          : {}),
        hasUnsavedCaseEdits,
        ...(savedReviewCase !== undefined && savedReviewCase !== null
          ? { savedCaseStatus: savedReviewCase.status }
          : {}),
      }
    )) as { readonly ok?: boolean } | undefined;

    if (result && result.ok === true) {
      setSuccessNotice(
        isAr
          ? 'تم حفظ سجل سلامة الملف الثنائي ذريًا بنجاح.'
          : 'Binary safety case saved atomically.'
      );
    }
  };

  const handleVerifyOnly = async () => {
    setSuccessNotice(null);
    await controller.loadCase();
  };

  const savedSafetyCase = state.snapshot?.binarySafetyCase ?? null;
  const isSafetyCaseEligibleForInspectionRequest =
    savedSafetyCase !== null &&
    state.snapshot?.isCaseCurrent === true &&
    state.snapshot?.requiresFreshEvidence === false &&
    savedSafetyCase.disposition === 'ISOLATED_ASSESSMENT_REQUIRED' &&
    disposition === 'ISOLATED_ASSESSMENT_REQUIRED';

  const isRequestAlreadyRecordedForVersion =
    inspectionState.snapshot?.status === 'RECORDED' &&
    inspectionState.snapshot.safetyCaseRevision === savedSafetyCase?.revision &&
    inspectionState.snapshot.sourceRevision === state.snapshot?.sourceRevision;

  const canRecordIsolatedInspectionRequest =
    isIsolatedInspectionEnabled &&
    isSafetyCaseEligibleForInspectionRequest &&
    !isSaveLockedByCaseState &&
    !state.inFlight &&
    !inspectionState.inFlight &&
    !inspectionState.avInFlight &&
    inspectionState.phase !== 'unknown' &&
    inspectionState.uncertainState === null &&
    !isRequestAlreadyRecordedForVersion &&
    confirmedInspectionRequestOnly;

  const handleConfirmInspectionCheckbox = (checked: boolean) => {
    setConfirmedInspectionRequestOnly(checked);
    inspectionController.setConfirmedRequestOnly(checked);
  };

  const handleRecordIsolatedInspectionRequest = async () => {
    if (!canRecordIsolatedInspectionRequest || !savedSafetyCase || !state.snapshot) {
      return;
    }
    const res = await inspectionController.recordRequest({
      expectedSafetyCaseRevision: savedSafetyCase.revision,
      acknowledgedHumanCaseRevision: state.snapshot.effectiveHumanCaseRevision,
      hasUnsavedCaseEdits: isSaveLockedByCaseState,
      isSafetyCaseStale:
        !state.snapshot.isCaseCurrent || state.snapshot.requiresFreshEvidence,
      safetyCaseDisposition: savedSafetyCase.disposition,
    });
    if (res.ok && isAvExecutionEnabled) {
      await inspectionController.loadAvInspectionStatus();
    }
  };

  const handleVerifyInspectionRequestOnly = async () => {
    await inspectionController.loadRequest();
  };

  const recordedRequestId =
    isRequestAlreadyRecordedForVersion &&
    inspectionState.snapshot?.inspectionRequest
      ? inspectionState.snapshot.inspectionRequest.requestId
      : null;

  const avStatus = inspectionState.avStatusSnapshot?.status ?? null;
  const isAvUnknownPhase =
    inspectionState.avPhase === 'unknown' ||
    inspectionState.avUncertainState !== null ||
    avStatus === 'DISPATCH_UNKNOWN';

  const isAvNotDispatchedYet =
    avStatus === null || avStatus === 'NOT_DISPATCHED';

  const canDispatchAvInspection =
    isIsolatedInspectionEnabled &&
    isAvExecutionEnabled &&
    isSafetyCaseEligibleForInspectionRequest &&
    isRequestAlreadyRecordedForVersion &&
    recordedRequestId !== null &&
    !isSaveLockedByCaseState &&
    !state.inFlight &&
    !inspectionState.inFlight &&
    !inspectionState.avInFlight &&
    inspectionState.phase !== 'unknown' &&
    inspectionState.uncertainState === null &&
    !isAvUnknownPhase &&
    isAvNotDispatchedYet &&
    confirmedAvDispatch;

  const handleConfirmAvDispatchCheckbox = (checked: boolean) => {
    setConfirmedAvDispatch(checked);
    inspectionController.setConfirmedAvDispatch(checked);
  };

  const handleDispatchAvInspection = async () => {
    if (
      !canDispatchAvInspection ||
      !savedSafetyCase ||
      !state.snapshot ||
      !recordedRequestId
    ) {
      return;
    }
    await inspectionController.dispatchAvInspection({
      expectedRequestId: recordedRequestId,
      expectedSafetyCaseRevision: savedSafetyCase.revision,
      acknowledgedHumanCaseRevision: state.snapshot.effectiveHumanCaseRevision,
      hasUnsavedCaseEdits: isSaveLockedByCaseState,
      isSafetyCaseStale:
        !state.snapshot.isCaseCurrent || state.snapshot.requiresFreshEvidence,
      safetyCaseDisposition: savedSafetyCase.disposition,
    });
  };

  const handleVerifyAvStatusOnly = async () => {
    await inspectionController.loadAvInspectionStatus();
  };

  const staleCase = state.snapshot?.stalePreviousCase ?? null;

  return (
    <div
      dir={isAr ? 'rtl' : 'ltr'}
      data-testid="library-quarantine-binary-safety-case-panel"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {isAr
              ? 'سجل إحالة السلامة الثنائية (PDF/DOCX)'
              : 'Binary Safety Casework (PDF/DOCX)'}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {isAr
              ? 'متابعة بوابات الفحص المعزول وتقارير الأدلة الخارجية غير المعتمدة تقنيًا.'
              : 'Isolated inspection pipeline and unverified external report casework.'}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {isAr ? 'مراجعة المالك (Owner)' : 'Owner Casework'}
        </span>
      </div>

      {/* Constant Readiness Indicators */}
      <div
        data-testid="binary-safety-readiness-indicators"
        className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs sm:grid-cols-4 dark:border-slate-800 dark:bg-slate-950/60"
      >
        <div>
          <span className="block text-slate-500 dark:text-slate-400">
            {isAr ? 'السلامة الثنائية' : 'Binary Safety'}
          </span>
          <span className="font-mono font-bold text-amber-700 dark:text-amber-400">
            {readiness.binarySafety}
          </span>
        </div>
        <div>
          <span className="block text-slate-500 dark:text-slate-400">
            {isAr ? 'تطهير الملف (CDR)' : 'File Sanitization'}
          </span>
          <span className="font-mono font-bold text-amber-700 dark:text-amber-400">
            {readiness.fileSanitization}
          </span>
        </div>
        <div>
          <span className="block text-slate-500 dark:text-slate-400">
            {isAr ? 'النشر العام' : 'Publication'}
          </span>
          <span className="font-mono font-bold text-rose-700 dark:text-rose-400">
            {readiness.publication}
          </span>
        </div>
        <div>
          <span className="block text-slate-500 dark:text-slate-400">
            {isAr ? 'حالة الفهرس' : 'Catalog Workflow'}
          </span>
          <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
            {readiness.catalogWorkflow}
          </span>
        </div>
      </div>

      {/* Safety Notice & Provenance Snapshot */}
      <div className="mt-3 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-blue-900 dark:text-blue-200">
        <p className="mb-1 font-semibold">
          {isAr ? 'تنبيه أمني تشغيلي:' : 'Operational Security Notice:'}
        </p>
        <p>
          {isAr
            ? 'لا يتم تشغيل فحص برمجيات خبيثة (AV) أو محلل PDF معزول أو تطهير هيكلي (CDR) تلقائيًا في هذه الوحدة. الملف محجور ولا يمكن تنزيله أو نشره.'
            : 'No automated AV scan, isolated PDF parser, or structural CDR sanitization is executed in this unit. File is quarantined and cannot be downloaded or published.'}
        </p>
        {state.snapshot && (
          <div
            data-testid="binary-safety-provenance-summary"
            className="mt-2 flex flex-wrap gap-3 font-mono text-[11px]"
          >
            <span>Format: {state.snapshot.sourceFormat}</span>
            <span>Inspection: {state.snapshot.deepInspectionStatus}</span>
            <span>Source Rev: v{state.snapshot.sourceRevision}</span>
            <span>
              Effective Case Rev: v{state.snapshot.effectiveHumanCaseRevision}
            </span>
            <span>Safety Rev: v{state.snapshot.currentRevision}</span>
          </div>
        )}
      </div>

      {/* Dirty / Unsaved Human Review Case Lock Banner */}
      {hasUnsavedCaseEdits && (
        <div
          data-testid="binary-safety-dirty-case-lock-banner"
          className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200"
        >
          {isAr
            ? 'يوجد تعديل غير محفوظ في نموذج المراجعة البشرية أعلاه. احفظ سجل المراجعة البشرية ومواءمة الفهرس أولًا قبل تسجيل أدلة السلامة الثنائية.'
            : 'Unsaved edits detected in the human review case form above. Save the human review case and align the catalog draft before saving binary safety evidence.'}
        </div>
      )}

      {!hasUnsavedCaseEdits && isCaseNotMetadataRecorded && (
        <div
          data-testid="binary-safety-case-status-lock-banner"
          className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200"
        >
          {isAr
            ? 'يتطلب تسجيل السلامة الثنائية أن يكون سجل المراجعة البشرية محفوظًا بحالة METADATA_RECORDED.'
            : 'Binary safety casework requires the human review case to be saved in METADATA_RECORDED status.'}
        </div>
      )}

      {!hasUnsavedCaseEdits &&
        !isCaseNotMetadataRecorded &&
        isStaleCaseDriftWithParent && (
          <div
            data-testid="binary-safety-case-drift-lock-banner"
            className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200"
          >
            {isAr
              ? 'تغيرت نسخة سجل المراجعة البشرية بعد آخر مواءمة للفهرس. نفّذ مواءمة مسودة الفهرس وأعد تحميل السجل قبل الحفظ.'
              : 'Human review case revision changed since the last catalog alignment. Align the catalog draft and refresh before saving.'}
          </div>
        )}

      {/* Stale Evidence Historical Notice */}
      {state.snapshot?.requiresFreshEvidence && staleCase && (
        <div
          data-testid="binary-safety-stale-evidence-banner"
          className="mt-3 rounded-lg border border-orange-500/40 bg-orange-500/10 p-3 text-xs text-orange-900 dark:text-orange-200"
        >
          <p className="font-semibold">
            {isAr
              ? `سجل السلامة السابق (v${staleCase.revision}) مرتبط بنسخة مراجعة بشرية سابقة (v${staleCase.effectiveHumanCaseRevision}) ويُعامل كأثر تاريخي فقط (STALE). يلزم إدخال أدلة جديدة للنسخة الحالية (v${state.snapshot.effectiveHumanCaseRevision}).`
              : `Previous binary safety record (v${staleCase.revision}) was recorded for human case v${staleCase.effectiveHumanCaseRevision} and is retained as historical STALE evidence only. Fresh evidence is required for current human case v${state.snapshot.effectiveHumanCaseRevision}.`}
          </p>
          <div className="mt-1.5 font-mono text-[11px] opacity-90">
            Prior: {staleCase.disposition} | Ref:{' '}
            {staleCase.evidenceReference || '—'}
          </div>
        </div>
      )}

      {state.phase === 'loading' && (
        <div
          data-testid="binary-safety-loading"
          className="py-6 text-center text-sm text-slate-500"
        >
          {isAr
            ? 'جاري تحميل سجل السلامة الثنائية...'
            : 'Loading binary safety case...'}
        </div>
      )}

      {state.holdState && (
        <div
          data-testid="binary-safety-hold-banner"
          className="mt-4 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200"
        >
          <strong>HOLD ({state.holdState.errorCode}):</strong>{' '}
          {state.holdState.errorMessage}
          <div className="mt-2">
            <button
              type="button"
              data-testid="binary-safety-reload-hold-btn"
              onClick={handleVerifyOnly}
              className="rounded bg-amber-600 px-3 py-1 text-xs text-white hover:bg-amber-700"
            >
              {isAr ? 'إعادة التحقق (GET-only)' : 'Reload State (GET-only)'}
            </button>
          </div>
        </div>
      )}

      {state.conflictState && (
        <div
          data-testid="binary-safety-conflict-banner"
          className="mt-4 rounded-lg bg-red-500/10 p-3 text-xs text-red-800 dark:text-red-200"
        >
          <strong>CONFLICT:</strong> {state.conflictState.errorMessage}
          <div className="mt-2">
            <button
              type="button"
              data-testid="binary-safety-refresh-conflict-btn"
              onClick={handleVerifyOnly}
              className="rounded bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-700"
            >
              {isAr
                ? 'تحديث السجل (قراءة فقط)'
                : 'Refresh Record (Verify Only)'}
            </button>
          </div>
        </div>
      )}

      {state.uncertainState && (
        <div
          data-testid="binary-safety-unknown-banner"
          className="mt-4 rounded-lg bg-purple-500/10 p-3 text-xs text-purple-800 dark:text-purple-200"
        >
          <strong>UNKNOWN (Commit Uncertain):</strong>{' '}
          {state.uncertainState.errorMessage}
          <div className="mt-2">
            <button
              type="button"
              data-testid="binary-safety-verify-unknown-btn"
              onClick={handleVerifyOnly}
              className="rounded bg-purple-600 px-3 py-1 text-xs text-white hover:bg-purple-700"
            >
              {isAr
                ? 'التحقق من حالة السجل (GET-only)'
                : 'Verify Record State (GET-only)'}
            </button>
          </div>
        </div>
      )}

      {state.errorMessage && (
        <div
          data-testid="binary-safety-error-banner"
          className="mt-4 rounded-lg bg-rose-500/10 p-3 text-xs text-rose-800 dark:text-rose-200"
        >
          {state.errorMessage}
        </div>
      )}

      {successNotice && (
        <div
          data-testid="binary-safety-success-banner"
          className="mt-4 rounded-lg bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-200"
        >
          {successNotice}
        </div>
      )}

      {(state.phase === 'ready' || state.phase === 'saving') && (
        <form onSubmit={handleSave} className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
              {isAr ? 'قرار الإحالة والتصنيف (Disposition)' : 'Case Disposition'}
            </label>
            <select
              data-testid="binary-safety-disposition-select"
              value={disposition}
              onChange={(e) =>
                setDisposition(
                  e.target.value as LibraryQuarantineBinarySafetyDisposition
                )
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              disabled={state.inFlight || isSaveLockedByCaseState}
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
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
              {isAr
                ? 'مرجع الأدلة / رقم التذكرة (Evidence Reference)'
                : 'Evidence Reference / Ticket ID'}
            </label>
            <input
              type="text"
              data-testid="binary-safety-evidence-reference-input"
              value={evidenceReference}
              onChange={(e) => setEvidenceReference(e.target.value)}
              placeholder={
                isAr ? 'مثال: TICKET-99201 أو تقرير داخلي' : 'e.g. TICKET-99201'
              }
              maxLength={BINARY_SAFETY_EVIDENCE_REFERENCE_MAX_LENGTH}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              disabled={state.inFlight || isSaveLockedByCaseState}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
              {isAr ? 'ملاحظات الأدلة (Evidence Notes)' : 'Evidence Notes'}
            </label>
            <textarea
              data-testid="binary-safety-evidence-notes-input"
              value={evidenceNotes}
              onChange={(e) => setEvidenceNotes(e.target.value)}
              rows={3}
              maxLength={BINARY_SAFETY_NOTES_MAX_LENGTH}
              placeholder={
                isAr
                  ? 'تفاصيل الأدلة الخارجية أو ملاحظات الفحص...'
                  : 'External evidence details or inspection notes...'
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              disabled={state.inFlight || isSaveLockedByCaseState}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
              {isAr
                ? 'ملاحظات المراجعة والقرار (Review Notes)'
                : 'Review Notes & Justification'}
            </label>
            <textarea
              data-testid="binary-safety-review-notes-input"
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              rows={3}
              maxLength={BINARY_SAFETY_NOTES_MAX_LENGTH}
              placeholder={
                isAr
                  ? 'مبررات القرار التشغيلي...'
                  : 'Operational decision justification...'
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              disabled={state.inFlight || isSaveLockedByCaseState}
            />
          </div>

          {/* Mandatory Checkbox to Acknowledge Current Effective Human Case Revision */}
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-300">
            <input
              type="checkbox"
              data-testid="binary-safety-acknowledge-case-revision-checkbox"
              checked={acknowledgedCurrentCaseRevision}
              onChange={(e) => handleAcknowledgeChange(e.target.checked)}
              disabled={state.inFlight || isSaveLockedByCaseState}
              className="mt-0.5"
            />
            <span>
              {isAr
                ? `أقرّ بأن أدلة السلامة الثنائية المسجلة أعلاه تتطابق مع النسخة الفعالة الحالية لسجل المراجعة البشرية (v${
                    state.snapshot?.effectiveHumanCaseRevision ?? 0
                  }) ونسخة المصدر (v${
                    state.snapshot?.sourceRevision ?? 0
                  })، مع بقاء الملف محجورًا وغير معتمد للنشر.`
                : `I acknowledge that this binary safety evidence applies to current effective human review case revision v${
                    state.snapshot?.effectiveHumanCaseRevision ?? 0
                  } (source v${
                    state.snapshot?.sourceRevision ?? 0
                  }) and that the binary file remains quarantined and unapproved for release.`}
            </span>
          </label>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              data-testid="save-quarantine-binary-safety-case-btn"
              disabled={!canSubmitSave}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {state.inFlight
                ? isAr
                  ? 'جاري الحفظ الذري...'
                  : 'Saving Atomic Casework...'
                : state.snapshot?.requiresFreshEvidence
                ? isAr
                  ? 'تجديد سجل السلامة الثنائية'
                  : 'Renew Binary Safety Casework'
                : isAr
                ? 'حفظ سجل السلامة الثنائية'
                : 'Save Binary Safety Casework'}
            </button>
          </div>
        </form>
      )}

      {/* Secondary Isolated Inspection Request Recording Section */}
      {isIsolatedInspectionEnabled && (
        <div
          data-testid="isolated-inspection-request-section"
          className="mt-5 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/50"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {isAr
                ? 'إحالة إلى فحص معزول — تسجيل فقط'
                : 'Isolated inspection — record request only'}
            </h4>
            <span
              data-testid="isolated-inspection-status-badge"
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                isRequestAlreadyRecordedForVersion
                  ? 'bg-amber-500/15 text-amber-800 dark:text-amber-200'
                  : 'bg-slate-200/80 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {isRequestAlreadyRecordedForVersion
                ? isAr
                  ? 'طُلب ولم يُرسل لعامل فحص'
                  : 'Requested — not dispatched to worker'
                : isAr
                ? 'لم يُسجّل طلب لهذه النسخة'
                : 'No request recorded for this version'}
            </span>
          </div>

          <p
            data-testid="isolated-inspection-explicit-notice"
            className="mt-2 text-xs text-slate-600 dark:text-slate-300"
          >
            {isAr
              ? 'تم تسجيل طلب الفحص فقط — لم يُرسل إلى عامل فحص ولم يبدأ أي فحص تقني'
              : 'Inspection request recorded only — not dispatched to any inspection worker and no technical scan has started.'}
          </p>

          {!isSafetyCaseEligibleForInspectionRequest && (
            <div
              data-testid="isolated-inspection-prerequisite-notice"
              className="mt-2 rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
            >
              {isAr
                ? 'يتطلب تسجيل طلب الفحص المعزول حفظ سجل سلامة ثنائية حالي غير متقادم بحالة ISOLATED_ASSESSMENT_REQUIRED أولًا.'
                : 'Recording an isolated inspection request requires a current saved binary safety case with disposition ISOLATED_ASSESSMENT_REQUIRED.'}
            </div>
          )}

          {inspectionState.snapshot?.inspectionRequest &&
            isRequestAlreadyRecordedForVersion && (
              <div
                data-testid="isolated-inspection-recorded-details"
                className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 font-mono text-[11px] text-amber-900 dark:text-amber-200"
              >
                <div>
                  Request ID:{' '}
                  {inspectionState.snapshot.inspectionRequest.requestId}
                </div>
                <div>
                  State: {inspectionState.snapshot.inspectionRequest.state} |
                  Dispatched: false | Scan Performed: false
                </div>
              </div>
            )}

          {inspectionState.uncertainState && (
            <div
              data-testid="isolated-inspection-unknown-banner"
              className="mt-3 rounded-lg bg-purple-500/10 p-3 text-xs text-purple-800 dark:text-purple-200"
            >
              <strong>UNKNOWN (Commit Uncertain):</strong>{' '}
              {inspectionState.uncertainState.errorMessage}
              <div className="mt-2">
                <button
                  type="button"
                  data-testid="isolated-inspection-verify-unknown-btn"
                  onClick={handleVerifyInspectionRequestOnly}
                  className="rounded bg-purple-600 px-3 py-1 text-xs text-white hover:bg-purple-700"
                >
                  {isAr
                    ? 'التحقق من حالة الطلب (GET-only)'
                    : 'Verify Request State (GET-only)'}
                </button>
              </div>
            </div>
          )}

          {inspectionState.conflictState && (
            <div
              data-testid="isolated-inspection-conflict-banner"
              className="mt-3 rounded-lg bg-red-500/10 p-3 text-xs text-red-800 dark:text-red-200"
            >
              <strong>CONFLICT:</strong>{' '}
              {inspectionState.conflictState.errorMessage}
              <div className="mt-2">
                <button
                  type="button"
                  data-testid="isolated-inspection-refresh-conflict-btn"
                  onClick={handleVerifyInspectionRequestOnly}
                  className="rounded bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-700"
                >
                  {isAr
                    ? 'إعادة التحقق (GET-only)'
                    : 'Refresh Request State (GET-only)'}
                </button>
              </div>
            </div>
          )}

          {inspectionState.holdState && (
            <div
              data-testid="isolated-inspection-hold-banner"
              className="mt-3 rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-200"
            >
              <strong>HOLD ({inspectionState.holdState.errorCode}):</strong>{' '}
              {inspectionState.holdState.errorMessage}
            </div>
          )}

          <label className="mt-3 flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            <input
              type="checkbox"
              data-testid="isolated-inspection-confirm-checkbox"
              checked={confirmedInspectionRequestOnly}
              onChange={(e) =>
                handleConfirmInspectionCheckbox(e.target.checked)
              }
              disabled={
                !isSafetyCaseEligibleForInspectionRequest ||
                isSaveLockedByCaseState ||
                state.inFlight ||
                inspectionState.inFlight ||
                inspectionState.avInFlight ||
                inspectionState.phase === 'unknown' ||
                isRequestAlreadyRecordedForVersion
              }
              className="mt-0.5"
            />
            <span>
              {isAr
                ? 'أؤكد طلب الفحص لهذه النسخة؛ لا يعني هذا تشغيل الفحص أو اعتماده'
                : 'I confirm requesting isolated inspection for this version; this does not run or approve the scan'}
            </span>
          </label>

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              data-testid="record-isolated-inspection-request-btn"
              onClick={handleRecordIsolatedInspectionRequest}
              disabled={!canRecordIsolatedInspectionRequest}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              {inspectionState.inFlight
                ? isAr
                  ? 'جاري تسجيل الطلب...'
                  : 'Recording Request...'
                : isAr
                ? 'تسجيل الطلب'
                : 'Record Request'}
            </button>
          </div>

          {/* Bounded Isolated ClamAV Execution Subsection (Gated by VITE_LIBRARY_AV_EXECUTION_ENABLED) */}
          {isAvExecutionEnabled && (
            <div
              data-testid="isolated-av-execution-subsection"
              className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h5 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  {isAr
                    ? 'فحص البرمجيات الخبيثة المعزول (ClamAV)'
                    : 'Isolated Antivirus Execution (ClamAV)'}
                </h5>
                <div className="flex items-center gap-2">
                  <span
                    data-testid="isolated-av-execution-status-badge"
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      avStatus === 'AV_NO_THREAT_DETECTED'
                        ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200'
                        : avStatus === 'AV_THREAT_DETECTED'
                        ? 'bg-rose-500/20 text-rose-800 dark:text-rose-200'
                        : avStatus === 'AV_SCAN_FAILED' ||
                          avStatus === 'DISPATCH_FAILED' ||
                          avStatus === 'STALE_HOLD'
                        ? 'bg-amber-500/20 text-amber-900 dark:text-amber-200'
                        : isAvUnknownPhase
                        ? 'bg-purple-500/20 text-purple-900 dark:text-purple-200'
                        : avStatus === 'DISPATCH_PENDING' ||
                          avStatus === 'DISPATCHED_WAITING_WORKER' ||
                          avStatus === 'RUNNING'
                        ? 'bg-blue-500/15 text-blue-800 dark:text-blue-200'
                        : 'bg-slate-200/80 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {getAvExecutionStatusLabel(avStatus, isAvUnknownPhase, isAr)}
                  </span>
                  <button
                    type="button"
                    data-testid="isolated-av-execution-refresh-btn"
                    onClick={handleVerifyAvStatusOnly}
                    disabled={
                      inspectionState.avInFlight ||
                      inspectionState.inFlight ||
                      state.inFlight
                    }
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  >
                    {isAr ? 'تحديث الحالة (GET)' : 'Refresh Status (GET)'}
                  </button>
                </div>
              </div>

              <p
                data-testid="isolated-av-execution-warning-notice"
                className="mt-2 text-xs text-slate-600 dark:text-slate-300"
              >
                {isAr
                  ? 'سيتم إرسال الملف إلى فاحص AV معزول؛ نتيجة AV وحدها لا تسمح بنشر الملف'
                  : 'The file will be sent to an isolated AV scanner; an AV result alone does not permit publishing the file'}
              </p>

              {inspectionState.avStatusSnapshot?.execution && (
                <div
                  data-testid="isolated-av-execution-details"
                  className="mt-2 rounded-lg border border-slate-200 bg-white p-2.5 font-mono text-[11px] text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                >
                  <div>
                    Execution State:{' '}
                    {inspectionState.avStatusSnapshot.execution.state} | Rev: v
                    {inspectionState.avStatusSnapshot.execution.revision}
                  </div>
                  {inspectionState.avStatusSnapshot.execution.engineName && (
                    <div>
                      Engine:{' '}
                      {inspectionState.avStatusSnapshot.execution.engineName}{' '}
                      {inspectionState.avStatusSnapshot.execution
                        .engineVersion ?? ''}{' '}
                      | Sig:{' '}
                      {inspectionState.avStatusSnapshot.execution
                        .signatureVersion ?? '—'}{' '}
                      | Bytes:{' '}
                      {inspectionState.avStatusSnapshot.execution
                        .scannedBytes ?? '—'}{' '}
                      | Exit:{' '}
                      {inspectionState.avStatusSnapshot.execution.exitCode ??
                        '—'}
                    </div>
                  )}
                  {inspectionState.avStatusSnapshot.execution
                    .failureReasonCode && (
                    <div>
                      Reason Code:{' '}
                      {
                        inspectionState.avStatusSnapshot.execution
                          .failureReasonCode
                      }
                    </div>
                  )}
                </div>
              )}

              {isAvUnknownPhase && (
                <div
                  data-testid="isolated-av-execution-unknown-banner"
                  className="mt-3 rounded-lg bg-purple-500/10 p-3 text-xs text-purple-800 dark:text-purple-200"
                >
                  <strong>UNKNOWN (Dispatch Uncertain):</strong>{' '}
                  {inspectionState.avUncertainState?.errorMessage ??
                    (isAr
                      ? 'حالة إرسال مهمة الفحص غير مؤكدة؛ تحقق عبر القراءة فقط دون إعادة الإرسال.'
                      : 'AV job dispatch acknowledgement is uncertain; verify via GET-only without retrying.')}
                  <div className="mt-2">
                    <button
                      type="button"
                      data-testid="isolated-av-execution-verify-unknown-btn"
                      onClick={handleVerifyAvStatusOnly}
                      className="rounded bg-purple-600 px-3 py-1 text-xs text-white hover:bg-purple-700"
                    >
                      {isAr
                        ? 'التحقق من حالة الفحص (GET-only)'
                        : 'Verify AV Status (GET-only)'}
                    </button>
                  </div>
                </div>
              )}

              {inspectionState.avConflictState && (
                <div
                  data-testid="isolated-av-execution-conflict-banner"
                  className="mt-3 rounded-lg bg-red-500/10 p-3 text-xs text-red-800 dark:text-red-200"
                >
                  <strong>CONFLICT:</strong>{' '}
                  {inspectionState.avConflictState.errorMessage}
                </div>
              )}

              {inspectionState.avHoldState && (
                <div
                  data-testid="isolated-av-execution-hold-banner"
                  className="mt-3 rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-200"
                >
                  <strong>
                    HOLD ({inspectionState.avHoldState.errorCode}):
                  </strong>{' '}
                  {inspectionState.avHoldState.errorMessage}
                </div>
              )}

              <label className="mt-3 flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                <input
                  type="checkbox"
                  data-testid="isolated-av-execution-confirm-checkbox"
                  checked={confirmedAvDispatch}
                  onChange={(e) =>
                    handleConfirmAvDispatchCheckbox(e.target.checked)
                  }
                  disabled={
                    !isSafetyCaseEligibleForInspectionRequest ||
                    !isRequestAlreadyRecordedForVersion ||
                    isSaveLockedByCaseState ||
                    state.inFlight ||
                    inspectionState.inFlight ||
                    inspectionState.avInFlight ||
                    inspectionState.phase === 'unknown' ||
                    isAvUnknownPhase ||
                    !isAvNotDispatchedYet
                  }
                  className="mt-0.5"
                />
                <span>
                  {isAr
                    ? 'سيتم إرسال الملف إلى فاحص AV معزول؛ نتيجة AV وحدها لا تسمح بنشر الملف'
                    : 'The file will be sent to an isolated AV scanner; an AV result alone does not permit publishing the file'}
                </span>
              </label>

              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  data-testid="dispatch-isolated-av-inspection-btn"
                  onClick={handleDispatchAvInspection}
                  disabled={!canDispatchAvInspection}
                  className="rounded-lg border border-blue-600 bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {inspectionState.avInFlight
                    ? isAr
                      ? 'جاري إرسال مهمة الفحص...'
                      : 'Dispatching AV Scan...'
                    : isAr
                    ? 'إرسال لفحص AV المعزول'
                    : 'Dispatch Isolated AV Scan'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

