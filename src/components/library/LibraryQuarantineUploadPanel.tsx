import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Lock,
  ShieldAlert,
  Upload,
  X,
} from 'lucide-react';
import type { AdminUser } from '../../types/admin';
import {
  canUploadToLibraryQuarantine,
  LibraryQuarantineUploadSessionController,
  MAX_LIBRARY_QUARANTINE_UPLOAD_BYTES,
  resolveLibraryQuarantineUploadEndpointGate,
  type LibraryQuarantineUploadRuntimeDependencies,
  type LibraryQuarantineUploadSessionSnapshot,
} from '../../services/libraryQuarantineUploadClient';

export interface LibraryQuarantineUploadPanelProps {
  readonly currentUser: AdminUser | null | undefined;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly isAr: boolean;
  readonly runtimeDependencies?: LibraryQuarantineUploadRuntimeDependencies;
  readonly controller?: LibraryQuarantineUploadSessionController;
}

export function LibraryQuarantineUploadPanel({
  currentUser,
  isOpen,
  onClose,
  isAr,
  runtimeDependencies,
  controller: externalController,
}: LibraryQuarantineUploadPanelProps) {
  const internalControllerRef = useRef<LibraryQuarantineUploadSessionController | null>(
    null
  );
  if (!internalControllerRef.current) {
    internalControllerRef.current = new LibraryQuarantineUploadSessionController(
      currentUser,
      runtimeDependencies,
      isOpen
    );
  }

  const activeController = externalController ?? internalControllerRef.current;
  activeController.setCurrentUser(currentUser);
  activeController.setDependencies(runtimeDependencies);

  const [snapshot, setSnapshot] = useState<LibraryQuarantineUploadSessionSnapshot>(() =>
    activeController.getSnapshot()
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSnapshot(activeController.getSnapshot());
    return activeController.subscribe((next) => {
      setSnapshot(next);
    });
  }, [activeController]);

  useEffect(() => {
    if (isOpen && !activeController.getSnapshot().isOpen) {
      activeController.openPanel();
    } else if (!isOpen && activeController.getSnapshot().isOpen) {
      activeController.closePanel();
    }
  }, [isOpen, activeController]);

  const canUpload = canUploadToLibraryQuarantine(currentUser);
  const endpointGate = resolveLibraryQuarantineUploadEndpointGate(
    runtimeDependencies?.envOverrides
  );

  if (!isOpen || !canUpload) {
    return null;
  }

  const preflight = snapshot.preflightValidation;
  const activeResult = snapshot.unacknowledgedUncertainResult ?? snapshot.lastResult;
  const hasUnacknowledgedUncertainty = Boolean(snapshot.unacknowledgedUncertainResult);

  const isSubmitDisabled =
    !canUpload ||
    !endpointGate.enabled ||
    snapshot.isUploading ||
    hasUnacknowledgedUncertainty ||
    !preflight ||
    !preflight.ok;

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    activeController.selectFile(file);
  };

  const handleClearFile = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    activeController.selectFile(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitDisabled) {
      return;
    }
    await activeController.submitSelectedFile();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClose = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    activeController.closePanel();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto"
      dir={isAr ? 'rtl' : 'ltr'}
      role="dialog"
      aria-modal="true"
      aria-labelledby="library-quarantine-upload-title"
      data-testid="library-quarantine-upload-modal"
    >
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl w-full max-w-xl p-4 sm:p-6 shadow-2xl space-y-4 my-auto max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 dark:border-gray-800 pb-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 shrink-0">
              <Lock className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3
                id="library-quarantine-upload-title"
                className="font-extrabold text-sm sm:text-base text-gray-900 dark:text-white break-words"
              >
                {isAr
                  ? 'رفع مستند إلى الحجر الخاص للمكتبة'
                  : 'Upload Document to Library Private Quarantine'}
              </h3>
              <p className="text-[11px] sm:text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {isAr
                  ? 'إيداع ثنائي معزول لملفات PDF و DOCX فقط (بحد أقصى 15,000,000 بايت)'
                  : 'Isolated binary quarantine intake for PDF and DOCX files only (max 15,000,000 bytes)'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={isAr ? 'إغلاق نافذة الحجر الخاص' : 'Close private quarantine panel'}
            data-testid="library-quarantine-close-btn"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mandatory Governance Isolation Notice */}
        <div
          className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 text-[11px] sm:text-xs text-slate-700 dark:text-slate-300 space-y-1.5"
          data-testid="library-quarantine-isolation-notice"
        >
          <div className="flex items-center gap-1.5 font-extrabold text-slate-900 dark:text-slate-100">
            <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
            <span>
              {isAr
                ? 'حدود الحوكمة والعزل الأمني للحجر الخاص'
                : 'Private Quarantine Security & Governance Boundary'}
            </span>
          </div>
          <p className="leading-relaxed">
            {isAr
              ? 'إيصال الحجر الخاص يثبت حفظ النسخة الثنائية الأولية في حجر معزول خاص فقط. هذا الإجراء لا يُعد نشراً عاماً، ولا موافقة حقوقية، ولا تعقيماً للملف، ولا شهادة أمان نهائية، ولا جاهزية لـ PEIA، ولا يُدرج الملف تلقائياً ضمن سجل مراجع الاستقبال أو وثائق المكتبة.'
              : 'A quarantine receipt confirms isolated private binary storage only. It is NOT public publication, NOT rights approval, NOT file sanitization, NOT verified safe, NOT ready for PEIA, and does NOT automatically add an intake record or public library document.'}
          </p>
        </div>

        {/* Deployment / Endpoint Configuration Gate Notice */}
        {!endpointGate.enabled && (
          <div
            className="p-3.5 rounded-xl bg-amber-50/90 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs space-y-1.5"
            role="status"
            data-testid="library-quarantine-gate-disabled-banner"
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-extrabold flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                {isAr
                  ? 'الرفع غير متاح حالياً قبل تفعيل نقطة النهاية الخلفية'
                  : 'Upload Currently Unavailable Pending Backend Endpoint Activation'}
              </span>
              <span className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/60 border border-amber-300 dark:border-amber-700 font-mono text-[10px] font-bold">
                {endpointGate.status}
              </span>
            </div>
            <p className="text-[11px] leading-relaxed">
              {isAr ? endpointGate.reasonAr : endpointGate.reasonEn}
            </p>
          </div>
        )}

        {/* File Selection Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="library-quarantine-file-input"
              className="block text-xs font-extrabold text-gray-800 dark:text-gray-200"
            >
              {isAr
                ? 'ملف المستند المرشح للحجر الخاص (.pdf أو .docx فقط)'
                : 'Candidate Document File (.pdf or .docx only)'}
            </label>

            <input
              ref={fileInputRef}
              id="library-quarantine-file-input"
              data-testid="library-quarantine-file-input"
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              disabled={snapshot.isUploading || hasUnacknowledgedUncertainty}
              onChange={handleFileChange}
              className="block w-full text-xs text-gray-700 dark:text-gray-200 file:mr-3 rtl:file:mr-0 rtl:file:ml-3 file:py-2 file:px-3.5 file:rounded-xl file:border-0 file:text-xs file:font-extrabold file:bg-emerald-50 file:text-emerald-800 hover:file:bg-emerald-100 dark:file:bg-emerald-950/60 dark:file:text-emerald-300 border border-gray-300 dark:border-gray-700 rounded-xl p-1.5 bg-gray-50 dark:bg-gray-800/50 disabled:opacity-50 cursor-pointer"
            />
          </div>

          {/* Selected File Summary */}
          {snapshot.selectedFilename !== null && (
            <div
              className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              data-testid="library-quarantine-selected-file-summary"
            >
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 text-emerald-600 shrink-0" />
                <div className="min-w-0">
                  <p className="font-bold text-gray-900 dark:text-gray-100 truncate">
                    {snapshot.selectedFilename}
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    {snapshot.selectedFormat
                      ? snapshot.selectedFormat.toUpperCase()
                      : isAr
                        ? 'صيغة غير مقبولة'
                        : 'Unsupported format'}{' '}
                    •{' '}
                    {typeof snapshot.selectedByteSize === 'number'
                      ? `${snapshot.selectedByteSize.toLocaleString()} ${isAr ? 'بايت' : 'bytes'}`
                      : '0 bytes'}{' '}
                    / {MAX_LIBRARY_QUARANTINE_UPLOAD_BYTES.toLocaleString()}{' '}
                    {isAr ? 'بايت' : 'bytes'}
                  </p>
                </div>
              </div>
              {!snapshot.isUploading && !hasUnacknowledgedUncertainty && (
                <button
                  type="button"
                  onClick={handleClearFile}
                  className="text-[11px] font-bold text-gray-500 hover:text-red-600 self-end sm:self-center cursor-pointer"
                >
                  {isAr ? 'إزالة الملف' : 'Clear file'}
                </button>
              )}
            </div>
          )}

          {/* Client Preflight Validation Error */}
          {preflight && !preflight.ok && (
            <div
              className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-start gap-2"
              role="alert"
              data-testid="library-quarantine-preflight-error"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-bold">
                  {isAr ? preflight.messageAr : preflight.messageEn}
                </p>
                <p className="font-mono text-[10px] opacity-80">
                  {preflight.errorCode}
                </p>
              </div>
            </div>
          )}

          {/* In-flight honest status (no fabricated percentage) */}
          {snapshot.isUploading && (
            <div
              className="p-3.5 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 text-xs flex items-center gap-2.5"
              role="status"
              data-testid="library-quarantine-inflight-status"
            >
              <Loader2 className="h-4 w-4 animate-spin text-emerald-600 shrink-0" />
              <div className="space-y-0.5">
                <p className="font-extrabold">
                  {isAr
                    ? 'جاري إرسال الملف الثنائي والتحقق من إيصال الحجر الخاص...'
                    : 'Transmitting raw binary and verifying quarantine receipt...'}
                </p>
                <p className="text-[11px] opacity-80">
                  {isAr
                    ? 'ملاحظة: إغلاق هذه النافذة بعد الإرسال لا يلغي العملية الجارية على الخادم.'
                    : 'Note: Closing this panel after submission does not cancel server processing.'}
                </p>
              </div>
            </div>
          )}

          {/* Current Session Outcome Display */}
          {activeResult && activeResult.ok && (
            <div
              className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-950 dark:text-emerald-100 text-xs space-y-3"
              role="status"
              data-testid="library-quarantine-success-receipt"
            >
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 font-extrabold text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>
                    {isAr
                      ? 'تم توثيق إيصال الحجر الخاص (QUARANTINED)'
                      : 'Private Quarantine Receipt Verified (QUARANTINED)'}
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/70 border border-emerald-300 dark:border-emerald-700 font-mono text-[10px] font-bold">
                  {activeResult.adminReceipt.state} • rev {activeResult.revision}
                </span>
              </div>

              <p className="text-[11px] leading-relaxed">
                {isAr ? activeResult.messageAr : activeResult.messageEn}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-emerald-200/70 dark:border-emerald-800/70 text-[11px]">
                <div>
                  <span className="text-gray-500 dark:text-gray-400 block">
                    {isAr ? 'معرّف الإيصال (Receipt ID):' : 'Receipt ID:'}
                  </span>
                  <span
                    className="font-mono font-bold break-all"
                    data-testid="library-quarantine-receipt-id"
                  >
                    {activeResult.receiptId}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400 block">
                    {isAr ? 'اسم الملف المعقم:' : 'Sanitized Filename:'}
                  </span>
                  <span className="font-mono font-bold break-all">
                    {activeResult.adminReceipt.sanitizedFilename}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400 block">
                    {isAr ? 'الصيغة والحجم:' : 'Format & Byte Size:'}
                  </span>
                  <span className="font-bold">
                    {activeResult.adminReceipt.format.toUpperCase()} •{' '}
                    {activeResult.adminReceipt.byteSize.toLocaleString()}{' '}
                    {isAr ? 'بايت' : 'bytes'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400 block">
                    {isAr ? 'حالة الفحص والكتابة:' : 'Inspection & Storage Write:'}
                  </span>
                  <span className="font-bold">
                    {activeResult.adminReceipt.deepInspectionStatus} •{' '}
                    {activeResult.adminReceipt.hasVerifiedStorageWrite
                      ? isAr
                        ? 'كتابة مؤكدة'
                        : 'Verified Write'
                      : 'Unverified'}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 pt-1 text-[10px] font-mono">
                <span className="px-2 py-0.5 rounded bg-white/80 dark:bg-gray-900/70 border border-emerald-200 dark:border-emerald-800">
                  isQuarantinedPrivateOnly: true
                </span>
                <span className="px-2 py-0.5 rounded bg-white/80 dark:bg-gray-900/70 border border-emerald-200 dark:border-emerald-800">
                  isPublished: false
                </span>
                <span className="px-2 py-0.5 rounded bg-white/80 dark:bg-gray-900/70 border border-emerald-200 dark:border-emerald-800">
                  isRightsApproved: false
                </span>
                <span className="px-2 py-0.5 rounded bg-white/80 dark:bg-gray-900/70 border border-emerald-200 dark:border-emerald-800">
                  isSanitized: false
                </span>
                <span className="px-2 py-0.5 rounded bg-white/80 dark:bg-gray-900/70 border border-emerald-200 dark:border-emerald-800">
                  isVerifiedSafe: false
                </span>
                <span className="px-2 py-0.5 rounded bg-white/80 dark:bg-gray-900/70 border border-emerald-200 dark:border-emerald-800">
                  isReadyForPeia: false
                </span>
              </div>
            </div>
          )}

          {activeResult &&
            !activeResult.ok &&
            activeResult.requiresUncertaintyAck && (
              <div
                className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700 text-amber-950 dark:text-amber-100 text-xs space-y-3"
                role="alert"
                data-testid="library-quarantine-uncertain-outcome"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 font-extrabold text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>
                      {isAr
                        ? 'نتيجة الرفع غير مؤكدة — تتطلب مراجعة إدارية'
                        : 'Upload Outcome Uncertain — Administrative Review Required'}
                    </span>
                  </div>
                  <span
                    className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/70 border border-amber-300 dark:border-amber-700 font-mono text-[10px] font-bold"
                    data-testid="library-quarantine-uncertain-status"
                  >
                    {activeResult.outcome}
                  </span>
                </div>

                <p className="text-[11px] leading-relaxed">
                  {isAr ? activeResult.messageAr : activeResult.messageEn}
                </p>

                {activeResult.receiptId && (
                  <div className="p-2.5 rounded-lg bg-white/80 dark:bg-gray-900/70 border border-amber-200 dark:border-amber-800 text-[11px]">
                    <span className="text-gray-500 dark:text-gray-400 block">
                      {isAr
                        ? 'معرّف الإيصال المحفوظ للمطابقة (Receipt ID):'
                        : 'Retained Receipt ID for Reconciliation:'}
                    </span>
                    <span
                      className="font-mono font-bold break-all"
                      data-testid="library-quarantine-uncertain-receipt-id"
                    >
                      {activeResult.receiptId}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
                  <span className="font-mono text-[10px] opacity-80">
                    {activeResult.errorCode}
                  </span>
                  <button
                    type="button"
                    onClick={() => activeController.acknowledgeUncertainResult()}
                    data-testid="library-quarantine-ack-uncertain-btn"
                    className="px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-bold text-[11px] cursor-pointer"
                  >
                    {isAr
                      ? 'تأكيد الاطلاع والاحتفاظ بالحالة'
                      : 'Acknowledge Uncertain State'}
                  </button>
                </div>
              </div>
            )}

          {activeResult &&
            !activeResult.ok &&
            !activeResult.requiresUncertaintyAck && (
              <div
                className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 text-xs space-y-1.5"
                role="alert"
                data-testid="library-quarantine-rejected-outcome"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-extrabold flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {isAr ? 'تم رفض الرفع' : 'Upload Rejected'}
                  </span>
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-red-100 dark:bg-red-900/60">
                    {activeResult.binaryRejectionCode ?? activeResult.errorCode}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  {isAr ? activeResult.messageAr : activeResult.messageEn}
                </p>
              </div>
            )}

          {/* Action Footer */}
          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-3 border-t border-gray-100 dark:border-gray-800">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold text-xs cursor-pointer"
            >
              {isAr ? 'إغلاق' : 'Close'}
            </button>

            <button
              type="submit"
              disabled={isSubmitDisabled}
              data-testid="library-quarantine-submit-btn"
              className="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-xs"
            >
              {snapshot.isUploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              <span>
                {isAr
                  ? 'رفع المستند إلى الحجر الخاص'
                  : 'Upload to Private Quarantine'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
