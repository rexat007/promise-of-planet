import React, { useState, useEffect, useRef } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  Mail,
  Lock,
  User as UserIcon,
  LogOut,
  LogIn,
  UserPlus,
  AlertCircle,
  CheckCircle2,
  ShieldAlert,
  RefreshCw,
  KeyRound,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import {
  AccountService,
  AccountError,
  NEUTRAL_PASSWORD_RESET_MESSAGES,
} from '../../services/accountService';
import { isFirebaseConfigured } from '../../services/firebase';
import type { Account } from '../../types/account';

export const INCOMPLETE_ACCOUNT_SETUP_MESSAGES = {
  ar: 'تم تسجيل الدخول، لكن إعداد ملف الحساب لم يكتمل.',
  en: 'You are signed in, but your account profile setup is incomplete.',
} as const;

export const FORGOT_PASSWORD_ACTION_LABELS = {
  ar: 'نسيت كلمة المرور؟',
  en: 'Forgot password?',
} as const;

export const EMAIL_VERIFICATION_UI_LABELS = {
  unverifiedBadge: {
    ar: 'البريد الإلكتروني غير مؤكد',
    en: 'Email not verified',
  },
  verifiedBadge: {
    ar: 'البريد الإلكتروني مؤكد',
    en: 'Email verified',
  },
  sendAction: {
    ar: 'إرسال رسالة التحقق',
    en: 'Send verification email',
  },
  refreshAction: {
    ar: 'لقد أكدت بريدي الإلكتروني — تحديث الحالة',
    en: "I've verified my email — Refresh status",
  },
} as const;

export interface AccountEmailVerificationSectionProps {
  emailVerified: boolean;
  isAr?: boolean;
  sendingVerification?: boolean;
  refreshingVerification?: boolean;
  onSendVerification: () => void;
  onRefreshVerification: () => void;
}

