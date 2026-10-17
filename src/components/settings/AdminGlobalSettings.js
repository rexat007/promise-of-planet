"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminGlobalSettings = void 0;
const react_1 = require("react");
const react_i18next_1 = require("react-i18next");
const lucide_react_1 = require("lucide-react");
const admin_1 = require("../../types/admin");
const adminAccess_1 = require("../../services/adminAccess");
const globalSettingsService_1 = require("../../services/globalSettingsService");
const platformSettingsAdminClient_1 = require("../../services/platformSettingsAdminClient");
const platformBrandingStorageClient_1 = require("../../services/platformBrandingStorageClient");
const ResetDefaultsConfirmModal_1 = require("./ResetDefaultsConfirmModal");
const AdminGlobalSettings = ({ currentUser }) => {
    const { i18n } = (0, react_i18next_1.useTranslation)();
    const isAr = i18n.language === 'ar';
    // 1. Permission Gate via Canonical RBAC
    const canManageSettings = adminAccess_1.AdminAccessService.hasPermission(currentUser, admin_1.AdminPermission.ManageSettings);
    // 2. Canonical state & Local editable draft
    const [canonicalSettings, setCanonicalSettings] = (0, react_1.useState)(() => globalSettingsService_1.GlobalSettingsService.getSettings());
    const [draft, setDraft] = (0, react_1.useState)(() => ({
        ...canonicalSettings,
    }));
    // 3. UI feedback & modal states
    const [isResetModalOpen, setIsResetModalOpen] = (0, react_1.useState)(false);
    const [successMessage, setSuccessMessage] = (0, react_1.useState)(null);
    const [errorMessage, setErrorMessage] = (0, react_1.useState)(null);
    // 3b. Branding state
    const [persistedPlatformSettings, setPersistedPlatformSettings] = (0, react_1.useState)(null);
    const [logoFile, setLogoFile] = (0, react_1.useState)(null);
    const [logoPreviewUrl, setLogoPreviewUrl] = (0, react_1.useState)(null);
    const [logoError, setLogoError] = (0, react_1.useState)(null);
    const [logoSuccess, setLogoSuccess] = (0, react_1.useState)(null);
    const [logoLoading, setLogoLoading] = (0, react_1.useState)(false);
    // Cleanup object URLs on unmount/replacement
    (0, react_1.useEffect)(() => {
        return () => {
            if (logoPreviewUrl)
                URL.revokeObjectURL(logoPreviewUrl);
        };
    }, [logoPreviewUrl]);
    // 4. Subscribe to canonical GlobalSettingsService changes
    (0, react_1.useEffect)(() => {
        const unsubscribe = globalSettingsService_1.GlobalSettingsService.subscribe((updatedSettings) => {
            setCanonicalSettings(updatedSettings);
        });
        return () => unsubscribe();
    }, []);
    // 4b. Load branding settings on mount
    (0, react_1.useEffect)(() => {
        if (canManageSettings) {
            setLogoLoading(true);
            platformSettingsAdminClient_1.PlatformSettingsAdminClient.get()
                .then(setPersistedPlatformSettings)
                .catch(() => {
                setLogoError(isAr ? 'تعذر الوصول إلى إعدادات الشعار المعتمدة في بيئة التشغيل الحالية.' : 'Canonical branding settings are unavailable in the current environment.');
            })
                .finally(() => setLogoLoading(false));
        }
    }, [canManageSettings, isAr]);
    // 5. Calculate dirty state against current canonical settings
    const isClimateClockDirty = draft.climateClockEnabled !== canonicalSettings.climateClockEnabled;
    const isLanguageDirty = draft.defaultLanguage !== canonicalSettings.defaultLanguage;
    const isDirty = isClimateClockDirty || isLanguageDirty;
    // 6. Check if canonical settings currently equal baseline defaults
    const isAlreadyAtDefaults = (0, react_1.useMemo)(() => {
        return (canonicalSettings.climateClockEnabled === globalSettingsService_1.DEFAULT_GLOBAL_SETTINGS.climateClockEnabled &&
            canonicalSettings.defaultLanguage === globalSettingsService_1.DEFAULT_GLOBAL_SETTINGS.defaultLanguage);
    }, [canonicalSettings]);
    // Handle Save
    const handleSave = () => {
        if (!isDirty)
            return;
        setErrorMessage(null);
        setSuccessMessage(null);
        try {
            const payload = {
                ...(isClimateClockDirty ? { climateClockEnabled: draft.climateClockEnabled } : {}),
                ...(isLanguageDirty ? { defaultLanguage: draft.defaultLanguage } : {}),
            };
            // Canonical service call: handles authorization, validation, atomic state commit & audit recording
            const result = globalSettingsService_1.GlobalSettingsService.updateSettings(payload, currentUser);
            // Reconcile UI with fresh canonical state
            setCanonicalSettings(result.settings);
            setDraft({ ...result.settings });
            const count = result.changes.length;
            if (count > 0) {
                setSuccessMessage(isAr
                    ? `تم حفظ التغييرات وتطبيقها بنجاح على الجلسة الحالية (${count} ${count === 1 ? 'إعداد' : 'إعدادات'}).`
                    : `Successfully saved and applied ${count} setting ${count === 1 ? 'change' : 'changes'} to the running session.`);
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to update settings';
            setErrorMessage(msg);
        }
    };
    // Discard draft and revert to canonical
    const handleDiscardDraft = () => {
        setDraft({ ...canonicalSettings });
        setLogoFile(null);
        if (logoPreviewUrl) {
            URL.revokeObjectURL(logoPreviewUrl);
            setLogoPreviewUrl(null);
        }
        setErrorMessage(null);
    };
    const handleFileChange = (e) => {
        const file = e.target.files?.[0];
        if (!file)
            return;
        setErrorMessage(null);
        const validation = (0, platformBrandingStorageClient_1.validateLogoFile)(file);
        if (!validation.isValid) {
            setErrorMessage(validation.error || 'Invalid file.');
            return;
        }
        if (logoPreviewUrl)
            URL.revokeObjectURL(logoPreviewUrl);
        setLogoFile(file);
        setLogoPreviewUrl(URL.createObjectURL(file));
    };
    const handleSaveLogo = async () => {
        if (!logoFile)
            return;
        setLogoError(null);
        setLogoSuccess(null);
        setLogoLoading(true);
        try {
            // Defect 2: Init only on Save if missing
            let current = await platformSettingsAdminClient_1.PlatformSettingsAdminClient.get();
            if (current === null) {
                const initialized = await platformSettingsAdminClient_1.PlatformSettingsAdminClient.initializeFromDefaults();
                current = initialized.settings;
            }
            const oldStoragePath = current?.identity?.logoStoragePath;
            const uploaded = await (0, platformBrandingStorageClient_1.uploadLogo)(logoFile);
            try {
                const updateResult = await platformSettingsAdminClient_1.PlatformSettingsAdminClient.update({
                    identity: {
                        logoUrl: uploaded.downloadUrl,
                        logoStoragePath: uploaded.storagePath,
                    },
                });
                // Update state
                setPersistedPlatformSettings(updateResult.settings);
                setLogoFile(null);
                if (logoPreviewUrl) {
                    URL.revokeObjectURL(logoPreviewUrl);
                    setLogoPreviewUrl(null);
                }
                // Cleanup old logo if successful and path changed
                if (oldStoragePath && oldStoragePath !== uploaded.storagePath) {
                    try {
                        await (0, platformBrandingStorageClient_1.deleteManagedLogo)(oldStoragePath);
                    }
                    catch (e) {
                        console.error('Failed to delete old logo', e);
                    }
                }
                setLogoSuccess(isAr ? 'تم تحديث الشعار بنجاح.' : 'Logo updated successfully.');
            }
            catch (updateErr) {
                // Defect 3: Cleanup new upload if update fails
                try {
                    await (0, platformBrandingStorageClient_1.deleteManagedLogo)(uploaded.storagePath);
                }
                catch (e) {
                    console.error('Failed to cleanup orphan logo', e);
                }
                throw updateErr;
            }
        }
        catch (err) {
            setLogoError(isAr ? 'فشل تحديث الشعار.' : 'Failed to update logo.');
        }
        finally {
            setLogoLoading(false);
        }
    };
    // Handle Reset to Defaults confirmation
    const handleConfirmReset = () => {
        setIsResetModalOpen(false);
        setErrorMessage(null);
        setSuccessMessage(null);
        try {
            // Canonical service call
            const result = globalSettingsService_1.GlobalSettingsService.resetToDefaults(currentUser);
            setCanonicalSettings(result.settings);
            setDraft({ ...result.settings });
            if (result.changes.length > 0) {
                setSuccessMessage(isAr
                    ? 'تمت استعادة الإعدادات الافتراضية المعتمدة للمنصة بنجاح وتوثيقها في سجل التدقيق.'
                    : 'Canonical platform defaults successfully restored and audited.');
            }
            else {
                setSuccessMessage(isAr
                    ? 'الإعدادات مطابقة بالفعل للتكوين الأساسي المعتمد. لم تطرأ أي تغييرات.'
                    : 'Settings were already identical to canonical defaults. No state change occurred.');
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to reset settings';
            setErrorMessage(msg);
        }
    };
    // Unauthorized Fallback Screen
    if (!canManageSettings) {
        return (<div className="p-6 sm:p-8 bg-white dark:bg-gray-900 rounded-3xl border border-rose-200 dark:border-rose-900/60 shadow-xs space-y-4 max-w-2xl mx-auto my-8 text-center" id="settings-access-restricted">
        <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 flex items-center justify-center mx-auto">
          <lucide_react_1.ShieldAlert className="w-6 h-6"/>
        </div>
        <div className="space-y-1">
          <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100">
            {isAr ? 'صلاحية إدارة الإعدادات العامة مقيدة' : 'Global Settings Access Restricted'}
          </h3>
          <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 max-w-md mx-auto leading-relaxed">
            {isAr
                ? `تتطلب إدارة الإعدادات العامة للمنصة صلاحية (${admin_1.AdminPermission.ManageSettings}). دورك الحالي (${currentUser.role}) لا يمتلك هذا الترخيص.`
                : `Managing global platform settings requires the (${admin_1.AdminPermission.ManageSettings}) permission. Your current role is (${currentUser.role}).`}
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-[11px] font-semibold text-gray-600 dark:text-gray-300">
          <lucide_react_1.Lock className="w-3.5 h-3.5"/>
          <span>{isAr ? 'منطقة إدارية محمية بقواعد RBAC' : 'RBAC Protected Boundary'}</span>
        </div>
      </div>);
    }
    return (<div className="space-y-6 max-w-4xl min-w-0" id="admin-global-settings">
      {/* 1. Module Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 pb-4 border-b border-gray-200/80 dark:border-gray-800 min-w-0" id="settings-module-header">
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <div className="p-2.5 rounded-2xl bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-400 border border-emerald-200/50 shrink-0">
            <lucide_react_1.Settings className="w-6 h-6"/>
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
          <button type="button" onClick={() => setIsResetModalOpen(true)} className="px-3.5 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-amber-600 dark:hover:text-amber-400 transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs min-h-[44px]" id="reset-defaults-btn" title={isAr ? 'استعادة التكوين الأساسي الافتراضي' : 'Restore canonical baseline defaults'}>
            <lucide_react_1.RotateCcw className="w-3.5 h-3.5 text-gray-500 group-hover:text-amber-600"/>
            <span>{isAr ? 'استعادة الافتراضيات' : 'Reset to Defaults'}</span>
          </button>
        </div>
      </div>

      {/* 2. Persistence Reality Disclosure (Honest & Unobtrusive) */}
      <div className="p-3.5 sm:p-4 rounded-2xl bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200/80 dark:border-sky-900/50 flex items-start gap-3 text-start min-w-0" id="settings-persistence-disclosure">
        <div className="p-1.5 rounded-lg bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300 shrink-0 mt-0.5">
          <lucide_react_1.Info className="w-4 h-4"/>
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
      {successMessage && (<div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 flex items-center justify-between gap-3 text-start animate-in fade-in duration-150" id="settings-success-banner">
          <div className="flex items-center gap-2.5 min-w-0">
            <lucide_react_1.CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0"/>
            <p className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">
              {successMessage}
            </p>
          </div>
          <button type="button" onClick={() => setSuccessMessage(null)} className="text-emerald-700 hover:text-emerald-900 dark:text-emerald-400 text-xs font-bold px-2 py-1 cursor-pointer">
            {isAr ? 'إغلاق' : 'Dismiss'}
          </button>
        </div>)}

      {errorMessage && (<div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/80 flex items-center justify-between gap-3 text-start animate-in fade-in duration-150" id="settings-error-banner">
          <div className="flex items-center gap-2.5 min-w-0">
            <lucide_react_1.AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0"/>
            <p className="text-xs font-semibold text-rose-900 dark:text-rose-200">
              {errorMessage}
            </p>
          </div>
          <button type="button" onClick={() => setErrorMessage(null)} className="text-rose-700 hover:text-rose-900 dark:text-rose-400 text-xs font-bold px-2 py-1 cursor-pointer">
            {isAr ? 'إغلاق' : 'Dismiss'}
          </button>
        </div>)}

      {/* 4. Identity & Branding Shell */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2 px-1">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {isAr ? 'الهوية والعلامة التجارية' : 'Identity & Branding'}
          </h3>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200/80 dark:border-gray-800 p-5 sm:p-6 shadow-xs space-y-4 text-start">
          {/* Branding Error/Success - New */}
          {(logoError || logoSuccess) && (<div className={`p-3 rounded-xl border text-xs ${logoError ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200' : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'}`}>
                {logoError || logoSuccess}
            </div>)}
          <div className="flex items-start gap-4">
            <div className="h-16 w-16 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex items-center justify-center text-[10px] text-center text-gray-500 overflow-hidden">
              {logoPreviewUrl ? (<img src={logoPreviewUrl} alt="Logo preview" className="h-full w-full object-cover"/>) : persistedPlatformSettings?.identity?.logoStoragePath ? (<img src={persistedPlatformSettings.identity.logoStoragePath} alt="Current logo" className="h-full w-full object-cover"/>) : (isAr ? 'وعد الكوكب' : 'Promise of Planet')}
            </div>
            <div className="space-y-3 flex-1">
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {isAr
            ? 'اختر شعاراً بصيغة PNG أو WebP (بحد أقصى 2 ميجابايت) لتحديث هوية المنصة.'
            : 'Select a PNG or WebP logo (max 2MB) to update the platform identity.'}
              </p>

              <div className="flex items-center gap-2">
                <input type="file" accept="image/png,image/webp" onChange={handleFileChange} className="hidden" id="logo-file-input"/>
                <label htmlFor="logo-file-input" className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer shadow-xs">
                  {isAr ? 'اختيار الشعار' : 'Choose Logo'}
                </label>
                <button type="button" onClick={handleSaveLogo} disabled={!logoFile || logoLoading} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${logoFile && !logoLoading
            ? 'bg-emerald-600 text-white hover:bg-emerald-700'
            : 'bg-gray-200 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed'}`}>
                  {logoLoading ? (isAr ? 'جاري الحفظ...' : 'Saving...') : (isAr ? 'حفظ الشعار' : 'Save Logo')}
                </button>
              </div>
              <p className="text-[10px] text-gray-400 dark:text-gray-500">
                PNG / WebP • Max 2 MB
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Platform Experience Section (Canonical 2 Settings Only) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2 px-1">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {isAr ? 'تجربة المنصة والخصائص المعمول بها' : 'Platform Experience & Behavior'}
          </h3>
          {isAlreadyAtDefaults && (<span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-md">
              {isAr ? 'القيم الافتراضية مفعّلة' : 'Default Values Active'}
            </span>)}
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200/80 dark:border-gray-800 p-5 sm:p-6 shadow-xs space-y-6 text-start">
          {/* Setting 1: climateClockEnabled */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-gray-100 dark:border-gray-800/80" id="setting-row-climate-clock">
            <div className="space-y-1.5 max-w-xl min-w-0">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60 shrink-0">
                  <lucide_react_1.Clock className="w-4 h-4"/>
                </div>
                <label htmlFor="climate-clock-toggle" className="text-sm font-bold text-gray-900 dark:text-gray-100 cursor-pointer" id="climate-clock-label">
                  {isAr ? 'عرض شريط ساعة المناخ الرسمية' : 'Official Climate Clock Display'}
                </label>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${draft.climateClockEnabled
            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700'}`}>
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
              <button type="button" role="switch" aria-checked={draft.climateClockEnabled} aria-labelledby="climate-clock-label" onClick={() => setDraft((prev) => ({
            ...prev,
            climateClockEnabled: !prev.climateClockEnabled,
        }))} className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 ${draft.climateClockEnabled
            ? 'bg-emerald-600 dark:bg-emerald-500'
            : 'bg-gray-300 dark:bg-gray-700'}`} id="climate-clock-toggle">
                <span className="sr-only">
                  {isAr ? 'تبديل تفعيل ساعة المناخ' : 'Toggle Climate Clock'}
                </span>
                <span aria-hidden="true" className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${draft.climateClockEnabled
            ? isAr
                ? '-translate-x-5'
                : 'translate-x-5'
            : 'translate-x-0'}`}/>
              </button>
            </div>
          </div>

          {/* Setting 2: defaultLanguage */}
          <div className="space-y-3" id="setting-row-default-language">
            <div className="space-y-1.5 max-w-xl min-w-0">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-400 border border-sky-200/60 dark:border-sky-800/60 shrink-0">
                  <lucide_react_1.Globe className="w-4 h-4"/>
                </div>
                <label htmlFor="default-language-select" className="text-sm font-bold text-gray-900 dark:text-gray-100" id="default-language-label">
                  {isAr ? 'لغة المنصة الافتراضية' : 'Default Platform Language'}
                </label>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 border border-sky-300 dark:border-sky-800 shrink-0">
                  {(draft.defaultLanguage || 'ar').toUpperCase()}
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
              <button type="button" onClick={() => setDraft((prev) => ({ ...prev, defaultLanguage: 'ar' }))} className={`p-3.5 rounded-2xl border text-start transition-all cursor-pointer flex items-center justify-between gap-3 min-h-[48px] ${draft.defaultLanguage === 'ar'
            ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/40 text-gray-900 dark:text-gray-100 ring-1 ring-emerald-500'
            : 'border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/40 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'}`} id="select-lang-ar-btn">
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
                <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${draft.defaultLanguage === 'ar'
            ? 'border-emerald-600 bg-emerald-600 text-white'
            : 'border-gray-400'}`}>
                  {draft.defaultLanguage === 'ar' && (<div className="w-1.5 h-1.5 rounded-full bg-white"/>)}
                </div>
              </button>

              {/* Option: English */}
              <button type="button" onClick={() => setDraft((prev) => ({ ...prev, defaultLanguage: 'en' }))} className={`p-3.5 rounded-2xl border text-start transition-all cursor-pointer flex items-center justify-between gap-3 min-h-[48px] ${draft.defaultLanguage === 'en'
            ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/40 text-gray-900 dark:text-gray-100 ring-1 ring-emerald-500'
            : 'border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/40 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'}`} id="select-lang-en-btn">
                <div className="space-y-0.5 min-w-0">
                  <div className="text-xs font-bold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                    <span>English</span>
                    <span className="text-[10px] text-gray-500 font-normal">(الإنجليزية - en)</span>
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">
                    {isAr ? 'اللغة البديلة للمحتوى والترجمة' : 'Secondary language for global readers'}
                  </div>
                </div>
                <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${draft.defaultLanguage === 'en'
            ? 'border-emerald-600 bg-emerald-600 text-white'
            : 'border-gray-400'}`}>
                  {draft.defaultLanguage === 'en' && (<div className="w-1.5 h-1.5 rounded-full bg-white"/>)}
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 5. Save & Draft Synchronization Bar */}
      <div className={`p-4 rounded-2xl border transition-all duration-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${isDirty
            ? 'bg-amber-50/60 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800 shadow-sm'
            : 'bg-gray-50 dark:bg-gray-900/60 border-gray-200 dark:border-gray-800'}`} id="settings-action-bar">
        {/* Status indicator */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${isDirty ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`}/>
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
            {isDirty && (<span className="text-[11px] text-gray-500 dark:text-gray-400 block truncate">
                {isClimateClockDirty && (<span className="me-2">
                    {isAr ? 'ساعة المناخ:' : 'Clock:'}{' '}
                    {canonicalSettings.climateClockEnabled ? 'On' : 'Off'} →{' '}
                    {draft.climateClockEnabled ? 'On' : 'Off'}
                  </span>)}
                {isLanguageDirty && (<span>
                    {isAr ? 'اللغة الافتراضية:' : 'Language:'}{' '}
                    {canonicalSettings.defaultLanguage} → {draft.defaultLanguage}
                  </span>)}
              </span>)}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
          {isDirty && (<button type="button" onClick={handleDiscardDraft} className="px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-1.5 cursor-pointer min-h-[44px]" id="discard-draft-btn">
              <lucide_react_1.Undo2 className="w-3.5 h-3.5 text-gray-500"/>
              <span>{isAr ? 'تراجع' : 'Discard Draft'}</span>
            </button>)}

          <button type="button" onClick={handleSave} disabled={!isDirty} className={`px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs transition-all cursor-pointer min-h-[44px] ${isDirty
            ? 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white'
            : 'bg-gray-200 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed'}`} id="save-settings-btn">
            <lucide_react_1.Save className="w-3.5 h-3.5"/>
            <span>{isAr ? 'حفظ التغييرات' : 'Save Changes'}</span>
          </button>
        </div>
      </div>

      {/* 6. Reset Confirmation Modal */}
      <ResetDefaultsConfirmModal_1.ResetDefaultsConfirmModal isOpen={isResetModalOpen} onClose={() => setIsResetModalOpen(false)} onConfirm={handleConfirmReset} isAlreadyDefault={isAlreadyAtDefaults}/>
    </div>);
};
exports.AdminGlobalSettings = AdminGlobalSettings;
//# sourceMappingURL=AdminGlobalSettings.js.map