import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Users, 
  UserPlus, 
  Search, 
  Shield, 
  ShieldAlert, 
  Edit3, 
  Sparkles
} from 'lucide-react';
import { AdminRole, AdminPermission } from '../../types/admin';
import type { AdminUser } from '../../types/admin';
import { AdminAccessService } from '../../services/adminAccess';
import { AdminUserManager } from '../../services/adminUserManager';
import { 
  ROLE_METADATA, 
  getRoleLabel, 
  getPermissionLabel,
  getStatusLabel 
} from './userFormatters';
import { UserEditorModal } from './UserEditorModal';
import { CreateUserModal } from './CreateUserModal';

interface AdminUsersManagementProps {
  currentUser: AdminUser;
  users: AdminUser[];
  onUpdateUser: (updatedUser: AdminUser) => void;
  onCreateUser: (newUser: AdminUser) => void;
}

export const AdminUsersManagement: React.FC<AdminUsersManagementProps> = ({
  currentUser,
  users,
  onUpdateUser,
  onCreateUser,
}) => {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  // Permission Gate
  const canManageUsers = AdminAccessService.hasPermission(currentUser, AdminPermission.ManageUsers);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<string>('ALL');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('ALL');

  // Modal State
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Metrics computation
  const totalCount = users.length;
  const activeCount = users.filter(u => u.isActive).length;
  const inactiveCount = users.filter(u => !u.isActive).length;
  const activeOwnersCount = AdminUserManager.getActiveOwnerCount(users);

  // Canonical Pipeline: Search & Filter
  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      // 1. Search Query
      const q = searchQuery.toLowerCase().trim();
      const roleLabel = getRoleLabel(user.role, isAr).toLowerCase();
      const matchesSearch = 
        !q ||
        user.name.toLowerCase().includes(q) ||
        user.email.toLowerCase().includes(q) ||
        user.role.toLowerCase().includes(q) ||
        roleLabel.includes(q);

      // 2. Role Filter
      const matchesRole = selectedRoleFilter === 'ALL' || user.role === selectedRoleFilter;

      // 3. Status Filter
      const matchesStatus = 
        selectedStatusFilter === 'ALL' ||
        (selectedStatusFilter === 'ACTIVE' && user.isActive) ||
        (selectedStatusFilter === 'INACTIVE' && !user.isActive);

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [users, searchQuery, selectedRoleFilter, selectedStatusFilter, isAr]);

  const handleOpenEditor = (user: AdminUser) => {
    setEditingUser(user);
    setIsEditorOpen(true);
  };

  if (!canManageUsers) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-8 text-center space-y-4 max-w-xl mx-auto my-8">
        <div className="h-16 w-16 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto border border-rose-200 dark:border-rose-900">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
          {isAr ? 'صلاحية غير كافية' : 'Permission Restricted'}
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          {isAr 
            ? `يتطلب استعراض وإدارة المستخدمين صلاحية [${AdminPermission.ManageUsers}]. دورك الحالي (${currentUser.role}) لا يمتلك هذا الإذن.`
            : `Managing users requires permission: [${AdminPermission.ManageUsers}]. Your current role (${currentUser.role}) does not have this privilege.`}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full max-w-full min-w-0" dir={isAr ? 'rtl' : 'ltr'}>
      {/* 1. Header & Quick Metrics Bar */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/80 dark:border-gray-800/80 p-4 sm:p-6 shadow-xs min-w-0 max-w-full">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-gray-100 dark:border-gray-800 min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-12 w-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-emerald-600/20">
              <Users className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <h2 className="text-base sm:text-xl font-extrabold text-gray-900 dark:text-gray-100 break-words min-w-0">
                  {isAr ? 'إدارة المستخدمين والصلاحيات (RBAC)' : 'Users & Access Controls (RBAC)'}
                </h2>
                <span className="px-2.5 py-0.5 text-[11px] font-bold rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 shrink-0">
                  {isAr ? 'محاكاة الهويات' : 'Demo Identities'}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {isAr 
                  ? 'إدارة الهويات الإدارية وتخصيص الأدوار ومراقبة الصلاحيات الفعالة وفق النموذج الهيكلي.'
                  : 'Manage administrative identities, assign canonical roles, and enforce RBAC invariants.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="w-full sm:w-auto px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-xs transition-all pop-hover-lift shrink-0"
            id="create-new-user-btn"
          >
            <UserPlus className="w-4 h-4" />
            <span>{isAr ? 'إضافة هوية إدارية' : 'Create Demo User'}</span>
          </button>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-5 min-w-0">
          <div className="bg-gray-50 dark:bg-gray-850/60 p-3 rounded-xl border border-gray-200/60 dark:border-gray-750 min-w-0">
            <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400 truncate">
              {isAr ? 'إجمالي الهويات' : 'Total Identities'}
            </p>
            <p className="text-xl font-extrabold text-gray-900 dark:text-gray-100 mt-0.5">
              {totalCount}
            </p>
          </div>

          <div className="bg-emerald-50/50 dark:bg-emerald-950/20 p-3 rounded-xl border border-emerald-200/60 dark:border-emerald-900/40 min-w-0">
            <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 truncate">
              {isAr ? 'الهويات النشطة' : 'Active Users'}
            </p>
            <p className="text-xl font-extrabold text-emerald-800 dark:text-emerald-300 mt-0.5">
              {activeCount}
            </p>
          </div>

          <div className="bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-200/60 dark:border-slate-800 min-w-0">
            <p className="text-[11px] font-bold text-slate-600 dark:text-slate-400 truncate">
              {isAr ? 'الهويات المعطلة' : 'Inactive Users'}
            </p>
            <p className="text-xl font-extrabold text-slate-800 dark:text-slate-300 mt-0.5">
              {inactiveCount}
            </p>
          </div>

          <div className="bg-rose-50/50 dark:bg-rose-950/20 p-3 rounded-xl border border-rose-200/60 dark:border-rose-900/40 min-w-0">
            <p className="text-[11px] font-bold text-rose-700 dark:text-rose-400 truncate">
              {isAr ? 'المالكون النشطون' : 'Active Owners'}
            </p>
            <p className="text-xl font-extrabold text-rose-800 dark:text-rose-300 mt-0.5">
              {activeOwnersCount}
            </p>
          </div>
        </div>
      </div>

      {/* 2. Search & Filter Bar */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/80 dark:border-gray-800/80 p-4 shadow-xs space-y-3 min-w-0 max-w-full">
        <div className="flex flex-col md:flex-row gap-3 min-w-0">
          {/* Search Input */}
          <div className="relative flex-1 min-w-0">
            <div className="absolute inset-y-0 start-0 flex items-center ps-3.5 pointer-events-none text-gray-400">
              <Search className="w-4 h-4" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isAr ? 'البحث بالاسم، البريد، أو الدور الإداري...' : 'Search by name, email, or role...'}
              className="w-full min-w-0 ps-10 pe-4 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-hidden focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
              id="users-search-input"
            />
          </div>

          {/* Role Filter & Status Filter - Stacked / Responsive grid at mobile phone widths */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:flex md:items-center gap-2 min-w-0">
            <div className="relative min-w-0 w-full sm:w-auto">
              <select
                value={selectedRoleFilter}
                onChange={(e) => setSelectedRoleFilter(e.target.value)}
                className="w-full sm:w-auto min-w-0 max-w-full truncate px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-semibold text-gray-800 dark:text-gray-200 focus:outline-hidden focus:border-emerald-500 cursor-pointer"
                id="role-filter-select"
              >
                <option value="ALL">{isAr ? 'جميع الأدوار' : 'All Roles'}</option>
                {Object.values(AdminRole).map((role) => (
                  <option key={role} value={role}>
                    {getRoleLabel(role, isAr)}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div className="relative min-w-0 w-full sm:w-auto">
              <select
                value={selectedStatusFilter}
                onChange={(e) => setSelectedStatusFilter(e.target.value)}
                className="w-full sm:w-auto min-w-0 max-w-full truncate px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-semibold text-gray-800 dark:text-gray-200 focus:outline-hidden focus:border-emerald-500 cursor-pointer"
                id="status-filter-select"
              >
                <option value="ALL">{isAr ? 'جميع الحالات' : 'All Statuses'}</option>
                <option value="ACTIVE">{isAr ? 'نشط فقط' : 'Active Only'}</option>
                <option value="INACTIVE">{isAr ? 'معطل فقط' : 'Inactive Only'}</option>
              </select>
            </div>
          </div>
        </div>

        {/* Filter Summary Results */}
        <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400 pt-1 border-t border-gray-100 dark:border-gray-800 flex-wrap gap-1 min-w-0">
          <span className="min-w-0 truncate">
            {isAr 
              ? `عرض ${filteredUsers.length} من إجمالي ${totalCount} هوية`
              : `Showing ${filteredUsers.length} of ${totalCount} identities`}
          </span>
          {(searchQuery || selectedRoleFilter !== 'ALL' || selectedStatusFilter !== 'ALL') && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedRoleFilter('ALL');
                setSelectedStatusFilter('ALL');
              }}
              className="text-emerald-600 dark:text-emerald-400 font-bold hover:underline cursor-pointer shrink-0"
            >
              {isAr ? 'إعادة ضبط التصفية' : 'Reset Filters'}
            </button>
          )}
        </div>
      </div>

      {/* 3. Empty State */}
      {filteredUsers.length === 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-12 text-center space-y-3 shadow-xs min-w-0 max-w-full">
          <div className="h-12 w-12 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400 flex items-center justify-center mx-auto">
            <Search className="w-6 h-6" />
          </div>
          <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">
            {isAr ? 'لا توجد نتائج مطابقة' : 'No identities match your criteria'}
          </h4>
          <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
            {isAr 
              ? 'جرّب تعديل مصطلحات البحث أو تغيير خيارات التصفية للأدوار والحالة.'
              : 'Try adjusting your search terms or clearing the role/status filters.'}
          </p>
        </div>
      )}

      {/* 4. Responsive Data Presentation */}
      {filteredUsers.length > 0 && (
        <>
          {/* A. Compact Cards (< 1280px / xl breakpoint) */}
          <div className="xl:hidden grid grid-cols-1 md:grid-cols-2 gap-3.5 min-w-0 max-w-full" id="users-compact-cards-view">
            {filteredUsers.map((user) => {
              const isCurrentSession = user.id === currentUser.id;
              const isLastActive = AdminUserManager.isLastActiveOwner(user, users);
              const permissions = Array.from(AdminAccessService.getPermissionsForRole(user.role));
              const meta = ROLE_METADATA[user.role];

              return (
                <div
                  key={user.id}
                  className={`bg-white dark:bg-gray-900 rounded-2xl border p-4 shadow-xs transition-all space-y-3.5 relative overflow-hidden min-w-0 max-w-full ${
                    isCurrentSession 
                      ? 'border-emerald-500/50 dark:border-emerald-500/50 bg-emerald-50/20 dark:bg-emerald-950/10' 
                      : 'border-gray-200/80 dark:border-gray-800/80'
                  }`}
                >
                  {/* Top Bar with Name & Status */}
                  <div className="flex items-start justify-between gap-2 min-w-0">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 border ${meta.badgeColorClass}`}>
                        <span className="font-extrabold text-sm uppercase">{user.name.charAt(0)}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                          <h4 className="text-xs sm:text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
                            {user.name}
                          </h4>
                          {isCurrentSession && (
                            <span className="px-1.5 py-0.2 text-[9px] font-extrabold rounded-md bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 shrink-0">
                              {isAr ? 'الجلسة' : 'Active'}
                            </span>
                          )}
                          {isLastActive && (
                            <span className="px-1.5 py-0.2 text-[9px] font-extrabold rounded-md bg-rose-100 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-800 shrink-0">
                              {isAr ? 'المالك الأخير' : 'Last Owner'}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                          {user.email}
                        </p>
                      </div>
                    </div>

                    <span className={`px-2 py-0.5 text-[10px] font-extrabold rounded-full flex items-center gap-1 shrink-0 ${
                      user.isActive 
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900' 
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border border-gray-200 dark:border-gray-700'
                    }`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${user.isActive ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                      {getStatusLabel(user.isActive, isAr)}
                    </span>
                  </div>

                  {/* Role & Summary */}
                  <div className="pt-2 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between flex-wrap gap-2 min-w-0">
                    <span className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border flex items-center gap-1.5 max-w-full truncate ${meta.badgeColorClass}`}>
                      <Shield className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{getRoleLabel(user.role, isAr)}</span>
                    </span>

                    <span className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1 shrink-0">
                      <Sparkles className="w-3 h-3 text-emerald-600 shrink-0" />
                      <span>
                        {user.isActive 
                          ? `${permissions.length} ${isAr ? 'صلاحيات' : 'perms'}` 
                          : `${isAr ? 'محظور الصلاحيات' : '0 perms (inactive)'}`}
                      </span>
                    </span>
                  </div>

                  {/* Action Button */}
                  <div className="pt-2 border-t border-gray-100 dark:border-gray-800 flex justify-end">
                    <button
                      type="button"
                      onClick={() => handleOpenEditor(user)}
                      className="w-full py-2 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 text-gray-800 dark:text-gray-200 text-xs font-bold rounded-xl border border-gray-200/80 dark:border-gray-700/80 flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <Edit3 className="w-3.5 h-3.5 shrink-0" />
                      <span>{isAr ? 'فحص وتعديل الهوية' : 'Inspect / Edit Identity'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* B. Dense Desktop Table (>= 1280px / xl breakpoint) */}
          <div className="hidden xl:block bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/80 dark:border-gray-800/80 shadow-xs overflow-hidden" id="users-dense-table-view">
            <table className="w-full text-start border-collapse">
              <thead>
                <tr className="border-b border-gray-200/80 dark:border-gray-800/80 bg-gray-50/70 dark:bg-gray-850/70 text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  <th className="py-3.5 px-4 text-start">{isAr ? 'الهوية والمستخدم' : 'Identity & User'}</th>
                  <th className="py-3.5 px-4 text-start">{isAr ? 'البريد الإلكتروني' : 'Email Address'}</th>
                  <th className="py-3.5 px-4 text-start">{isAr ? 'الدور المعتمد (Role)' : 'Assigned Role'}</th>
                  <th className="py-3.5 px-4 text-start">{isAr ? 'الحالة' : 'Status'}</th>
                  <th className="py-3.5 px-4 text-start">{isAr ? 'الصلاحيات الفعالة' : 'Effective Permissions'}</th>
                  <th className="py-3.5 px-4 text-end">{isAr ? 'الإجراءات' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-xs text-gray-800 dark:text-gray-200">
                {filteredUsers.map((user) => {
                  const isCurrentSession = user.id === currentUser.id;
                  const isLastActive = AdminUserManager.isLastActiveOwner(user, users);
                  const permissions = Array.from(AdminAccessService.getPermissionsForRole(user.role));
                  const meta = ROLE_METADATA[user.role];

                  return (
                    <tr 
                      key={user.id}
                      className={`hover:bg-gray-50/60 dark:hover:bg-gray-800/50 transition-colors ${
                        isCurrentSession ? 'bg-emerald-50/20 dark:bg-emerald-950/10' : ''
                      }`}
                    >
                      {/* Identity & Name */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 border font-bold text-xs uppercase ${meta.badgeColorClass}`}>
                            {user.name.charAt(0)}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-gray-900 dark:text-gray-100">{user.name}</span>
                              {isCurrentSession && (
                                <span className="px-1.5 py-0.2 text-[9px] font-extrabold rounded-md bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                                  {isAr ? 'الجلسة' : 'Session'}
                                </span>
                              )}
                              {isLastActive && (
                                <span className="px-1.5 py-0.2 text-[9px] font-extrabold rounded-md bg-rose-100 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                                  {isAr ? 'المالك الأخير' : 'Last Owner'}
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-gray-400 font-mono">{user.id}</span>
                          </div>
                        </div>
                      </td>

                      {/* Email */}
                      <td className="py-3 px-4 font-mono text-gray-600 dark:text-gray-300">
                        {user.email}
                      </td>

                      {/* Role */}
                      <td className="py-3 px-4">
                        <span className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border inline-flex items-center gap-1.5 ${meta.badgeColorClass}`}>
                          <Shield className="w-3.5 h-3.5" />
                          <span>{getRoleLabel(user.role, isAr)}</span>
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4">
                        <span className={`px-2.5 py-0.5 text-[10px] font-extrabold rounded-full inline-flex items-center gap-1.5 ${
                          user.isActive 
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900' 
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border border-gray-200 dark:border-gray-700'
                        }`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${user.isActive ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                          {getStatusLabel(user.isActive, isAr)}
                        </span>
                      </td>

                      {/* Effective Permissions Count & Preview */}
                      <td className="py-3 px-4">
                        {user.isActive ? (
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300">
                              {permissions.length} / 10
                            </span>
                            <span className="text-[10px] text-gray-400 truncate max-w-[180px]">
                              {permissions.map(p => getPermissionLabel(p, isAr)).slice(0, 3).join('، ')}
                              {permissions.length > 3 ? '...' : ''}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-gray-400 italic">
                            {isAr ? '0 صلاحيات (معطل)' : '0 permissions (inactive)'}
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-end">
                        <button
                          type="button"
                          onClick={() => handleOpenEditor(user)}
                          className="px-3 py-1.5 bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-750 text-gray-800 dark:text-gray-200 font-bold rounded-lg border border-gray-200 dark:border-gray-700 text-xs inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>{isAr ? 'تعديل' : 'Inspect'}</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* 5. Modals */}
      {editingUser && (
        <UserEditorModal
          isOpen={isEditorOpen}
          onClose={() => {
            setIsEditorOpen(false);
            setEditingUser(null);
          }}
          user={editingUser}
          currentSessionUser={currentUser}
          allUsers={users}
          onUpdateUser={onUpdateUser}
        />
      )}

      <CreateUserModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        existingUsers={users}
        onUserCreated={onCreateUser}
      />
    </div>
  );
};