export function AccountEmailVerificationSection({
  emailVerified,
  isAr = false,
  sendingVerification = false,
  refreshingVerification = false,
  onSendVerification,
  onRefreshVerification,
}: AccountEmailVerificationSectionProps) {
  const isBusy = sendingVerification || refreshingVerification;

  if (emailVerified) {
    return (
      <div
        data-testid="email-verification-verified"
        className="p-2.5 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-900/50 rounded-xl flex items-center justify-between gap-2 text-xs text-emerald-800 dark:text-emerald-300"
      >
        <div className="flex items-center gap-1.5 font-bold">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>
            {isAr
              ? EMAIL_VERIFICATION_UI_LABELS.verifiedBadge.ar
              : EMAIL_VERIFICATION_UI_LABELS.verifiedBadge.en}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="email-verification-unverified"
      className="p-3 bg-amber-50/80 dark:bg-amber-950/25 border border-amber-200 dark:border-amber-900/50 rounded-xl space-y-2.5 text-xs text-amber-900 dark:text-amber-200"
    >
      <div className="flex items-center gap-1.5 font-bold">
        <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
        <span>
          {isAr
            ? EMAIL_VERIFICATION_UI_LABELS.unverifiedBadge.ar
            : EMAIL_VERIFICATION_UI_LABELS.unverifiedBadge.en}
        </span>
      </div>

      <p className="text-[11px] text-amber-800 dark:text-amber-300/90 leading-relaxed">
        {isAr
          ? 'يمكنك إرسال رسالة تأكيد لبريدك الإلكتروني الحالي، ثم تحديث الحالة بعد النقر على رابط التأكيد.'
          : 'Send a verification email to your current address, then refresh your status after clicking the verification link.'}
      </p>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-0.5">
        <button
          type="button"
          data-testid="send-verification-email-btn"
          disabled={isBusy}
          onClick={onSendVerification}
          className="flex-1 py-2 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
        >
          <Mail className="w-3.5 h-3.5 shrink-0" />
          <span>
            {sendingVerification
              ? isAr
                ? 'جاري إرسال التحقق...'
                : 'Sending verification...'
              : isAr
                ? EMAIL_VERIFICATION_UI_LABELS.sendAction.ar
                : EMAIL_VERIFICATION_UI_LABELS.sendAction.en}
          </span>
        </button>

        <button
          type="button"
          data-testid="refresh-verification-status-btn"
          disabled={isBusy}
          onClick={onRefreshVerification}
          className="flex-1 py-2 px-3 bg-white dark:bg-gray-800 hover:bg-amber-100/60 dark:hover:bg-gray-700 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-800 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${refreshingVerification ? 'animate-spin' : ''}`} />
          <span>
            {refreshingVerification
              ? isAr
                ? 'جاري تحديث الحالة...'
                : 'Refreshing status...'
              : isAr
                ? EMAIL_VERIFICATION_UI_LABELS.refreshAction.ar
                : EMAIL_VERIFICATION_UI_LABELS.refreshAction.en}
          </span>
        </button>
      </div>
    </div>
  );
}

export interface AccountAuthWidgetProps {
  isAr?: boolean;
}

export const REGISTRATION_ERROR_MESSAGES = {
  existingAccount: {
    ar: 'هذا البريد الإلكتروني مستخدم بالفعل. يمكنك تسجيل الدخول أو استعادة كلمة المرور.',
    en: 'This email address is already registered. You can sign in or reset your password.',
  },
  invalidEmail: {
    ar: 'يرجى إدخال عنوان بريد إلكتروني صالح.',
    en: 'Please enter a valid email address.',
  },
  weakPassword: {
    ar: 'كلمة المرور لا تستوفي متطلبات الأمان. يرجى اختيار كلمة مرور أقوى.',
    en: 'The password does not meet security requirements. Please choose a stronger password.',
  },
  rateLimit: {
    ar: 'تم تجاوز عدد محاولات التسجيل المسموح بها مؤقتاً. يرجى الانتظار قبل المحاولة مجدداً.',
    en: 'Too many registration attempts. Please wait before trying again.',
  },
  networkFailure: {
    ar: 'تعذر الاتصال بخدمة التسجيل. تحقق من اتصال الإنترنت ثم حاول مجدداً.',
    en: 'Unable to connect to the registration service. Check your internet connection and try again.',
  },
  serviceUnavailable: {
    ar: 'خدمة المصادقة غير متاحة حالياً. يرجى المحاولة لاحقاً.',
    en: 'Authentication is currently unavailable. Please try again.',
  },
} as const;

export function getSafeWidgetErrorMessage(err: unknown, isAr: boolean): string {
  if (err instanceof AccountError) {
    if (err.code === 'ACCOUNT_ALREADY_EXISTS') {
      return isAr
        ? REGISTRATION_ERROR_MESSAGES.existingAccount.ar
        : REGISTRATION_ERROR_MESSAGES.existingAccount.en;
    }
    if (err.code === 'REGISTRATION_WEAK_PASSWORD') {
      return isAr
        ? REGISTRATION_ERROR_MESSAGES.weakPassword.ar
        : REGISTRATION_ERROR_MESSAGES.weakPassword.en;
    }
    if (err.code === 'REGISTRATION_RATE_LIMITED') {
      return isAr
        ? REGISTRATION_ERROR_MESSAGES.rateLimit.ar
        : REGISTRATION_ERROR_MESSAGES.rateLimit.en;
    }
    if (err.code === 'REGISTRATION_NETWORK_ERROR') {
      return isAr
        ? REGISTRATION_ERROR_MESSAGES.networkFailure.ar
        : REGISTRATION_ERROR_MESSAGES.networkFailure.en;
    }
    if (err.code === 'EMAIL_VERIFICATION_RATE_LIMITED') {
      return isAr
        ? 'تم تجاوز الحد المسموح من طلبات التحقق من البريد الإلكتروني. يرجى الانتظار والمحاولة لاحقاً.'
        : 'Too many verification requests. Please wait before trying again.';
    }
    if (err.code === 'EMAIL_VERIFICATION_NETWORK_ERROR') {
      return isAr
        ? 'حدث خطأ في الشبكة أثناء التحقق من البريد الإلكتروني. يرجى التحقق من الاتصال والمحاولة مرة أخرى.'
        : 'Network error while processing email verification. Please check your connection and try again.';
    }
    if (err.code === 'EMAIL_VERIFICATION_SESSION_EXPIRED') {
      return isAr
        ? 'انتهت صلاحية جلسة المصادقة. يرجى إعادة تسجيل الدخول للمتابعة.'
        : 'Your authentication session has expired. Please sign in again to verify your email.';
    }
    if (err.code === 'PASSWORD_RESET_RATE_LIMITED') {
      return isAr
        ? 'تم تجاوز الحد المسموح من طلبات إعادة تعيين كلمة المرور. يرجى الانتظار والمحاولة لاحقاً.'
        : 'Too many password reset requests. Please wait and try again later.';
    }
    if (err.code === 'PASSWORD_RESET_NETWORK_ERROR') {
      return isAr
        ? 'حدث خطأ في الشبكة أثناء طلب إعادة تعيين كلمة المرور. يرجى التحقق من الاتصال والمحاولة مرة أخرى.'
        : 'Network error while requesting password reset. Please check your connection and try again.';
    }
    if (err.code === 'ACCOUNT_NOT_FOUND') {
      return isAr
        ? 'لا يمكن تحديث الملف الشخصي قبل اكتمال إعداد سجل الحساب الأساسي.'
        : 'Cannot update profile before canonical account setup is complete.';
    }
    if (err.code === 'AUTH_UNAVAILABLE') {
      return isAr
        ? REGISTRATION_ERROR_MESSAGES.serviceUnavailable.ar
        : REGISTRATION_ERROR_MESSAGES.serviceUnavailable.en;
    }
    if (err.code === 'ACCOUNT_PROVISIONING_FAILED') {
      return isAr
        ? 'تعذر إكمال إعداد ملف الحساب الأساسي. يرجى المحاولة مرة أخرى.'
        : 'ACCOUNT_PROVISIONING_FAILED: Unable to provision platform account.';
    }
    if (err.code === 'ACCOUNT_DATA_INVALID') {
      const lower = (err.message || '').toLowerCase();
      if (lower.includes('email')) {
        return isAr
          ? REGISTRATION_ERROR_MESSAGES.invalidEmail.ar
          : REGISTRATION_ERROR_MESSAGES.invalidEmail.en;
      }
      if (lower.includes('displayname') || lower.includes('forbidden')) {
        return isAr
          ? 'يرجى إدخال اسم معروض صالح غير فارغ.'
          : 'Please enter a valid non-empty display name.';
      }
      return isAr
        ? 'بيانات ملف الحساب غير صالحة أو غير مكتملة.'
        : 'Unable to read or validate canonical account profile.';
    }
  }
  if (typeof err === 'string' && err.trim() !== '') {
    if (
      err.includes('FirebaseError') ||
      err.includes('permission-denied') ||
      err.includes('FIRESTORE_ACCESS_ERROR')
    ) {
      return isAr
        ? 'تعذر إكمال العملية في قاعدة البيانات. يرجى المحاولة مرة أخرى.'
        : 'Unable to complete account operation. Please try again.';
    }
    return err;
  }
  return isAr ? 'تعذر إكمال إعداد ملف الحساب.' : 'Unable to complete account profile setup.';
}

export function AccountAuthWidget({ isAr = false }: AccountAuthWidgetProps) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'signin' | 'register' | 'reset' | 'profile'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileDisplayName, setProfileDisplayName] = useState('');
  const [updatingProfile, setUpdatingProfile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [sendingVerification, setSendingVerification] = useState(false);
  const [refreshingVerification, setRefreshingVerification] = useState(false);

  const authSeqRef = useRef(0);

  // Observe auth state and coordinate with in-flight registration or bounded single recovery
  useEffect(() => {
    let mounted = true;

    const unsubscribe = AccountService.observeAuthState(async (user) => {
      const seq = ++authSeqRef.current;

      if (!mounted) return;

      if (!user) {
        setFirebaseUser(null);
        setAccount(null);
        setEmailVerified(false);
        setSendingVerification(false);
        setRefreshingVerification(false);
        setRecovering(false);
        setEditingProfile(false);
        setUpdatingProfile(false);
        setMode('signin');
        setLoading(false);
        return;
      }

      setFirebaseUser(user);
      setEmailVerified(user.emailVerified === true);
      setSendingVerification(false);
      setRefreshingVerification(false);
      setMode('profile');

      try {
        // 1. If register() is actively in-flight for this user, await its single provisioning attempt
        const inFlightReg = await AccountService.awaitInFlightRegistrationForUser(user);
        if (!mounted || seq !== authSeqRef.current) return;

        if (inFlightReg) {
          if (inFlightReg.account && inFlightReg.account.id === user.uid) {
            setAccount(inFlightReg.account);
            setProfileDisplayName(inFlightReg.account.displayName);
            setError(null);
          } else {
            setAccount(null);
            setEditingProfile(false);
            if (inFlightReg.error) {
              setError(getSafeWidgetErrorMessage(inFlightReg.error, isAr));
            }
          }
          setLoading(false);
          return;
        }

        // 2. Otherwise perform a single bounded read-first recovery for the signed-in user
        const recovery = await AccountService.recoverCurrentAccountProfile();
        if (!mounted || seq !== authSeqRef.current) return;

        if (recovery.status === 'unauthenticated') {
          setFirebaseUser(null);
          setAccount(null);
          setEditingProfile(false);
          setMode('signin');
          setLoading(false);
          return;
        }

        if (recovery.account && recovery.account.id === user.uid) {
          setAccount(recovery.account);
          setProfileDisplayName(recovery.account.displayName);
          setError(null);
        } else {
          setAccount(null);
          setEditingProfile(false);
          setError(
            recovery.error
              ? getSafeWidgetErrorMessage(recovery.error.message, isAr)
              : null
          );
        }
      } catch (err: any) {
        if (!mounted || seq !== authSeqRef.current) return;
        console.error('Failed to resolve or recover account profile:', err);
        setAccount(null);
        setEditingProfile(false);
        setError(getSafeWidgetErrorMessage(err, isAr));
      } finally {
        if (mounted && seq === authSeqRef.current) {
          setLoading(false);
        }
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [isAr]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const signedInUser = await AccountService.signIn(email, password);
      if (signedInUser) {
        setFirebaseUser(signedInUser);
        setEmailVerified(signedInUser.emailVerified === true);
      }
      const recovery = await AccountService.recoverCurrentAccountProfile();
      if (recovery.account) {
        setAccount(recovery.account);
        setProfileDisplayName(recovery.account.displayName);
        setSuccess(isAr ? 'تم تسجيل الدخول بنجاح' : 'Signed in successfully');
      } else if (recovery.status === 'recoverable_failure') {
        setAccount(null);
        setEditingProfile(false);
        setError(
          recovery.error
            ? getSafeWidgetErrorMessage(recovery.error.message, isAr)
            : getSafeWidgetErrorMessage(null, isAr)
        );
      }
      setEmail('');
      setPassword('');
    } catch (err: any) {
      setError(getSafeWidgetErrorMessage(err, isAr) || (isAr ? 'فشل تسجيل الدخول' : 'Sign in failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const res = await AccountService.register(email, password, displayName);
      if (res.user) {
        setFirebaseUser(res.user);
        setEmailVerified(res.user.emailVerified === true);
        setMode('profile');
      }
      if (res.account) {
        setAccount(res.account);
        setProfileDisplayName(res.account.displayName);
        setSuccess(isAr ? 'تم إنشاء الحساب بنجاح' : 'Account created successfully');
        setEmail('');
        setPassword('');
        setDisplayName('');
      } else {
        setAccount(null);
        setEditingProfile(false);
        setPassword('');
        setError(
          res.error
            ? getSafeWidgetErrorMessage(res.error, isAr)
            : isAr
              ? 'فشل إنشاء مستند الحساب'
              : 'Account profile document provisioning failed'
        );
      }
    } catch (err: any) {
      setError(getSafeWidgetErrorMessage(err, isAr) || (isAr ? 'فشل إنشاء الحساب' : 'Registration failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const result = await AccountService.requestPasswordReset(email);
      setSuccess(
        isAr
          ? result.messageAr || NEUTRAL_PASSWORD_RESET_MESSAGES.ar
          : result.messageEn || NEUTRAL_PASSWORD_RESET_MESSAGES.en
      );
      setPassword('');
    } catch (err: any) {
      setError(getSafeWidgetErrorMessage(err, isAr));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteAccountSetup = async () => {
    if (!firebaseUser || recovering || submitting) return;
    const targetUid = firebaseUser.uid;
    const seq = authSeqRef.current;

    setError(null);
    setSuccess(null);
    setRecovering(true);

    try {
      const recovery = await AccountService.recoverCurrentAccountProfile({
        displayName: displayName.trim() || undefined,
      });

      if (seq !== authSeqRef.current) return;

      if (recovery.status === 'unauthenticated') {
        setFirebaseUser(null);
        setAccount(null);
        setEditingProfile(false);
        setMode('signin');
        return;
      }

      if (recovery.account && recovery.account.id === targetUid) {
        setAccount(recovery.account);
        setProfileDisplayName(recovery.account.displayName);
        setDisplayName('');
        setError(null);
        setSuccess(
          isAr
            ? 'تم إكمال إعداد ملف الحساب بنجاح'
            : 'Account profile setup completed successfully'
        );
      } else {
        setAccount(null);
        setEditingProfile(false);
        setError(
          recovery.error
            ? getSafeWidgetErrorMessage(recovery.error.message, isAr)
            : getSafeWidgetErrorMessage(null, isAr)
        );
      }
    } catch (err: any) {
      if (seq !== authSeqRef.current) return;
      setAccount(null);
      setEditingProfile(false);
      setError(getSafeWidgetErrorMessage(err, isAr));
    } finally {
      if (seq === authSeqRef.current) {
        setRecovering(false);
      }
    }
  };

  const handleUpdateProfileDisplayName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !account || account.id !== firebaseUser.uid || recovering || updatingProfile) {
      return;
    }

    const trimmed = profileDisplayName.trim();
    if (!trimmed) {
      setError(
        isAr
          ? 'يرجى إدخال اسم معروض صالح غير فارغ.'
          : 'Please enter a valid non-empty display name.'
      );
      return;
    }

    const targetUid = firebaseUser.uid;
    const seq = authSeqRef.current;

    setError(null);
    setSuccess(null);
    setUpdatingProfile(true);

    try {
      const updated = await AccountService.updateCurrentAccount({
        displayName: trimmed,
      });

      if (seq !== authSeqRef.current) return;

      // Update displayed profile ONLY after authoritative persistence succeeds
      if (updated && updated.id === targetUid) {
        setAccount(updated);
        setProfileDisplayName(updated.displayName);
        setEditingProfile(false);
        setSuccess(
          isAr
            ? 'تم تحديث الاسم المعروض بنجاح'
            : 'Display name updated successfully'
        );
      }
    } catch (err: any) {
      if (seq !== authSeqRef.current) return;
      setError(
        err instanceof AccountError && err.code === 'ACCOUNT_DATA_INVALID'
          ? isAr
            ? 'تعذر حفظ الاسم المعروض في قاعدة البيانات. يرجى المحاولة مرة أخرى.'
            : 'Unable to save display name to your account profile. Please try again.'
          : getSafeWidgetErrorMessage(err, isAr)
      );
    } finally {
      if (seq === authSeqRef.current) {
        setUpdatingProfile(false);
      }
    }
  };

  const handleSendVerificationEmail = async () => {
    if (!firebaseUser || sendingVerification || refreshingVerification) return;
    const targetUid = firebaseUser.uid;
    const seq = authSeqRef.current;

    setError(null);
    setSuccess(null);
    setSendingVerification(true);

    try {
      const result = await AccountService.sendEmailVerificationForCurrentUser();
      if (seq !== authSeqRef.current || result.uid !== targetUid) return;

      setEmailVerified(result.emailVerified === true);
      setSuccess(isAr ? result.messageAr : result.messageEn);
    } catch (err: any) {
      if (seq !== authSeqRef.current) return;
      setError(getSafeWidgetErrorMessage(err, isAr));
    } finally {
      if (seq === authSeqRef.current) {
        setSendingVerification(false);
      }
    }
  };

  const handleRefreshVerificationStatus = async () => {
    if (!firebaseUser || sendingVerification || refreshingVerification) return;
    const targetUid = firebaseUser.uid;
    const seq = authSeqRef.current;

    setError(null);
    setSuccess(null);
    setRefreshingVerification(true);

    try {
      const result = await AccountService.refreshEmailVerificationStatus();
      if (seq !== authSeqRef.current || result.uid !== targetUid) return;

      setEmailVerified(result.emailVerified === true);
      setSuccess(isAr ? result.messageAr : result.messageEn);
    } catch (err: any) {
      if (seq !== authSeqRef.current) return;
      setError(getSafeWidgetErrorMessage(err, isAr));
    } finally {
      if (seq === authSeqRef.current) {
        setRefreshingVerification(false);
      }
    }
  };

  const handleSignOut = async () => {
    authSeqRef.current += 1;
    setError(null);
    setEmailVerified(false);
    setSendingVerification(false);
    setRefreshingVerification(false);
    setRecovering(false);
    setEditingProfile(false);
    setUpdatingProfile(false);
    try {
      await AccountService.signOut();
      setFirebaseUser(null);
      setAccount(null);
      setMode('signin');
      setSuccess(isAr ? 'تم تسجيل الخروج بنجاح' : 'Signed out successfully');
    } catch (err: any) {
      setError(getSafeWidgetErrorMessage(err, isAr) || (isAr ? 'فشل تسجيل الخروج' : 'Sign out failed'));
    }
  };

  if (loading) {
    return (
      <div className="p-4 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm text-center text-xs text-gray-500">
        {isAr ? 'جاري التحقق من حالة المصادقة...' : 'Verifying authentication state...'}
      </div>
    );
  }

  if (!isFirebaseConfigured) {
    return (
      <div className="p-4 bg-amber-50 dark:bg-amber-950/20 rounded-2xl border border-amber-200 dark:border-amber-900/60 text-xs text-amber-900 dark:text-amber-300 space-y-2">
        <div className="flex items-center gap-2 font-bold">
          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
          <span>{isAr ? 'خدمة المصادقة غير مكوّنة' : 'Authentication Service Unconfigured'}</span>
        </div>
        <p className="leading-relaxed">
          {isAr
            ? 'متغيرات بيئة Firebase غير متوفرة. تعمل المنصة في وضع التصفح العام الآمن (بدون حسابات نشطة حالياً).'
            : 'Firebase environment variables are unconfigured. The platform is running in secure public browsing mode (no active accounts).'}
        </p>
      </div>
    );
  }

  const hasProvisionedAccount = Boolean(firebaseUser && account && account.id === firebaseUser.uid);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-4 sm:p-6 w-full max-w-md mx-auto" dir={isAr ? 'rtl' : 'ltr'}>
      {!firebaseUser ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
            <div className="flex items-center gap-2">
              <UserIcon className="w-5 h-5 text-emerald-600" />
              <h3 className="text-sm font-extrabold text-gray-900 dark:text-white">
                {mode === 'signin'
                  ? (isAr ? 'تسجيل دخول الحساب' : 'Platform Account Sign In')
                  : mode === 'register'
                    ? (isAr ? 'إنشاء حساب منصة جديد' : 'Create Platform Account')
                    : (isAr ? 'استعادة كلمة المرور' : 'Reset Password')}
              </h3>
            </div>
            <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl text-xs font-bold">
              <button
                type="button"
                onClick={() => {
                  setMode('signin');
                  setError(null);
                  setSuccess(null);
                }}
                className={`px-3 py-1 rounded-lg transition-colors ${mode === 'signin' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs' : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'}`}
              >
                {isAr ? 'دخول' : 'Sign In'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                  setSuccess(null);
                }}
                className={`px-3 py-1 rounded-lg transition-colors ${mode === 'register' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs' : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'}`}
              >
                {isAr ? 'تسجيل جديد' : 'Register'}
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/60 rounded-xl text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/60 rounded-xl text-xs text-emerald-700 dark:text-emerald-300 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{success}</span>
            </div>
          )}

          {mode === 'signin' ? (
            <form onSubmit={handleSignIn} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  {isAr ? 'البريد الإلكتروني' : 'Email Address'}
                </label>
                <div className="relative">
                  <Mail className={`w-4 h-4 text-gray-400 absolute top-3 ${isAr ? 'right-3' : 'left-3'}`} />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className={`w-full py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 ${isAr ? 'pr-9 pl-3 text-right' : 'pl-9 pr-3 text-left'}`}
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300">
                    {isAr ? 'كلمة المرور' : 'Password'}
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('reset');
                      setError(null);
                      setSuccess(null);
                    }}
                    className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                  >
                    {isAr ? FORGOT_PASSWORD_ACTION_LABELS.ar : FORGOT_PASSWORD_ACTION_LABELS.en}
                  </button>
                </div>
                <div className="relative">
                  <Lock className={`w-4 h-4 text-gray-400 absolute top-3 ${isAr ? 'right-3' : 'left-3'}`} />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className={`w-full py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 ${isAr ? 'pr-9 pl-3 text-right' : 'pl-9 pr-3 text-left'}`}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer disabled:opacity-50"
              >
                <LogIn className="w-4 h-4" />
                <span>{submitting ? (isAr ? 'جاري الدخول...' : 'Signing In...') : (isAr ? 'تسجيل الدخول' : 'Sign In')}</span>
              </button>
            </form>
          ) : mode === 'register' ? (
            <form onSubmit={handleRegister} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  {isAr ? 'الاسم المعروض' : 'Display Name'}
                </label>
                <div className="relative">
                  <UserIcon className={`w-4 h-4 text-gray-400 absolute top-3 ${isAr ? 'right-3' : 'left-3'}`} />
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={isAr ? 'اسم المستخدم' : 'Your Name'}
                    className={`w-full py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 ${isAr ? 'pr-9 pl-3 text-right' : 'pl-9 pr-3 text-left'}`}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  {isAr ? 'البريد الإلكتروني' : 'Email Address'}
                </label>
                <div className="relative">
                  <Mail className={`w-4 h-4 text-gray-400 absolute top-3 ${isAr ? 'right-3' : 'left-3'}`} />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className={`w-full py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 ${isAr ? 'pr-9 pl-3 text-right' : 'pl-9 pr-3 text-left'}`}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  {isAr ? 'كلمة المرور (6 أحرف على الأقل)' : 'Password (min 6 chars)'}
                </label>
                <div className="relative">
                  <Lock className={`w-4 h-4 text-gray-400 absolute top-3 ${isAr ? 'right-3' : 'left-3'}`} />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className={`w-full py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 ${isAr ? 'pr-9 pl-3 text-right' : 'pl-9 pr-3 text-left'}`}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer disabled:opacity-50"
              >
                <UserPlus className="w-4 h-4" />
                <span>{submitting ? (isAr ? 'جاري إنشاء الحساب...' : 'Creating Account...') : (isAr ? 'إنشاء حساب جديد' : 'Create Account')}</span>
              </button>
            </form>
          ) : (
            <form onSubmit={handlePasswordReset} className="space-y-3">
              <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                {isAr
                  ? 'أدخل عنوان بريدك الإلكتروني لإرسال رابط إعادة تعيين كلمة المرور.'
                  : 'Enter your email address to request password reset instructions.'}
              </p>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  {isAr ? 'البريد الإلكتروني' : 'Email Address'}
                </label>
                <div className="relative">
                  <Mail className={`w-4 h-4 text-gray-400 absolute top-3 ${isAr ? 'right-3' : 'left-3'}`} />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className={`w-full py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 ${isAr ? 'pr-9 pl-3 text-right' : 'pl-9 pr-3 text-left'}`}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer disabled:opacity-50"
              >
                <KeyRound className="w-4 h-4" />
                <span>
                  {submitting
                    ? (isAr ? 'جاري الإرسال...' : 'Sending...')
                    : (isAr ? 'إرسال تعليمات إعادة التعيين' : 'Send Reset Instructions')}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode('signin');
                  setError(null);
                  setSuccess(null);
                }}
                className="w-full py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                {isAr ? 'العودة لتسجيل الدخول' : 'Back to Sign In'}
              </button>
            </form>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
            <div className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs ${
                  hasProvisionedAccount
                    ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                    : 'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300'
                }`}
              >
                {(account?.displayName || firebaseUser.email || 'U')[0].toUpperCase()}
              </div>
              <div>
                <h4 className="text-xs font-extrabold text-gray-900 dark:text-white">
                  {hasProvisionedAccount
                    ? account!.displayName
                    : firebaseUser.displayName || (isAr ? 'مستخدم المنصة' : 'Platform User')}
                </h4>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
                  {firebaseUser.email}
                </p>
              </div>
            </div>
            {hasProvisionedAccount ? (
              <span className="px-2.5 py-1 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 rounded-full text-[10px] font-bold">
                {isAr ? 'حساب نشط' : 'Active Account'}
              </span>
            ) : (
              <span className="px-2.5 py-1 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 rounded-full text-[10px] font-bold">
                {isAr ? 'إعداد غير مكتمل' : 'Setup Incomplete'}
              </span>
            )}
          </div>

          {success && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/60 rounded-xl text-xs text-emerald-700 dark:text-emerald-300 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{success}</span>
            </div>
          )}

          {!hasProvisionedAccount ? (
            <div className="space-y-3">
              <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/60 rounded-xl text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <span className="font-semibold leading-relaxed">
                  {isAr ? INCOMPLETE_ACCOUNT_SETUP_MESSAGES.ar : INCOMPLETE_ACCOUNT_SETUP_MESSAGES.en}
                </span>
              </div>

              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/60 rounded-xl text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="button"
                onClick={handleCompleteAccountSetup}
                disabled={recovering || submitting}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${recovering ? 'animate-spin' : ''}`} />
                <span>
                  {recovering
                    ? (isAr ? 'جاري إكمال إعداد الحساب...' : 'Completing Account Setup...')
                    : (isAr ? 'إكمال إعداد ملف الحساب' : 'Complete Account Profile Setup')}
                </span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/60 rounded-xl text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <AccountEmailVerificationSection
                emailVerified={emailVerified}
                isAr={isAr}
                sendingVerification={sendingVerification}
                refreshingVerification={refreshingVerification}
                onSendVerification={handleSendVerificationEmail}
                onRefreshVerification={handleRefreshVerificationStatus}
              />

              <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl text-[11px] text-gray-600 dark:text-gray-400 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{isAr ? 'الاسم المعروض:' : 'Display Name:'}</span>
                  {!editingProfile && (
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900 dark:text-white">
                        {account?.displayName}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setProfileDisplayName(account?.displayName || '');
                          setEditingProfile(true);
                          setError(null);
                          setSuccess(null);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-gray-600 transition-colors cursor-pointer"
                      >
                        <Pencil className="w-3 h-3" />
                        <span>{isAr ? 'تعديل' : 'Edit'}</span>
                      </button>
                    </div>
                  )}
                </div>

                {editingProfile && (
                  <form onSubmit={handleUpdateProfileDisplayName} className="space-y-2 pt-1">
                    <input
                      type="text"
                      value={profileDisplayName}
                      onChange={(e) => setProfileDisplayName(e.target.value)}
                      placeholder={isAr ? 'الاسم المعروض' : 'Display Name'}
                      disabled={updatingProfile}
                      className="w-full py-2 px-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        disabled={updatingProfile}
                        className="flex-1 py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>
                          {updatingProfile
                            ? (isAr ? 'جاري الحفظ...' : 'Saving...')
                            : (isAr ? 'حفظ الاسم' : 'Save Name')}
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={updatingProfile}
                        onClick={() => {
                          setEditingProfile(false);
                          setProfileDisplayName(account?.displayName || '');
                          setError(null);
                        }}
                        className="py-1.5 px-3 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>{isAr ? 'إلغاء' : 'Cancel'}</span>
                      </button>
                    </div>
                  </form>
                )}

                <div className="flex justify-between">
                  <span className="font-semibold">UID:</span>
                  <span className="font-mono text-[10px] truncate max-w-[180px]">{firebaseUser.uid}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-semibold">{isAr ? 'تاريخ الإنشاء:' : 'Created:'}</span>
                  <span>{account?.createdAt ? new Date(account.createdAt).toLocaleDateString() : 'N/A'}</span>
                </div>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleSignOut}
            className="w-full py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>{isAr ? 'تسجيل الخروج' : 'Sign Out'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
