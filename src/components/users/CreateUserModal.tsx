import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  X, 
  UserPlus, 
  Shield, 
  Mail, 
  User, 
  Info, 
  AlertCircle,
  Sparkles,
  CheckCircle2
} from 'lucide-react';
import { AdminRole } from '../../types/admin';
import type { AdminUser } from '../../types/admin';
import { AdminUserManager } from '../../services/adminUserManager';
import { AdminAccessService } from '../../services/adminAccess';
import { AdminModalViewport } from '../common/AdminModalViewport';
import { 
  getRoleLabel, 
  getRoleDescription,
  getPermissionLabel 
} from './userFormatters';

interface CreateUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingUsers: AdminUser[];
  onUserCreated: (newUser: AdminUser) => void;
}

export const CreateUserModal: React.FC<CreateUserModalProps> = ({
  isOpen,
  onClose,
  existingUsers,
  onUserCreated,
}) => {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  const modalContainerRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [selectedRole, setSelectedRole] = useState<AdminRole>(AdminRole.ContentEditor);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  if (!isOpen) return null;

  const rolePermissions = Array.from(AdminAccessService.getPermissionsForRole(selectedRole));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const result = AdminUserManager.createDemoUser(
      {
        name,
        email,
        role: selectedRole,
      },
      existingUsers
    );

    if (!result.success || !result.user) {
      setError(isAr ? (result.errorAr || 'تعذر إنشاء المستخدم') : (result.errorEn || 'Failed to create user'));
      return;
    }

    setIsSuccess(true);
    setTimeout(() => {
      onUserCreated(result.user!);
      setIsSuccess(false);
      setName('');
      setEmail('');
      setSelectedRole(AdminRole.ContentEditor);
      onClose();
    }, 400);
  };

  return (
    <AdminModalViewport
      isOpen={isOpen}
      onClose={onClose}
      onEscape={onClose}
      size="md"
      dir={isAr ? 'rtl' : 'ltr'}
      titleId="create-user-title"
      containerRef={modalContainerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-user-title"
    >
      <div 
        ref={modalContainerRef}
        className="bg-white dark:bg-gray-900 rounded-2xl w-full border border-gray-200 dark:border-gray-800 shadow-2xl overflow-hidden my-auto pop-motion-dialog flex flex-col max-h-[calc(100vh-2rem)]"
      >
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-850/50">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-200 dark:border-emerald-800">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 id="create-user-title" className="text-base sm:text-lg font-extrabold text-gray-900 dark:text-gray-100">
                {isAr ? 'إنشاء هوية إدارية جديدة' : 'Create Demo Admin Identity'}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {isAr ? 'إضافة هوية تجريبية للجلسة الحالية وفق نموذج الصلاحيات RBAC' : 'Add session administrative identity governed by canonical RBAC'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer transition-colors"
            aria-label="Close"
            id="close-create-user-btn"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Demo Identity Disclaimer */}
        <div className="px-4 sm:px-6 pt-4 pb-2">
          <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-850/60 rounded-xl p-3 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-300">
            <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p>
              {isAr 
                ? 'تنبيه: يتم إنشاء هذه الهوية الإدارية محلياً للجلسة الحالية لاختبار ومحاكاة الصلاحيات. لا يتم تخزين كلمات مرور أو إرسال بريد إلكتروني فعلي.' 
                : 'Notice: This creates a local session identity to simulate and test RBAC permissions. No real passwords or emails are transmitted.'}
            </p>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
          {error && (
            <div className="bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 p-3 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Name Field */}
          <div>
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5" htmlFor="user-name-input">
              {isAr ? 'الاسم الكامل للمستخدم' : 'Full Name'} <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 start-0 flex items-center ps-3 pointer-events-none text-gray-400">
                <User className="w-4 h-4" />
              </div>
              <input
                id="user-name-input"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={isAr ? 'مثال: د. إبراهيم فضل الله' : 'e.g. Dr. Ibrahim Fadlallah'}
                className="w-full ps-9 pe-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-hidden focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
              />
            </div>
          </div>

          {/* Email Field */}
          <div>
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5" htmlFor="user-email-input">
              {isAr ? 'البريد الإلكتروني الإداري' : 'Admin Email Address'} <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 start-0 flex items-center ps-3 pointer-events-none text-gray-400">
                <Mail className="w-4 h-4" />
              </div>
              <input
                id="user-email-input"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={isAr ? 'user@promiseofplanet.sd' : 'user@promiseofplanet.sd'}
                className="w-full ps-9 pe-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-hidden focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
              />
            </div>
          </div>

          {/* Role Selection Field */}
          <div>
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5" htmlFor="user-role-select">
              {isAr ? 'الدور الإداري المخصص' : 'Assigned Canonical Role'} <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 start-0 flex items-center ps-3 pointer-events-none text-gray-400">
                <Shield className="w-4 h-4" />
              </div>
              <select
                id="user-role-select"
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value as AdminRole)}
                className="w-full ps-9 pe-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-semibold text-gray-900 dark:text-gray-100 focus:outline-hidden focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors cursor-pointer"
              >
                {Object.values(AdminRole).map((role) => (
                  <option key={role} value={role}>
                    {getRoleLabel(role, isAr)} ({role})
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
              {getRoleDescription(selectedRole, isAr)}
            </p>
          </div>

          {/* Role Effective Permissions Preview Card */}
          <div className="p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200/80 dark:border-gray-700/80 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                {isAr ? 'الصلاحيات المترتبة على هذا الدور:' : 'Effective Granted Permissions:'}
              </span>
              <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300">
                {rolePermissions.length} / 10
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5 pt-1">
              {rolePermissions.map((perm) => (
                <span
                  key={perm}
                  className="px-2 py-0.5 text-[10px] font-medium rounded-md bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 shadow-2xs flex items-center gap-1"
                >
                  <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>{getPermissionLabel(perm, isAr)}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-gray-100 dark:border-gray-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl cursor-pointer transition-colors"
              id="cancel-create-user-btn"
            >
              {isAr ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={isSuccess}
              className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl cursor-pointer shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
              id="submit-create-user-btn"
            >
              {isSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4 animate-spin" />
                  <span>{isAr ? 'تم الإنشاء بنجاح...' : 'Creating...'}</span>
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  <span>{isAr ? 'حفظ وتفعيل الهوية' : 'Create Identity'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </AdminModalViewport>
  );
};
