import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  Upload,
  MapPin,
  Send,
  AlertCircle,
  FileText,
  User,
  Phone,
  FolderKanban,
  CheckCircle2,
  X,
  Paperclip,
  LogOut,
  ShieldAlert,
} from 'lucide-react';
import { Container } from '../layout/Container';
import { AccountAuthWidget } from '../auth/AccountAuthWidget';
import { AccountService } from '../../services/accountService';
import type { Account } from '../../types/account';
import {
  CANONICAL_COMMUNITY_CATEGORIES,
  type CitizenSubmission,
} from '../../types/community';
import { getCommunityCategoryLabel } from '../content/contentFormatters';
import {
  CitizenSubmissionService,
  validateEvidenceFile,
  MAX_EVIDENCE_FILES,
  type EvidenceFileInput,
} from '../../services/citizenSubmissionService';
import { isFirebaseConfigured, isFirebaseStorageConfigured } from '../../services/firebase';

export function PublicCitizenJournalist() {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  // Real Account & Auth state
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [showAuthForm, setShowAuthForm] = useState(false);

  // Submission Form state (adapted from historical CitizenJournalism.tsx + canonical category)
  const [reportForm, setReportForm] = useState({
    name: '',
    contact: '',
    category: 'water',
    title: '',
    text: '',
    location: '',
  });
  const [selectedFiles, setSelectedFiles] = useState<EvidenceFileInput[]>([]);
  const [fileValidationError, setFileValidationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [submitErrorMsg, setSubmitErrorMsg] = useState<string | null>(null);
  const [lastCreatedSubmission, setLastCreatedSubmission] = useState<CitizenSubmission | null>(null);

  useEffect(() => {
    const unsubscribe = AccountService.observeAuthState(async (user) => {
      setFirebaseUser(user);
      setAccountError(null);

      if (user) {
        try {
          let acc = await AccountService.getAccount(user.uid);
          if (!acc) {
            // Attempt to provision the missing canonical profile for this authenticated user
            try {
              acc = await AccountService.createAccountForUser(
                user,
                user.displayName || user.email?.split('@')[0] || undefined
              );
            } catch (provErr: any) {
              console.warn('Initial account profile provisioning attempt:', provErr);
            }
          }

          if (acc && acc.id === user.uid) {
            setAccount(acc);
            setAccountError(null);
            setReportForm((prev) => ({
              ...prev,
              name: prev.name || acc.displayName || '',
              contact: prev.contact || acc.email || user.email || '',
            }));
          } else {
            setAccount(null);
            setAccountError(
              isAr
                ? 'تعذر التحقق من ملف الحساب الأساسي في قاعدة البيانات. لا يمكن إرسال البلاغات قبل اكتمال تهيئة الحساب.'
                : 'Canonical platform account profile is missing or unprovisioned. Submissions are blocked until account provisioning succeeds.'
            );
          }
        } catch (err: any) {
          setAccount(null);
          setAccountError(
            err?.message ||
              (isAr
                ? 'فشل التحقق من ملف الحساب في المنصة.'
                : 'Failed to verify canonical platform account profile.')
          );
        }
      } else {
        setAccount(null);
      }
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, [isAr]);

  const handleRetryProvisionAccount = async () => {
    if (!firebaseUser) return;
    setAuthLoading(true);
    setAccountError(null);
    try {
      let created: Account | null = null;
      try {
        created = await AccountService.createAccountForUser(
          firebaseUser,
          firebaseUser.displayName || undefined
        );
      } catch (err: any) {
        // If the document already exists, retrieve it
        created = await AccountService.getAccount(firebaseUser.uid);
        if (!created) throw err;
      }

      setAccount(created);
      setAccountError(null);
      setReportForm((prev) => ({
        ...prev,
        name: prev.name || created.displayName || '',
        contact: prev.contact || created.email || '',
      }));
    } catch (err: any) {
      setAccountError(
        err?.message ||
          (isAr
            ? 'فشل إنشاء ملف الحساب الأساسي. يرجى المحاولة لاحقاً.'
            : 'Account profile provisioning failed. Submission remains unavailable.')
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    await AccountService.signOut();
    setAccount(null);
    setSubmitStatus('idle');
    setSubmitErrorMsg(null);
    setLastCreatedSubmission(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileValidationError(null);
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const incoming: EvidenceFileInput[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      const check = validateEvidenceFile({ name: f.name, type: f.type, size: f.size, file: f });
      if (!check.valid) {
        setFileValidationError(check.error || (isAr ? 'ملف غير صالح' : 'Invalid file'));
        e.target.value = '';
        return;
      }
      incoming.push({
        name: f.name,
        type: f.type,
        size: f.size,
        file: f,
      });
    }

    if (selectedFiles.length + incoming.length > MAX_EVIDENCE_FILES) {
      setFileValidationError(
        isAr
          ? `الحد الأقصى للمرفقات هو ${MAX_EVIDENCE_FILES} ملفات لكل بلاغ.`
          : `Maximum ${MAX_EVIDENCE_FILES} attachments allowed per report.`
      );
      e.target.value = '';
      return;
    }

    setSelectedFiles((prev) => [...prev, ...incoming]);
    e.target.value = '';
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    setFileValidationError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitErrorMsg(null);
    setFileValidationError(null);

    if (!firebaseUser || !account) {
      setSubmitStatus('error');
      setSubmitErrorMsg(
        isAr
          ? 'يجب تسجيل الدخول بحساب منصة موثق قبل إرسال البلاغ.'
          : 'You must be signed in with a provisioned platform account to submit a report.'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await CitizenSubmissionService.submitReport({
        contributorName: reportForm.name,
        contributorContact: reportForm.contact,
        category: reportForm.category,
        title: reportForm.title,
        body: reportForm.text,
        sourceLanguage: isAr ? 'ar' : 'en',
        locationDescription: reportForm.location,
        evidenceFiles: selectedFiles,
      });

      setLastCreatedSubmission(created);
      setSubmitStatus('success');
      setReportForm({
        name: account.displayName || '',
        contact: account.email || firebaseUser.email || '',
        category: 'water',
        title: '',
        text: '',
        location: '',
      });
      setSelectedFiles([]);
    } catch (err: any) {
      setSubmitStatus('error');
      setSubmitErrorMsg(
        err?.message ||
          (isAr
            ? 'تعذر حفظ البلاغ في الخادم. يرجى التحقق من البيانات والمحاولة مجدداً.'
            : 'Failed to submit report to the backend. Please verify your input and try again.')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const isAuthenticatedWithValidAccount = Boolean(firebaseUser && account && !accountError);

  return (
    <div
      id="citizen-journalist-page"
      className="bg-gray-50/50 dark:bg-gray-950 min-h-screen py-10 sm:py-16 pop-page-fade"
      dir={isAr ? 'rtl' : 'ltr'}
    >
      <Container className="max-w-4xl">
        {/* Page Introduction (Visible to all visitors) */}
        <div className="text-center mb-12 px-4 space-y-4">
          <div className="text-xs font-extrabold text-emerald-700 dark:text-emerald-400 uppercase tracking-widest">
            {isAr ? 'شبكة الرصد البيئي المجتمعي' : 'Community Environmental Reporting Network'}
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold text-gray-900 dark:text-white leading-tight">
            {isAr ? 'المواطن الصحفي' : 'Citizen Journalist'}
          </h1>
          <p className="text-base sm:text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto font-medium leading-relaxed">
            {isAr
              ? 'ساهم في توثيق الأوضاع البيئية، رصد التغيرات المناخية، والإبلاغ عن التحديات الميدانية المتعلقة بالمياه والتصحر والتنوع الحيوي في منطقتك ليتم تدقيقها من قبل فريق التحرير.'
              : 'Contribute to documenting environmental conditions, climate impacts, and field observations on water, desertification, and biodiversity for editorial verification by our journalism team.'}
          </p>
        </div>

        {authLoading ? (
          <div className="bg-white dark:bg-gray-900 rounded-3xl p-10 shadow-sm border border-gray-200 dark:border-gray-800 text-center text-sm text-gray-500">
            {isAr ? 'جاري التحقق من حالة حساب المراسل...' : 'Verifying reporter account state...'}
          </div>
        ) : !isFirebaseConfigured ? (
          <div
            id="citizen-journalist-auth-gate"
            className="bg-emerald-950 text-white p-8 sm:p-12 rounded-3xl shadow-xl text-center space-y-6 border border-emerald-900"
          >
            <User className="w-14 h-14 mx-auto text-emerald-400" />
            <h2 className="text-2xl sm:text-3xl font-extrabold">
              {isAr ? 'انضم لشبكة المراسلين' : 'Join Our Reporter Network'}
            </h2>
            <p className="text-emerald-100/80 max-w-lg mx-auto text-sm sm:text-base leading-relaxed">
              {isAr
                ? 'يتطلب إرسال التقارير الميدانية تسجيل الدخول بحساب منصة موثق. خدمة المصادقة السحابية غير مفعلة في بيئة العرض الحالية.'
                : 'Submitting field reports requires an authenticated platform account. Cloud authentication is currently unconfigured in this preview environment.'}
            </p>
            <div className="max-w-md mx-auto text-start">
              <AccountAuthWidget isAr={isAr} />
            </div>
          </div>
        ) : !firebaseUser ? (
          /* Unauthenticated Gate: Matches legacy CitizenJournalism visual prompt + real AccountAuthWidget */
          <div
            id="citizen-journalist-auth-gate"
            className="bg-emerald-950 text-white p-8 sm:p-12 rounded-3xl shadow-xl text-center relative overflow-hidden space-y-8 border border-emerald-900"
          >
            <div className="relative z-10 space-y-4">
              <User className="w-14 h-14 mx-auto text-emerald-400" />
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white">
                {isAr ? 'انضم لشبكة المراسلين' : 'Join Our Reporter Network'}
              </h2>
              <p className="text-emerald-100/80 text-sm sm:text-base font-medium max-w-lg mx-auto leading-relaxed">
                {isAr
                  ? 'يرجى تسجيل الدخول أو إنشاء حساب منصة لتتمكن من إرسال التقارير الميدانية والمساهمة في توثيق الأوضاع البيئية.'
                  : 'Please sign in or register a platform account to submit field reports and help document environmental conditions.'}
              </p>

              {!showAuthForm && (
                <div className="pt-2">
                  <button
                    type="button"
                    id="citizen-journalist-open-auth-btn"
                    onClick={() => setShowAuthForm(true)}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-8 py-3.5 rounded-xl font-bold text-base transition-all shadow-lg cursor-pointer"
                  >
                    {isAr ? 'تسجيل الدخول / إنشاء حساب' : 'Sign In / Create Account'}
                  </button>
                </div>
              )}
            </div>

            {showAuthForm && (
              <div className="relative z-10 pt-2 text-start">
                <AccountAuthWidget isAr={isAr} />
              </div>
            )}
          </div>
        ) : !isAuthenticatedWithValidAccount ? (
          /* Authenticated in Firebase Auth, but canonical Account provisioning failed or missing */
          <div
            id="citizen-journalist-account-error"
            className="bg-white dark:bg-gray-900 rounded-3xl p-8 sm:p-10 shadow-lg border border-red-200 dark:border-red-900/60 space-y-5 text-center"
          >
            <ShieldAlert className="w-12 h-12 text-red-600 mx-auto" />
            <h2 className="text-xl sm:text-2xl font-extrabold text-gray-900 dark:text-white">
              {isAr ? 'لم يكتمل تجهيز ملف الحساب' : 'Account Profile Provisioning Incomplete'}
            </h2>
            <p className="text-sm text-red-700 dark:text-red-300 max-w-lg mx-auto leading-relaxed">
              {accountError}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleRetryProvisionAccount}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold cursor-pointer"
              >
                {isAr ? 'إعادة محاولة تهيئة الحساب' : 'Retry Account Provisioning'}
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                className="px-5 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 text-gray-700 dark:text-gray-300 text-xs sm:text-sm font-bold cursor-pointer"
              >
                {isAr ? 'تسجيل الخروج' : 'Sign Out'}
              </button>
            </div>
          </div>
        ) : (
          /* Authenticated & Provisioned Account: Citizen Journalist Submission Form */
          <div className="bg-white dark:bg-gray-900 rounded-3xl p-6 sm:p-10 shadow-xl border border-gray-200/80 dark:border-gray-800 space-y-8">
            {/* Authenticated Reporter Identity Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 flex items-center justify-center font-extrabold text-sm">
                  {(account?.displayName || firebaseUser.email || 'U')[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-xs sm:text-sm font-bold text-gray-900 dark:text-white">
                    {account?.displayName || firebaseUser.email}
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    {isAr ? 'حساب مراسل موثق' : 'Verified Reporter Account'} · {firebaseUser.email}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-bold transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{isAr ? 'تسجيل الخروج' : 'Sign Out'}</span>
              </button>
            </div>

            {submitStatus === 'success' && lastCreatedSubmission ? (
              <div id="citizen-submission-success" className="text-center py-10 space-y-5">
                <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950/80 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle2 className="text-emerald-600 dark:text-emerald-400 w-9 h-9" />
                </div>
                <h3 className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white">
                  {isAr ? 'تم استلام بلاغك الميداني بنجاح' : 'Field Report Received Successfully'}
                </h3>
                <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300 max-w-lg mx-auto leading-relaxed">
                  {isAr
                    ? 'تم حفظ بلاغك في سجل المراجعة التحريرية بحالة "مستلم جديد" وسيتم تدقيقه من قبل فريق الإشراف التحريري.'
                    : 'Your report has been durably recorded with status "Received" and queued for human editorial review.'}
                </p>
                <div className="inline-block px-4 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 text-xs font-mono text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
                  ID: {lastCreatedSubmission.id} · Status: {lastCreatedSubmission.status}
                </div>
                <div className="pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setSubmitStatus('idle');
                      setLastCreatedSubmission(null);
                    }}
                    className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm transition-colors cursor-pointer"
                  >
                    {isAr ? 'إرسال تقرير ميداني آخر' : 'Submit Another Field Report'}
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {submitErrorMsg && (
                  <div
                    id="citizen-submission-error"
                    className="md:col-span-2 p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60 text-xs sm:text-sm text-red-700 dark:text-red-300 flex items-start gap-2.5"
                  >
                    <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                    <span>{submitErrorMsg}</span>
                  </div>
                )}

                {/* Contributor Name */}
                <div className="space-y-2">
                  <label className="text-xs font-extrabold text-gray-600 dark:text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{isAr ? 'اسم المساهم / المراسل' : 'Contributor Name'}</span>
                  </label>
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={150}
                    placeholder={isAr ? 'الاسم الكامل...' : 'Full name...'}
                    className="w-full p-3.5 bg-gray-50 dark:bg-gray-800/70 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 rounded-xl transition-all text-sm font-medium text-gray-900 dark:text-white outline-none"
                    value={reportForm.name}
                    onChange={(e) => setReportForm({ ...reportForm, name: e.target.value })}
                  />
                </div>

                {/* Contact Details */}
                <div className="space-y-2">
                  <label className="text-xs font-extrabold text-gray-600 dark:text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{isAr ? 'وسيلة التواصل (هاتف أو بريد)' : 'Contact Details (Phone or Email)'}</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={isAr ? 'رقم الهاتف أو البريد الإلكتروني...' : 'Phone number or Email...'}
                    className="w-full p-3.5 bg-gray-50 dark:bg-gray-800/70 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 rounded-xl transition-all text-sm font-medium text-gray-900 dark:text-white outline-none"
                    value={reportForm.contact}
                    onChange={(e) => setReportForm({ ...reportForm, contact: e.target.value })}
                  />
                </div>

                {/* Canonical Environmental Category */}
                <div className="space-y-2">
                  <label className="text-xs font-extrabold text-gray-600 dark:text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                    <FolderKanban className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{isAr ? 'التصنيف البيئي' : 'Environmental Category'}</span>
                  </label>
                  <select
                    required
                    value={reportForm.category}
                    onChange={(e) => setReportForm({ ...reportForm, category: e.target.value })}
                    className="w-full p-3.5 bg-gray-50 dark:bg-gray-800/70 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 rounded-xl transition-all text-sm font-medium text-gray-900 dark:text-white outline-none cursor-pointer"
                  >
                    {CANONICAL_COMMUNITY_CATEGORIES.map((catKey) => (
                      <option key={catKey} value={catKey}>
                        {getCommunityCategoryLabel(catKey, isAr)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Textual Location Description (No Map / GIS) */}
                <div className="space-y-2">
                  <label className="text-xs font-extrabold text-gray-600 dark:text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{isAr ? 'وصف الموقع الجغرافي (نصي)' : 'Location Description (Textual)'}</span>
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={500}
                    placeholder={isAr ? 'الولاية، المدينة، المنطقة...' : 'State, city, locality...'}
                    className="w-full p-3.5 bg-gray-50 dark:bg-gray-800/70 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 rounded-xl transition-all text-sm font-medium text-gray-900 dark:text-white outline-none"
                    value={reportForm.location}
                    onChange={(e) => setReportForm({ ...reportForm, location: e.target.value })}
                  />
                </div>

                {/* Report Title */}
                <div className="md:col-span-2 space-y-2">
                  <label className="text-xs font-extrabold text-gray-600 dark:text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{isAr ? 'عنوان التقرير أو البلاغ الميداني' : 'Report Title'}</span>
                  </label>
                  <input
                    type="text"
                    required
                    minLength={5}
                    maxLength={300}
                    placeholder={isAr ? 'عنوان موجز يوضح موضوع الرصد البيئي...' : 'Concise title describing the environmental report...'}
                    className="w-full p-3.5 bg-gray-50 dark:bg-gray-800/70 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 rounded-xl transition-all text-sm font-medium text-gray-900 dark:text-white outline-none"
                    value={reportForm.title}
                    onChange={(e) => setReportForm({ ...reportForm, title: e.target.value })}
                  />
                </div>

                {/* Detailed Report Description */}
                <div className="md:col-span-2 space-y-2">
                  <label className="text-xs font-extrabold text-gray-600 dark:text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{isAr ? 'تفاصيل الرصد والمشاهدات الميدانية' : 'Detailed Incident / Observation Description'}</span>
                  </label>
                  <textarea
                    required
                    minLength={15}
                    maxLength={10000}
                    rows={6}
                    placeholder={
                      isAr
                        ? 'اكتب تفاصيل ما تم رصده، توقيت الملاحظة، والآثار البيئية أو المجتمعية المشاهدة...'
                        : 'Describe the observed environmental conditions, timing, and local impacts in detail...'
                    }
                    className="w-full p-3.5 bg-gray-50 dark:bg-gray-800/70 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 rounded-xl transition-all text-sm font-medium text-gray-900 dark:text-white outline-none resize-none"
                    value={reportForm.text}
                    onChange={(e) => setReportForm({ ...reportForm, text: e.target.value })}
                  />
                </div>

                {/* Supporting Evidence Attachments */}
                <div className="md:col-span-2 space-y-3">
                  <label className="text-xs font-extrabold text-gray-600 dark:text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Upload className="w-3.5 h-3.5 text-emerald-600" />
                    <span>
                      {isAr
                        ? 'المرفقات والأدلة الداعمة (صور، فيديو، صوت، أو PDF — اختياري، بحد أقصى 15 ميجابايت للملف)'
                        : 'Supporting Evidence Attachments (Photos, Video, Audio, or PDF — Optional, max 15 MB per file)'}
                    </span>
                  </label>

                  <div className="relative group cursor-pointer">
                    <input
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/wav,audio/ogg,application/pdf"
                      onChange={handleFileChange}
                      className="absolute inset-0 opacity-0 cursor-pointer z-10"
                    />
                    <div className="w-full p-4 bg-gray-50 dark:bg-gray-800/40 border-2 border-dashed border-gray-300 dark:border-gray-700 group-hover:border-emerald-500 rounded-xl transition-all flex items-center justify-center gap-3 text-gray-600 dark:text-gray-300 text-xs sm:text-sm font-semibold">
                      <Upload className="w-5 h-5 text-emerald-600" />
                      <span>
                        {isAr
                          ? 'اضغط لاختيار ملفات الأدلة الميدانية (JPG, PNG, WEBP, MP4, PDF)'
                          : 'Click to select field evidence files (JPG, PNG, WEBP, MP4, PDF)'}
                      </span>
                    </div>
                  </div>

                  {!isFirebaseStorageConfigured && selectedFiles.length > 0 && (
                    <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
                      {isAr
                        ? 'تنبيه: خدمة تخزين الملفات (Firebase Storage) غير مفعلة حالياً؛ سيرفض النظام إرسال المرفقات لمنع أي محاكاة وهمية للرفع.'
                        : 'Notice: Firebase Storage is not configured; submitting with attachments will fail-closed rather than simulate uploads.'}
                    </div>
                  )}

                  {fileValidationError && (
                    <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60 text-xs text-red-700 dark:text-red-300">
                      {fileValidationError}
                    </div>
                  )}

                  {selectedFiles.length > 0 && (
                    <div className="space-y-2 pt-1">
                      {selectedFiles.map((f, index) => (
                        <div
                          key={`${f.name}-${index}`}
                          className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Paperclip className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span className="font-bold text-gray-800 dark:text-gray-200 truncate">{f.name}</span>
                            <span className="text-gray-400 shrink-0">
                              ({(f.size / (1024 * 1024)).toFixed(2)} MB)
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveFile(index)}
                            className="p-1 text-gray-400 hover:text-red-600 transition-colors cursor-pointer"
                            aria-label={isAr ? 'إزالة المرفق' : 'Remove attachment'}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Submit Button */}
                <div className="md:col-span-2 pt-4">
                  <button
                    type="submit"
                    id="citizen-report-submit-btn"
                    disabled={isSubmitting}
                    className="w-full bg-emerald-700 hover:bg-emerald-600 text-white p-4 rounded-2xl font-extrabold text-base sm:text-lg flex items-center justify-center gap-3 transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {isSubmitting ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <Send className={`w-5 h-5 ${isAr ? '-scale-x-100' : ''}`} />
                        <span>{isAr ? 'إرسال التقرير للمراجعة التحريرية' : 'Submit Report for Editorial Review'}</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </Container>
    </div>
  );
}
