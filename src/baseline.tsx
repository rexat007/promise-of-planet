import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Settings,
  Clock,
  Globe,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Save,
  Info,
  Undo2,
  Lock,
} from 'lucide-react';
import type { AdminUser } from '../../types/admin';
import { AdminPermission } from '../../types/admin';
import { AdminAccessService } from '../../services/adminAccess';
import {
  GlobalSettingsService,
  DEFAULT_GLOBAL_SETTINGS,
} from '../../services/globalSettingsService';
import type {
  PlatformGlobalSettings,
  UpdateGlobalSettingsInput,
} from '../../types/settings';
import { ResetDefaultsConfirmModal } from './ResetDefaultsConfirmModal';


interface AdminGlobalSettingsProps {
  currentUser: AdminUser;
}

export const AdminGlobalSettings: React.FC<AdminGlobalSettingsProps> = ({ currentUser }) => {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  // 1. Permission Gate via Canonical RBAC
  const canManageSettings = AdminAccessService.hasPermission(
    currentUser,
    AdminPermission.ManageSettings
  );

  // 2. Canonical state & Local editable draft
  const [canonicalSettings, setCanonicalSettings] = useState<PlatformGlobalSettings>(() =>
    GlobalSettingsService.getSettings()
  );
  const [draft, setDraft] = useState<PlatformGlobalSettings>(() => ({
    ...canonicalSettings,
  }));

  // 3. UI feedback & modal states
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 4. Subscribe to canonical GlobalSettingsService changes
  useEffect(() => {
    const unsubscribe = GlobalSettingsService.subscribe((updatedSettings) => {
      setCanonicalSettings(updatedSettings);
    });
    return () => unsubscribe();
  }, []);

  // 5. Calculate dirty state against current canonical settings
  const isClimateClockDirty = draft.climateClockEnabled !== canonicalSettings.climateClockEnabled;
  const isLanguageDirty = draft.defaultLanguage !== canonicalSettings.defaultLanguage;
  const isDirty = isClimateClockDirty || isLanguageDirty;

  // 6. Check if canonical settings currently equal baseline defaults
  const isAlreadyAtDefaults = useMemo(() => {
    return (
      canonicalSettings.climateClockEnabled === DEFAULT_GLOBAL_SETTINGS.climateClockEnabled &&
      canonicalSettings.defaultLanguage === DEFAULT_GLOBAL_SETTINGS.defaultLanguage
    );
  }, [canonicalSettings]);

  // Handle Save
  const handleSave = () => {
    if (!isDirty) return;
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const payload: UpdateGlobalSettingsInput = {
        ...(isClimateClockDirty ? { climateClockEnabled: draft.climateClockEnabled } : {}),
        ...(isLanguageDirty ? { defaultLanguage: draft.defaultLanguage } : {}),
      };

      // Canonical service call: handles authorization, validation, atomic state commit & audit recording
      const result = GlobalSettingsService.updateSettings(payload, currentUser);

      // Reconcile UI with fresh canonical state
      setCanonicalSettings(result.settings);
      setDraft({ ...result.settings });

      const count = result.changes.length;
      if (count > 0) {
        setSuccessMessage(
          isAr
            ? `تم حفظ التغييرات وتطبيقها بنجاح على الجلسة الحالية (${count} ${count === 1 ? 'إعداد' : 'إعدادات'}).`
            : `Successfully saved and applied ${count} setting ${count === 1 ? 'change' : 'changes'} to the running session.`
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update settings';
      setErrorMessage(msg);
    }
  };

  // Discard draft and revert to canonical
  const handleDiscardDraft = () => {
    setDraft({ ...canonicalSettings });
    setErrorMessage(null);
  };

  // Handle Reset to Defaults confirmation
  const handleConfirmReset = () => {
    setIsResetModalOpen(false);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      // Canonical service call
      const result = GlobalSettingsService.resetToDefaults(currentUser);
      setCanonicalSettings(result.settings);
      setDraft({ ...result.settings });

      if (result.changes.length > 0) {
        setSuccessMessage(
          isAr
            ? 'تمت استعادة الإعدادات الافتراضية المعتمدة للمنصة بنجاح وتوثيقها في سجل التدقيق.'
            : 'Canonical platform defaults successfully restored and audited.'
        );
      } else {
        setSuccessMessage(
          isAr
            ? 'الإعدادات مطابقة بالفعل للتكوين الأساسي المعتمد. لم تطرأ أي تغييرات.'
            : 'Settings were already identical to canonical defaults. No state change occurred.'
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to reset settings';
      setErrorMessage(msg);
    }
  };

  // Unauthorized Fallback Screen
  if (!canManageSettings) {
    return (
      <div
        className="p-6 sm:p-8 bg-white dark:bg-gray-900 rounded-3xl border border-rose-200 dark:border-rose-900/60 shadow-xs space-y-4 max-w-2xl mx-auto my-8 text-center"
        id="settings-access-restricted"
      >
        <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 flex items-center justify-center mx-auto">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100">
            {isAr ? 'صلاحية إدارة الإعدادات العامة مقيدة' : 'Global Settings Access Restricted'}
          </h3>
          <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 max-w-md mx-auto leading-relaxed">
            {isAr
              ? `تتطلب إدارة الإعدادات العامة للمنصة صلاحية (${AdminPermission.ManageSettings}). دورك الحالي (${currentUser.role}) لا يمتلك هذا الترخيص.`
              : `Managing global platform settings requires the (${AdminPermission.ManageSettings}) permission. Your current role is (${currentUser.role}).`}
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-[11px] font-semibold text-gray-600 dark:text-gray-300">
          <Lock className="w-3.5 h-3.5" />
          <span>{isAr ? 'منطقة إدارية محمية بقواعد RBAC' : 'RBAC Protected Boundary'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl min-w-0" id="admin-global-settings">
      {/* 1. Module Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 pb-4 border-b border-gray-200/80 dark:border-gray-800 min-w-0" id="settings-module-header">
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <div className="p-2.5 rounded-2xl bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-400 border border-emerald-200/50 shrink-0">
            <Settings className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 sm:gap-2">
              <h2 className="text-lg sm:text-xl font-black text-gray-900 dark:text-gray-100 leading-tight">
                {isAr ? 'الإعدادات العامة للمنصة' : 'Platform Global Settings'}
              </h2>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 font-bold border border-emerald-300 dark:border-emerald-800 shrink-0 inline-flex items-center">
                {isAr ? 'الإصدار المعتمد' : 'Canonical'}
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 sm:mt-0.5 leading-relaxed">
              {isAr
                ? 'إدارة التكوينات الأساسية التي تؤثر على السلوك العام المعمول به في المنصة'
                : 'Manage baseline configurations governing existing platform-wide behavior'}
            </p>
          </div>
        </div>

        {/* Header Action: Reset to Defaults trigger */}
        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setIsResetModalOpen(true)}
            className="px-3.5 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-amber-600 dark:hover:text-amber-400 transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs min-h-[44px]"
            id="reset-defaults-btn"
            title={isAr ? 'استعادة التكوين الأساسي الافتراضي' : 'Restore canonical baseline defaults'}
          >
            <RotateCcw className="w-3.5 h-3.5 text-gray-500 group-hover:text-amber-600" />
            <span>{isAr ? 'استعادة الافتراضيات' : 'Reset to Defaults'}</span>
          </button>
        </div>
      </div>

      {/* 2. Persistence Reality Disclosure (Honest & Unobtrusive) */}
      <div
        className="p-3.5 sm:p-4 rounded-2xl bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200/80 dark:border-sky-900/50 flex items-start gap-3 text-start min-w-0"
        id="settings-persistence-disclosure"
      >
        <div className="p-1.5 rounded-lg bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300 shrink-0 mt-0.5">
          <Info className="w-4 h-4" />
        </div>
        <div className="space-y-0.5 min-w-0">
          <div className="text-xs font-bold text-sky-900 dark:text-sky-200">
            {isAr ? 'نطاق حفظ التكوين في الجلسة' : 'Session Scope & Persistence'}
          </div>
          <p className="text-xs text-sky-800/90 dark:text-sky-300/90 leading-relaxed">
            {isAr
              ? 'تُطبّق الإعدادات حالياً ضمن جلسة تشغيل التطبيق، ولم يتم ربطها بعد بتخزين دائم على الخادم.'
              : 'Settings currently apply to this running application session and are not yet backed by durable server persistence.'}
          </p>
        </div>
      </div>

      {/* 3. Feedback Banners (Success & Error) */}
      {successMessage && (
        <div
          className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 flex items-center justify-between gap-3 text-start animate-in fade-in duration-150"
          id="settings-success-banner"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <p className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">
              {successMessage}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-700 hover:text-emerald-900 dark:text-emerald-400 text-xs font-bold px-2 py-1 cursor-pointer"
          >
            {isAr ? 'إغلاق' : 'Dismiss'}
          </button>
        </div>
      )}

      {errorMessage && (
        <div
          className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/80 flex items-center justify-between gap-3 text-start animate-in fade-in duration-150"
          id="settings-error-banner"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <p className="text-xs font-semibold text-rose-900 dark:text-rose-200">
              {errorMessage}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-rose-700 hover:text-rose-900 dark:text-rose-400 text-xs font-bold px-2 py-1 cursor-pointer"
          >
            {isAr ? 'إغلاق' : 'Dismiss'}
          </button>
        </div>
      )}

      {/* 4. Platform Experience Section (Canonical 2 Settings Only) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2 px-1">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {isAr ? 'تجربة المنصة والخصائص المعمول بها' : 'Platform Experience & Behavior'}
          </h3>
          {isAlreadyAtDefaults && (
            <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-md">
              {isAr ? 'القيم الافتراضية مفعّلة' : 'Default Values Active'}
            </span>
          )}
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200/80 dark:border-gray-800 p-5 sm:p-6 shadow-xs space-y-6 text-start">
          {/* Setting 1: climateClockEnabled */}
          <div
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-gray-100 dark:border-gray-800/80"
            id="setting-row-climate-clock"
          >
            <div className="space-y-1.5 max-w-xl min-w-0">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60 shrink-0">
                  <Clock className="w-4 h-4" />
                </div>
                <label
                  htmlFor="climate-clock-toggle"
                  className="text-sm font-bold text-gray-900 dark:text-gray-100 cursor-pointer"
                  id="climate-clock-label"
                >
                  {isAr ? 'عرض شريط ساعة المناخ الرسمية' : 'Official Climate Clock Display'}
                </label>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${
                    draft.climateClockEnabled
                      ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700'
                  }`}
                >
                  {draft.climateClockEnabled
                    ? isAr
                      ? 'مفعّلة'
                      : 'Enabled'
                    : isAr
                    ? 'معطّلة'
                    : 'Disabled'}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed ps-7">
                {isAr
                  ? 'التحكم في ظهور فتحة شريط ساعة المناخ الرسمية في الترويسة العامة للمنصة. (لا يتم تعديل رابط الأداة الرسمية أو حقن سكربتات خارجية).'
                  : 'Controls whether the official Climate Clock widget slot renders at the top of the public platform. (Does not modify widget URL or inject external script markup).'}
              </p>
            </div>

            {/* Toggle Switch */}
            <div className="flex items-center gap-3 sm:self-center ps-7 sm:ps-0 shrink-0">
              <button
                type="button"
                role="switch"
                aria-checked={draft.climateClockEnabled}
                aria-labelledby="climate-clock-label"
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    climateClockEnabled: !prev.climateClockEnabled,
                  }))
                }
                className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 ${
                  draft.climateClockEnabled
                    ? 'bg-emerald-600 dark:bg-emerald-500'
                    : 'bg-gray-300 dark:bg-gray-700'
                }`}
                id="climate-clock-toggle"
              >
                <span className="sr-only">
                  {isAr ? 'تبديل تفعيل ساعة المناخ' : 'Toggle Climate Clock'}
                </span>
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                    draft.climateClockEnabled
                      ? isAr
                        ? '-translate-x-5'
                        : 'translate-x-5'
                      : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Setting 2: defaultLanguage */}
          <div className="space-y-3" id="setting-row-default-language">
            <div className="space-y-1.5 max-w-xl min-w-0">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-400 border border-sky-200/60 dark:border-sky-800/60 shrink-0">
                  <Globe className="w-4 h-4" />
                </div>
                <label
                  htmlFor="default-language-select"
                  className="text-sm font-bold text-gray-900 dark:text-gray-100"
                  id="default-language-label"
                >
                  {isAr ? 'لغة المنصة الافتراضية' : 'Default Platform Language'}
                </label>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 border border-sky-300 dark:border-sky-800 shrink-0">
                  {draft.defaultLanguage.toUpperCase()}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed ps-7">
                {isAr
                  ? 'تحديد اللغة الأساسية المعتمدة للمنصة عند بدء جلسات الزوار الجدد والتهيئة المبدئية. (يختلف هذا الخيار عن زر تبديل اللغة الشخصي المؤقت للمسؤول في أعلى الشاشة).'
                  : 'Specifies the platform baseline language for new visitor sessions and fallback initialization. (Distinct from the admin personal temporary language toggle in the header).'}
              </p>
            </div>

            {/* Language Selector Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 ps-7 pt-1">
              {/* Option: Arabic */}
              <button
                type="button"
                onClick={() => setDraft((prev) => ({ ...prev, defaultLanguage: 'ar' }))}
                className={`p-3.5 rounded-2xl border text-start transition-all cursor-pointer flex items-center justify-between gap-3 min-h-[48px] ${
                  draft.defaultLanguage === 'ar'
                    ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/40 text-gray-900 dark:text-gray-100 ring-1 ring-emerald-500'
                    : 'border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/40 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
                id="select-lang-ar-btn"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="text-xs font-bold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                    <span>العربية</span>
                    <span className="text-[10px] text-gray-500 font-normal">(Arabic - ar)</span>
                    <span className="text-[9px] font-semibold px-1.5 py-0.2 rounded-sm bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200">
                      {isAr ? 'الأساس' : 'Baseline'}
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">
                    {isAr ? 'اللغة الرسمية الافتراضية لمنصة وعد الكوكب' : 'Official platform baseline language'}
                  </div>
                </div>
                <div
                  className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                    draft.defaultLanguage === 'ar'
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-gray-400'
                  }`}
                >
                  {draft.defaultLanguage === 'ar' && (
                    <div className="w-1.5 h-1.5 rounded-full bg-white" />
                  )}
                </div>
              </button>

              {/* Option: English */}
              <button
                type="button"
                onClick={() => setDraft((prev) => ({ ...prev, defaultLanguage: 'en' }))}
                className={`p-3.5 rounded-2xl border text-start transition-all cursor-pointer flex items-center justify-between gap-3 min-h-[48px] ${
                  draft.defaultLanguage === 'en'
                    ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/40 text-gray-900 dark:text-gray-100 ring-1 ring-emerald-500'
                    : 'border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/40 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
                id="select-lang-en-btn"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="text-xs font-bold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                    <span>English</span>
                    <span className="text-[10px] text-gray-500 font-normal">(الإنجليزية - en)</span>
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">
                    {isAr ? 'اللغة البديلة للمحتوى والترجمة' : 'Secondary language for global readers'}
                  </div>
                </div>
                <div
                  className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                    draft.defaultLanguage === 'en'
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-gray-400'
                  }`}
                >
                  {draft.defaultLanguage === 'en' && (
                    <div className="w-1.5 h-1.5 rounded-full bg-white" />
                  )}
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 5. Save & Draft Synchronization Bar */}
      <div
        className={`p-4 rounded-2xl border transition-all duration-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          isDirty
            ? 'bg-amber-50/60 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800 shadow-sm'
            : 'bg-gray-50 dark:bg-gray-900/60 border-gray-200 dark:border-gray-800'
        }`}
        id="settings-action-bar"
      >
        {/* Status indicator */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              isDirty ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'
            }`}
          />
          <div className="min-w-0">
            <span className="text-xs font-bold text-gray-900 dark:text-gray-100 block truncate">
              {isDirty
                ? isAr
                  ? 'توجد تعديلات مسودة غير محفوظة'
                  : 'Unsaved pending modifications in draft'
                : isAr
                ? 'الإعدادات متطابقة مع الحالة المعتمدة الحالية'
                : 'Form synchronized with current canonical settings'}
            </span>
            {isDirty && (
              <span className="text-[11px] text-gray-500 dark:text-gray-400 block truncate">
                {isClimateClockDirty && (
                  <span className="me-2">
                    {isAr ? 'ساعة المناخ:' : 'Clock:'}{' '}
                    {canonicalSettings.climateClockEnabled ? 'On' : 'Off'} →{' '}
                    {draft.climateClockEnabled ? 'On' : 'Off'}
                  </span>
                )}
                {isLanguageDirty && (
                  <span>
                    {isAr ? 'اللغة الافتراضية:' : 'Language:'}{' '}
                    {canonicalSettings.defaultLanguage} → {draft.defaultLanguage}
                  </span>
                )}
              </span>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
          {isDirty && (
            <button
              type="button"
              onClick={handleDiscardDraft}
              className="px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-1.5 cursor-pointer min-h-[44px]"
              id="discard-draft-btn"
            >
              <Undo2 className="w-3.5 h-3.5 text-gray-500" />
              <span>{isAr ? 'تراجع' : 'Discard Draft'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty}
            className={`px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs transition-all cursor-pointer min-h-[44px] ${
              isDirty
                ? 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white'
                : 'bg-gray-200 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed'
            }`}
            id="save-settings-btn"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isAr ? 'حفظ التغييرات' : 'Save Changes'}</span>
          </button>
        </div>
      </div>

      {/* 6. Reset Confirmation Modal */}
      <ResetDefaultsConfirmModal
        isOpen={isResetModalOpen}
        onClose={() => setIsResetModalOpen(false)}
        onConfirm={handleConfirmReset}
        isAlreadyDefault={isAlreadyAtDefaults}
      />
    </div>
  );
};
