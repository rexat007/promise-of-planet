import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  X, 
  Shield, 
  Mail, 
  User, 
  AlertTriangle, 
  CheckCircle2, 
  MinusCircle, 
  PlusCircle, 
  Power, 
  Sparkles, 
  Lock,
  ArrowRight,
  ArrowLeft
} from 'lucide-react';
import { AdminRole } from '../../types/admin';
import type { AdminUser } from '../../types/admin';
import { AdminUserManager } from '../../services/adminUserManager';
import { AdminAccessService } from '../../services/adminAccess';
import { AdminModalViewport } from '../common/AdminModalViewport';
import { 
  ROLE_METADATA, 
  getRoleLabel, 
  getRoleDescription, 
  getPermissionLabel,
  getStatusLabel 
} from './userFormatters';

interface UserEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: AdminUser | null;
  currentSessionUser: AdminUser;
  allUsers: AdminUser[];
  onUpdateUser: (updatedUser: AdminUser) => void;
}

export const UserEditorModal: React.FC<UserEditorModalProps> = ({
  isOpen,
  onClose,
  user,
  currentSessionUser,
  allUsers,
  onUpdateUser,
}) => {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  const modalContainerRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [selectedRole, setSelectedRole] = useState<AdminRole>(AdminRole.Viewer);
  const [isActive, setIsActive] = useState(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setEmail(user.email);
      setSelectedRole(user.role);
      setIsActive(user.isActive);
      setErrorBanner(null);
      setIsSaved(false);
    }
  }, [user]);

  if (!isOpen || !user) return null;

  const isCurrentSessionUser = user.id === currentSessionUser.id;
  const isLastActiveOwner = AdminUserManager.isLastActiveOwner(user, allUsers);
  const hasRoleChanged = selectedRole !== user.role;
  const hasStatusChanged = isActive !== user.isActive;

  // Compute permission diff when role changes
  const permDiff = AdminUserManager.getRolePermissionDiff(user.role, selectedRole);
  const effectivePermissions = Array.from(AdminAccessService.getPermissionsForRole(selectedRole));

  // Invariant checks
  const deactivationCheck = hasStatusChanged && !isActive
    ? AdminUserManager.canDeactivateUser(user, currentSessionUser, allUsers)
    : { allowed: true };

  const roleChangeCheck = hasRoleChanged
    ? AdminUserManager.canChangeUserRole(user, selectedRole, currentSessionUser, allUsers)
    : { allowed: true };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorBanner(null);

    // Validate inputs
    const val = AdminUserManager.validateUserData(name, email);
    if (!val.allowed) {
      setErrorBanner(isAr ? (val.reasonAr || 'بيانات غير صالحة') : (val.reasonEn || 'Invalid input data'));
      return;
    }

    // Validate email uniqueness if changed
    if (email.trim().toLowerCase() !== user.email.toLowerCase()) {
      const emailExists = allUsers.some(
        u => u.id !== user.id && u.email.toLowerCase() === email.trim().toLowerCase()
      );
      if (emailExists) {
        setErrorBanner(
          isAr 
            ? 'البريد الإلكتروني مسجل مسبقاً لمستخدم إداري آخر.' 
            : 'This email is already in use by another administrative user.'
        );
        return;
      }
    }

    // Validate Deactivation Invariants
    if (hasStatusChanged && !isActive) {
      if (!deactivationCheck.allowed) {
        setErrorBanner(isAr ? deactivationCheck.reasonAr! : deactivationCheck.reasonEn!);
        return;
      }
    }

    // Validate Role Change Invariants
    if (hasRoleChanged) {
      if (!roleChangeCheck.allowed) {
        setErrorBanner(isAr ? roleChangeCheck.reasonAr! : roleChangeCheck.reasonEn!);
        return;
      }
    }

    const updatedUser: AdminUser = {
      ...user,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      role: selectedRole,
      isActive,
    };

    setIsSaved(true);
    setTimeout(() => {
      onUpdateUser(updatedUser);
      setIsSaved(false);
      onClose();
    }, 400);
  };

  const handleToggleActive = () => {
    const nextStatus = !isActive;
    if (!nextStatus) {
      // Trying to deactivate
      const check = AdminUserManager.canDeactivateUser(user, currentSessionUser, allUsers);
      if (!check.allowed) {
        setErrorBanner(isAr ? check.reasonAr! : check.reasonEn!);
        return;
      }
    }
    setErrorBanner(null);
    setIsActive(nextStatus);
  };

  return (
    <AdminModalViewport
      isOpen={isOpen}
      onClose={onClose}
      onEscape={onClose}
      size="editor"
      dir={isAr ? 'rtl' : 'ltr'}
      titleId="user-editor-title"
      containerRef={modalContainerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-editor-title"
    >
      <div 
        ref={modalContainerRef}
        className="bg-white dark:bg-gray-900 rounded-2xl w-full border border-gray-200 dark:border-gray-800 shadow-2xl overflow-hidden my-auto pop-motion-dialog max-h-[90vh] flex flex-col"
      >
        {/* Modal Header */}
        <div className="p-4 sm:p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-850/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 border ${ROLE_METADATA[user.role].badgeColorClass}`}>
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 id="user-editor-title" className="text-base sm:text-lg font-extrabold text-gray-900 dark:text-gray-100">
                  {user.name}
                </h3>
                {isCurrentSessionUser && (
                  <span className="px-2 py-0.5 text-[10px] font-extrabold rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                    {isAr ? 'الجلسة الحالية' : 'Current Session'}
                  </span>
                )}
                {isLastActiveOwner && (
                  <span className="px-2 py-0.5 text-[10px] font-extrabold rounded-full bg-rose-100 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                    {isAr ? 'المالك الأخير النشط' : 'Last Active Owner'}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {user.email} &bull; <span className="font-semibold">{getRoleLabel(user.role, isAr)}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer transition-colors"
            aria-label="Close"
            id="close-user-editor-btn"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Content */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
          {/* Error Banner */}
          {errorBanner && (
            <div className="bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 p-3.5 rounded-xl text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold">{isAr ? 'تنبيه أمان الصلاحيات' : 'RBAC Safety Constraint'}</p>
                <p>{errorBanner}</p>
              </div>
            </div>
          )}

          {/* Account Status Card */}
          <div className="p-3.5 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200/80 dark:border-gray-700/80 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2.5">
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-400' : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
                <Power className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-gray-900 dark:text-gray-100">
                  {isAr ? 'حالة الحساب الإداري:' : 'Administrative Account Status:'}{' '}
                  <span className={isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'}>
                    {getStatusLabel(isActive, isAr)}
                  </span>
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  {isActive 
                    ? (isAr ? 'الحساب مفعّل ويتمتع بالصلاحيات المعتمدة لدوره.' : 'Account is active and holds authorized role permissions.')
                    : (isAr ? 'الحساب معطل ومحروم من أي صلاحيات إدارية.' : 'Account is inactive and stripped of all administrative permissions.')}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleToggleActive}
              disabled={isCurrentSessionUser || (isActive && isLastActiveOwner)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all flex items-center gap-1.5 ${
                isActive
                  ? 'bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-900/60 border border-rose-200 dark:border-rose-900 disabled:opacity-40 disabled:cursor-not-allowed'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs'
              }`}
              id="toggle-user-status-btn"
            >
              <Power className="w-3.5 h-3.5" />
              <span>
                {isActive 
                  ? (isAr ? 'تعطيل الحساب' : 'Deactivate') 
                  : (isAr ? 'تفعيل الحساب' : 'Activate')}
              </span>
            </button>
          </div>

          {/* User Information Form */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Name */}
            <div>
              <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1" htmlFor="edit-name-input">
                {isAr ? 'اسم المستخدم' : 'User Display Name'}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 start-0 flex items-center ps-3 pointer-events-none text-gray-400">
                  <User className="w-4 h-4" />
                </div>
                <input
                  id="edit-name-input"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full ps-9 pe-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-gray-100 focus:outline-hidden focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1" htmlFor="edit-email-input">
                {isAr ? 'البريد الإلكتروني' : 'Email Address'}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 start-0 flex items-center ps-3 pointer-events-none text-gray-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  id="edit-email-input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full ps-9 pe-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-gray-100 focus:outline-hidden focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Role Selection & Invariants */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-gray-700 dark:text-gray-300" htmlFor="edit-role-select">
                {isAr ? 'الدور المعتمد (Canonical Role)' : 'Canonical Admin Role'}
              </label>
              {isCurrentSessionUser && (
                <span className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  {isAr ? 'مقفل للمستخدم الحالي' : 'Locked for current session'}
                </span>
              )}
            </div>
            
            <select
              id="edit-role-select"
              disabled={isCurrentSessionUser}
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as AdminRole)}
              className="w-full p-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-bold text-gray-900 dark:text-gray-100 focus:outline-hidden focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {Object.values(AdminRole).map((role) => (
                <option key={role} value={role}>
                  {getRoleLabel(role, isAr)} ({role})
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
              {getRoleDescription(selectedRole, isAr)}
            </p>
          </div>

          {/* Role Change Permission Preview & Diff */}
          {hasRoleChanged && (
            <div className="p-3.5 bg-emerald-50/50 dark:bg-emerald-950/30 rounded-xl border border-emerald-200 dark:border-emerald-800 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-1">
                <span className="text-xs font-bold text-emerald-900 dark:text-emerald-300 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  {isAr ? 'معاينة التغييرات في الصلاحيات المترتبة:' : 'Permission Consequence Preview:'}
                </span>
                <div className="flex items-center gap-1.5 text-xs font-bold text-gray-600 dark:text-gray-300">
                  <span>{getRoleLabel(user.role, isAr)}</span>
                  {isAr ? <ArrowLeft className="w-3.5 h-3.5 text-emerald-600" /> : <ArrowRight className="w-3.5 h-3.5 text-emerald-600" />}
                  <span className="text-emerald-700 dark:text-emerald-400">{getRoleLabel(selectedRole, isAr)}</span>
                </div>
              </div>

              {/* Gained permissions */}
              {permDiff.gained.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-emerald-800 dark:text-emerald-400 mb-1 flex items-center gap-1">
                    <PlusCircle className="w-3.5 h-3.5" />
                    {isAr ? `صلاحيات مكتسبة جديدة (${permDiff.gained.length}):` : `Gained Permissions (${permDiff.gained.length}):`}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {permDiff.gained.map(p => (
                      <span key={p} className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                        + {getPermissionLabel(p, isAr)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Lost permissions */}
              {permDiff.lost.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-rose-800 dark:text-rose-400 mb-1 flex items-center gap-1">
                    <MinusCircle className="w-3.5 h-3.5" />
                    {isAr ? `صلاحيات مسحوبة (${permDiff.lost.length}):` : `Revoked Permissions (${permDiff.lost.length}):`}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {permDiff.lost.map(p => (
                      <span key={p} className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-rose-100 dark:bg-rose-900/60 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-700">
                        - {getPermissionLabel(p, isAr)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Current Effective Permissions Summary List (Informational) */}
          <div className="p-3.5 bg-gray-50 dark:bg-gray-800/40 rounded-xl border border-gray-200/80 dark:border-gray-700/80 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-700 dark:text-gray-300">
                {isAr ? 'الصلاحيات الفعالة الإجمالية:' : 'Total Effective Permissions:'}
              </span>
              <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200">
                {isActive ? `${effectivePermissions.length} / 10` : '0 / 10 (معطل)'}
              </span>
            </div>

            {isActive ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {effectivePermissions.map((perm) => (
                  <span
                    key={perm}
                    className="px-2 py-0.5 text-[10px] font-medium rounded-md bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 shadow-2xs flex items-center gap-1"
                  >
                    <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>{getPermissionLabel(perm, isAr)}</span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-gray-400 italic">
                {isAr ? 'لا توجد صلاحيات فعالة لحساب معطل.' : 'No effective permissions while account is inactive.'}
              </p>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-6 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-850/50 shrink-0">
          <span className="text-[11px] text-gray-400">
            {isAr ? 'المعرف الفني:' : 'Identity ID:'} <code className="font-mono">{user.id}</code>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl cursor-pointer transition-colors"
              id="cancel-user-edit-btn"
            >
              {isAr ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaved}
              className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl cursor-pointer shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
              id="save-user-edit-btn"
            >
              {isSaved ? (
                <>
                  <CheckCircle2 className="w-4 h-4 animate-spin" />
                  <span>{isAr ? 'جاري الحفظ...' : 'Saving...'}</span>
                </>
              ) : (
                <span>{isAr ? 'حفظ التعديلات' : 'Save Changes'}</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </AdminModalViewport>
  );
};
