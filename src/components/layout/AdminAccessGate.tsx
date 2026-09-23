import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, LogOut, ArrowLeft, Loader2, ShieldCheck, ArrowRight } from 'lucide-react';
import { AccountService } from '../../services/accountService';
import { AdminIdentityService, AdminGateResolutionController, type AdminGateState, type AdminGateStateSnapshot } from '../../services/adminIdentityService';
import { AccountAuthWidget } from '../auth/AccountAuthWidget';
import { AdminLayout } from './AdminLayout';

export type { AdminGateState };

interface AdminAccessGateProps {
  onExitAdmin: () => void;
  // Optional identity service instance override for testing
  identityService?: typeof AdminIdentityService;
}

export function AdminAccessGate({ onExitAdmin, identityService = AdminIdentityService }: AdminAccessGateProps) {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  const controllerRef = useRef<AdminGateResolutionController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new AdminGateResolutionController();
  }

  const [snapshot, setSnapshot] = useState<AdminGateStateSnapshot>(() => controllerRef.current!.getSnapshot());

  // Observe Auth State and resolve admins/{uid} using AdminGateResolutionController
  useEffect(() => {
    const controller = controllerRef.current!;
    controller.mount();
    const unsubscribeSnapshot = controller.subscribe(setSnapshot);

    const unsubscribeAuth = AccountService.observeAuthState((user) => {
      controller.handleAuthEvent(
        user,
        (uid) => identityService.resolveAdminForAuthenticatedUid(uid)
      );
    });

    return () => {
      controller.unmount();
      unsubscribeSnapshot();
      unsubscribeAuth();
    };
  }, [identityService]);

  const handleSignOut = async () => {
    try {
      try {
        sessionStorage.removeItem('pop_admin_session');
      } catch (e) {
        console.error(e);
      }
      await AccountService.signOut();
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  const { gateState, firebaseUser, adminUser } = snapshot;

  // Clear session storage if unauthenticated or authoritatively denied (exclude transient read errors)
  useEffect(() => {
    const isTransientReadError = snapshot.revalidationError === 'ADMIN_READ_FAILURE';
    if (gateState === 'UNAUTHENTICATED' || (gateState === 'ADMIN_DENIED' && !isTransientReadError)) {
      try {
        sessionStorage.removeItem('pop_admin_session');
      } catch (e) {
        console.error(e);
      }
    }
  }, [gateState, snapshot.revalidationError]);

  // 1. Loading State
  if (gateState === 'AUTH_LOADING' || gateState === 'ADMIN_RESOLVING') {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4" dir={isAr ? 'rtl' : 'ltr'}>
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl p-8 max-w-sm w-full text-center space-y-4 shadow-lg">
          <div className="h-12 w-12 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">
              {gateState === 'AUTH_LOADING'
                ? (isAr ? 'جاري التحقق من حالة المصادقة...' : 'Verifying Authentication State...')
                : (isAr ? 'جاري التحقق من الصلاحيات الإدارية...' : 'Resolving Administrative Authority...')}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {isAr ? 'الرجاء الانتظار لحظات...' : 'Please wait a moment...'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // 2. Unauthenticated State -> Render Auth Widget
  if (gateState === 'UNAUTHENTICATED') {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4 sm:p-6" dir={isAr ? 'rtl' : 'ltr'}>
        <div className="max-w-md w-full space-y-4">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 shadow-sm flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              <div>
                <h2 className="text-xs font-extrabold text-gray-900 dark:text-white">
                  {isAr ? 'بوابة الإدارة - التسجيل مطلوب' : 'Back-Office Access Control'}
                </h2>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  {isAr ? 'يتطلب دخول لوحة التحكم حساباً معتمداً' : 'An authorized platform account is required'}
                </p>
              </div>
            </div>
            <button
              onClick={onExitAdmin}
              className="px-2.5 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors"
            >
              {isAr ? <ArrowRight className="w-3.5 h-3.5" /> : <ArrowLeft className="w-3.5 h-3.5" />}
              <span>{isAr ? 'الموقع' : 'Exit'}</span>
            </button>
          </div>

          <AccountAuthWidget isAr={isAr} />
        </div>
      </div>
    );
  }

  // 3. Access Denied State (User is authenticated, but not an active admin)
  if (gateState === 'ADMIN_DENIED') {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4 sm:p-6" dir={isAr ? 'rtl' : 'ltr'}>
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-xl space-y-6 text-center">
          <div className="h-16 w-16 rounded-3xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto border border-rose-200 dark:border-rose-900">
            <ShieldAlert className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h2 className="text-base sm:text-lg font-extrabold text-gray-900 dark:text-white">
              {snapshot.revalidationError === 'ADMIN_READ_FAILURE'
                ? (isAr ? 'الخدمة غير متوفرة مؤقتاً' : 'Administrative Service Unavailable')
                : (isAr ? 'صلاحية الوصول غيّر متوفرة' : 'Administrative Access Denied')}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              {snapshot.revalidationError === 'ADMIN_READ_FAILURE'
                ? (isAr
                    ? 'الخدمة الإدارية للمنصة غير متوفرة حالياً بسبب خلل مؤقت في الشبكة أو قاعدة البيانات. يرجى التحقق من الاتصال والمحاولة لاحقاً.'
                    : 'The administrative platform service is temporarily unavailable due to a connection or database issue. Please verify your network and retry.')
                : (isAr
                    ? 'الحساب الحالي غير مسجل ضمن الهويات الإدارية المعتمدة للمنصة، أو أن حسابك الإداري غير نشط حالياً.'
                    : 'The current platform account is not registered in the canonical admins directory, or your administrative profile is currently inactive.')}
            </p>
          </div>

          {firebaseUser && (
            <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-2xl border border-gray-200/80 dark:border-gray-800 text-xs text-gray-700 dark:text-gray-300 space-y-1 text-start">
              <div className="flex justify-between">
                <span className="font-semibold text-gray-500">{isAr ? 'البريد:' : 'Email:'}</span>
                <span className="font-bold truncate max-w-[200px]">{firebaseUser.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-gray-500">UID:</span>
                <span className="font-mono text-[10px] truncate max-w-[200px]">{firebaseUser.uid}</span>
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <button
              onClick={onExitAdmin}
              className="flex-1 py-2.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <span>{isAr ? 'العودة للمنصة العامة' : 'Exit to Public Portal'}</span>
            </button>

            <button
              onClick={handleSignOut}
              className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-sm"
            >
              <LogOut className="w-4 h-4" />
              <span>{isAr ? 'تسجيل الخروج' : 'Sign Out'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 4. Authorized State -> Render Admin Workspace Layout
  if (gateState === 'ADMIN_AUTHORIZED' && adminUser) {
    return (
      <AdminLayout
        currentUser={adminUser}
        onExitAdmin={onExitAdmin}
        onSignOut={handleSignOut}
      />
    );
  }

  return null;
}
