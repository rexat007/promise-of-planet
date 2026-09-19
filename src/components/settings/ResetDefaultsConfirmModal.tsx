import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, RotateCcw, X, Clock, Globe } from 'lucide-react';
import { DEFAULT_GLOBAL_SETTINGS } from '../../services/globalSettingsService';

interface ResetDefaultsConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isAlreadyDefault: boolean;
}

export const ResetDefaultsConfirmModal: React.FC<ResetDefaultsConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isAlreadyDefault,
}) => {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  const modalRef = useRef<HTMLDivElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Focus confirm or cancel button when opened
    confirmButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="reset-modal-title"
      aria-describedby="reset-modal-desc"
    >
      <div
        ref={modalRef}
        className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-2xl p-5 sm:p-6 space-y-5 text-start animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200/60 dark:border-amber-900/60 shrink-0">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div>
              <h3
                id="reset-modal-title"
                className="text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100"
              >
                {isAr ? 'استعادة الإعدادات الافتراضية' : 'Reset to Default Settings'}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {isAr ? 'إجراء إداري لاسترجاع التكوين الأساسي' : 'Administrative baseline reset'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
            aria-label={isAr ? 'إغلاق النافذة' : 'Close modal'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Description & Notice */}
        <div className="space-y-3">
          <p id="reset-modal-desc" className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            {isAlreadyDefault
              ? isAr
                ? 'إعدادات المنصة متطابقة حالياً مع التكوين الأساسي الافتراضي. متابعة الاستعادة لن تُحدث أي تغيير.'
                : 'The platform settings already match the canonical default configuration. Confirming reset will perform a verified no-op.'
              : isAr
              ? 'هل أنت متأكد من رغبتك في استعادة الإعدادات الافتراضية للمنصة؟ سيتم تطبيق القيم الأساسية المعتمدة فوراً على الجلسة الحالية وتوثيق العملية في سجل التدقيق.'
              : 'Are you sure you want to restore the platform defaults? Canonical baseline values will be applied to the current session and audited at the service boundary.'}
          </p>

          {/* Canonical Baseline Targets */}
          <div className="p-3.5 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200/80 dark:border-gray-700/80 space-y-2">
            <div className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              {isAr ? 'القيم الافتراضية المعتمدة:' : 'Canonical Baseline Defaults:'}
            </div>
            <div className="grid grid-cols-1 gap-2 text-xs">
              <div className="flex items-center justify-between py-1 border-b border-gray-200/50 dark:border-gray-700/50">
                <span className="flex items-center gap-1.5 text-gray-700 dark:text-gray-300 font-medium">
                  <Clock className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  {isAr ? 'ساعة المناخ الرسمية' : 'Official Climate Clock'}
                </span>
                <span className="font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-100/70 dark:bg-emerald-950/60 px-2 py-0.5 rounded-md text-[11px]">
                  {DEFAULT_GLOBAL_SETTINGS.climateClockEnabled
                    ? isAr
                      ? 'مفعّلة (Enabled)'
                      : 'Enabled'
                    : isAr
                    ? 'معطّلة (Disabled)'
                    : 'Disabled'}
                </span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="flex items-center gap-1.5 text-gray-700 dark:text-gray-300 font-medium">
                  <Globe className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  {isAr ? 'لغة المنصة الافتراضية' : 'Default Platform Language'}
                </span>
                <span className="font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-100/70 dark:bg-emerald-950/60 px-2 py-0.5 rounded-md text-[11px]">
                  {DEFAULT_GLOBAL_SETTINGS.defaultLanguage === 'ar'
                    ? isAr
                      ? 'العربية (Arabic)'
                      : 'Arabic (ar)'
                    : isAr
                    ? 'الإنجليزية (English)'
                    : 'English (en)'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2 p-2.5 bg-amber-50/70 dark:bg-amber-950/30 rounded-lg border border-amber-200/50 dark:border-amber-900/40 text-[11px] text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <span>
              {isAr
                ? 'تُطبّق الإعدادات المستعادة على جلسة التشغيل الحالية عبر الخدمة المركزية المعتمدة.'
                : 'Restored settings apply directly to the current session via the canonical service.'}
            </span>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
          >
            {isAr ? 'إلغاء' : 'Cancel'}
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5"
            id="confirm-reset-defaults-btn"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{isAr ? 'تأكيد الاستعادة' : 'Confirm Reset'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
