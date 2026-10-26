import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Users,
  Search,
  Shield,
  ShieldAlert,
  Sparkles,
  RefreshCw,
  AlertTriangle,
  WifiOff,
  Loader2,
  Lock,
  MailPlus,
} from 'lucide-react';
import {
  AdminRole,
  AdminPermission,
  AdminDomain,
  isTabAuthorized,
  isValidAdminRole,
} from '../../types/admin';
import type { AdminUser } from '../../types/admin';
import { AdminAccessService } from '../../services/adminAccess';
import { AdminUserManager } from '../../services/adminUserManager';
import {
  AdminIdentityClientError,
  listAdminUsers,
  type AdminIdentityClientDependencies,
  type CreateAdminInvitationClientInput,
  type CreateAdminInvitationClientResponse,
  type ListAdminUsersClientResponse,
} from '../../services/adminIdentityManagementClient';
import {
  ROLE_METADATA,
  getRoleLabel,
  getPermissionLabel,
  getStatusLabel,
} from './userFormatters';
import { UserEditorModal } from './UserEditorModal';
import { CreateUserModal } from './CreateUserModal';
import {
  AdminInvitationCreationPanel,
  isAuthorizedToCreateAdminInvitation,
  type AdminInvitationSubmissionSnapshot,
} from './AdminInvitationCreationPanel';

export const ADMIN_DIRECTORY_MUTATION_DISABLED_NOTICE_AR =
  'إدارة الهويات الإدارية قيد الربط بالخدمة الخادمية الآمنة. لا يمكن إنشاء أو تعديل مستخدم إداري من هذه الواجهة حاليًا.';

export const ADMIN_DIRECTORY_MUTATION_DISABLED_NOTICE_EN =
  'Administrative identity management is being connected to the secure server service. Creating or editing administrators is currently unavailable.';

export type AdminDirectoryViewStatus =
  | 'loading'
  | 'loaded'
  | 'empty'
  | 'unauthorized'
  | 'unavailable'
  | 'malformed';

export interface AdminDirectoryStateSnapshot {
  readonly status: AdminDirectoryViewStatus;
  readonly users: ReadonlyArray<AdminUser>;
  readonly requestGeneration: number;
  readonly boundUserUid: string | null;
  readonly boundTabId: string;
}

export interface AdminDirectoryFilterCriteria {
  readonly searchQuery: string;
  readonly selectedRoleFilter: string;
  readonly selectedStatusFilter: string;
  readonly isAr: boolean;
}

export interface AdminUsersManagementProps {
  currentUser: AdminUser;
  activeTabId?: string;
  clientDeps?: AdminIdentityClientDependencies;
  loadDirectory?: () => Promise<ListAdminUsersClientResponse>;
  initialDirectoryState?: {
    readonly status: AdminDirectoryViewStatus;
    readonly users?: ReadonlyArray<AdminUser>;
  };
  initialInvitationPanelOpen?: boolean;
  initialInvitationSubmissionState?: Partial<AdminInvitationSubmissionSnapshot>;
  invokeCreateInvitation?: (
    input: CreateAdminInvitationClientInput
  ) => Promise<CreateAdminInvitationClientResponse>;
  users?: AdminUser[];
  onUpdateUser?: (updatedUser: AdminUser) => void;
  onCreateUser?: (newUser: AdminUser) => void;
}

const CANONICAL_ADMIN_KEYS = new Set<string>([
  'id',
  'name',
  'email',
  'role',
  'isActive',
]);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isAuthorizedOwnerForUsersDirectory(
  user: AdminUser | null | undefined,
  activeTabId: string = 'users'
): boolean {
  if (!user || typeof user !== 'object' || user.isActive !== true) {
    return false;
  }
  if (typeof user.id !== 'string' || !user.id.trim()) {
    return false;
  }
  if (user.role !== AdminRole.Owner) {
    return false;
  }
  if (activeTabId !== 'users') {
    return false;
  }
  if (!isTabAuthorized(user, AdminDomain.Users, AdminPermission.ManageUsers)) {
    return false;
  }
  if (!AdminAccessService.hasPermission(user, AdminPermission.ManageUsers)) {
    return false;
  }
  return true;
}

export function validateCanonicalDirectoryUsersList(
  rawResponse: unknown
): ReadonlyArray<AdminUser> {
  if (
    !rawResponse ||
    typeof rawResponse !== 'object' ||
    Array.isArray(rawResponse)
  ) {
    throw new AdminIdentityClientError(
      'internal',
      'INVALID_SERVER_RESPONSE'
    );
  }

  const record = rawResponse as Record<string, unknown>;
  const topKeys = Object.keys(record);
  if (topKeys.length !== 1 || topKeys[0] !== 'admins' || !Array.isArray(record.admins)) {
    throw new AdminIdentityClientError(
      'internal',
      'INVALID_SERVER_RESPONSE'
    );
  }

  const seenIds = new Set<string>();
  const validated: AdminUser[] = [];

  for (const item of record.admins) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new AdminIdentityClientError(
        'internal',
        'MALFORMED_ADMIN_RECORD'
      );
    }

    const entry = item as Record<string, unknown>;
    const keys = Object.keys(entry);
    if (
      keys.length !== CANONICAL_ADMIN_KEYS.size ||
      keys.some((k) => !CANONICAL_ADMIN_KEYS.has(k))
    ) {
      throw new AdminIdentityClientError(
        'internal',
        'MALFORMED_ADMIN_RECORD'
      );
    }

    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!id || id !== entry.id || /\s/.test(id)) {
      throw new AdminIdentityClientError(
        'internal',
        'MALFORMED_ADMIN_RECORD'
      );
    }

    if (seenIds.has(id)) {
      throw new AdminIdentityClientError(
        'internal',
        'DUPLICATE_ADMIN_UID'
      );
    }

    if (!isValidAdminRole(entry.role)) {
      throw new AdminIdentityClientError(
        'internal',
        'INVALID_ADMIN_ROLE'
      );
    }

    if (typeof entry.isActive !== 'boolean') {
      throw new AdminIdentityClientError(
        'internal',
        'MALFORMED_ADMIN_RECORD'
      );
    }

    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    const email = typeof entry.email === 'string' ? entry.email.trim() : '';
    if (
      !name ||
      name !== entry.name ||
      !email ||
      email !== entry.email ||
      email.length > 254 ||
      !EMAIL_REGEX.test(email) ||
      email.includes('..')
    ) {
      throw new AdminIdentityClientError(
        'internal',
        'MALFORMED_ADMIN_RECORD'
      );
    }

    seenIds.add(id);
    validated.push(
      Object.freeze({
        id,
        name,
        email,
        role: entry.role,
        isActive: entry.isActive,
      })
    );
  }

  return Object.freeze(validated);
}

export function classifyDirectoryLoadFailure(
  error: unknown
): Exclude<AdminDirectoryViewStatus, 'loading' | 'loaded' | 'empty'> {
  if (error instanceof AdminIdentityClientError) {
    if (
      error.code === 'unauthenticated' ||
      error.code === 'permission-denied'
    ) {
      return 'unauthorized';
    }
    if (error.code === 'unavailable') {
      return 'unavailable';
    }
    return 'malformed';
  }

  if (error && typeof error === 'object') {
    const rawCode = String((error as Record<string, unknown>).code ?? '')
      .trim()
      .toLowerCase()
      .replace(/^functions\//, '');
    if (rawCode === 'unauthenticated' || rawCode === 'permission-denied') {
      return 'unauthorized';
    }
    if (rawCode === 'unavailable' || rawCode === 'deadline-exceeded') {
      return 'unavailable';
    }
  }

  return 'malformed';
}

export function filterAdminDirectoryEntries(
  users: ReadonlyArray<AdminUser>,
  criteria: AdminDirectoryFilterCriteria
): AdminUser[] {
  const q = criteria.searchQuery.toLowerCase().trim();
  return users.filter((user) => {
    const roleLabel = getRoleLabel(user.role, criteria.isAr).toLowerCase();
    const matchesSearch =
      !q ||
      user.name.toLowerCase().includes(q) ||
      user.email.toLowerCase().includes(q) ||
      user.role.toLowerCase().includes(q) ||
      roleLabel.includes(q);

    const matchesRole =
      criteria.selectedRoleFilter === 'ALL' ||
      user.role === criteria.selectedRoleFilter;

    const matchesStatus =
      criteria.selectedStatusFilter === 'ALL' ||
      (criteria.selectedStatusFilter === 'ACTIVE' && user.isActive) ||
      (criteria.selectedStatusFilter === 'INACTIVE' && !user.isActive);

    return matchesSearch && matchesRole && matchesStatus;
  });
}

export class AdminDirectoryLoadController {
  private snapshot: AdminDirectoryStateSnapshot;
  private isMounted = true;
  private readonly listeners = new Set<
    (snapshot: AdminDirectoryStateSnapshot) => void
  >();

  constructor(initial?: {
    readonly status?: AdminDirectoryViewStatus;
    readonly users?: ReadonlyArray<AdminUser>;
    readonly boundUserUid?: string | null;
    readonly boundTabId?: string;
  }) {
    const initialStatus = initial?.status ?? 'loading';
    const initialUsers =
      initialStatus === 'loaded' && initial?.users
        ? Object.freeze([...initial.users])
        : Object.freeze([]);
    this.snapshot = Object.freeze({
      status: initialStatus,
      users: initialUsers,
      requestGeneration: 0,
      boundUserUid: initial?.boundUserUid ?? null,
      boundTabId: initial?.boundTabId ?? 'users',
    });
  }

  public mount(): void {
    this.isMounted = true;
  }

  public unmount(): void {
    this.isMounted = false;
    this.snapshot = Object.freeze({
      ...this.snapshot,
      requestGeneration: this.snapshot.requestGeneration + 1,
    });
  }

  public getSnapshot(): AdminDirectoryStateSnapshot {
    return this.snapshot;
  }

  public subscribe(
    listener: (snapshot: AdminDirectoryStateSnapshot) => void
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(next: AdminDirectoryStateSnapshot): void {
    this.snapshot = Object.freeze(next);
    if (!this.isMounted) {
      return;
    }
    this.listeners.forEach((listener) => listener(this.snapshot));
  }

  public syncContext(
    user: AdminUser | null | undefined,
    activeTabId: string = 'users'
  ): boolean {
    const nextGeneration = this.snapshot.requestGeneration + 1;
    if (!isAuthorizedOwnerForUsersDirectory(user, activeTabId)) {
      this.emit({
        status: 'unauthorized',
        users: Object.freeze([]),
        requestGeneration: nextGeneration,
        boundUserUid: user?.id ?? null,
        boundTabId: activeTabId,
      });
      return false;
    }
    return true;
  }

  public async loadDirectory(
    user: AdminUser | null | undefined,
    activeTabId: string = 'users',
    loader: () => Promise<ListAdminUsersClientResponse>
  ): Promise<AdminDirectoryStateSnapshot> {
    const generation = this.snapshot.requestGeneration + 1;
    const boundUid = user?.id ?? null;

    if (!isAuthorizedOwnerForUsersDirectory(user, activeTabId)) {
      this.emit({
        status: 'unauthorized',
        users: Object.freeze([]),
        requestGeneration: generation,
        boundUserUid: boundUid,
        boundTabId: activeTabId,
      });
      return this.snapshot;
    }

    this.emit({
      status: 'loading',
      users: Object.freeze([]),
      requestGeneration: generation,
      boundUserUid: boundUid,
      boundTabId: activeTabId,
    });

    try {
      const response = await loader();

      if (
        !this.isMounted ||
        this.snapshot.requestGeneration !== generation ||
        this.snapshot.boundUserUid !== boundUid ||
        this.snapshot.boundTabId !== activeTabId ||
        !isAuthorizedOwnerForUsersDirectory(user, activeTabId)
      ) {
        return this.snapshot;
      }

      const validatedUsers = validateCanonicalDirectoryUsersList(response);

      this.emit({
        status: validatedUsers.length === 0 ? 'empty' : 'loaded',
        users: validatedUsers,
        requestGeneration: generation,
        boundUserUid: boundUid,
        boundTabId: activeTabId,
      });
      return this.snapshot;
    } catch (error: unknown) {
      if (
        !this.isMounted ||
        this.snapshot.requestGeneration !== generation ||
        this.snapshot.boundUserUid !== boundUid ||
        this.snapshot.boundTabId !== activeTabId
      ) {
        return this.snapshot;
      }

      const failureStatus = classifyDirectoryLoadFailure(error);
      this.emit({
        status: failureStatus,
        users: Object.freeze([]),
        requestGeneration: generation,
        boundUserUid: boundUid,
        boundTabId: activeTabId,
      });
      return this.snapshot;
    }
  }
}

const NOOP_USER_MUTATION = (_user: AdminUser): void => {
  // Local administrative user creation and mutation are disabled in AUTH-03C2.
};

export const AdminUsersManagement: React.FC<AdminUsersManagementProps> = ({
  currentUser,
  activeTabId = 'users',
  clientDeps,
  loadDirectory,
  initialDirectoryState,
  initialInvitationPanelOpen = false,
  initialInvitationSubmissionState,
  invokeCreateInvitation,
}) => {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  const isAuthorizedOwner = isAuthorizedOwnerForUsersDirectory(
    currentUser,
    activeTabId
  );

  const canCreateInvitation = isAuthorizedToCreateAdminInvitation(
    currentUser,
    activeTabId
  );

  const controllerRef = useRef<AdminDirectoryLoadController | null>(null);
  if (!controllerRef.current) {
    let initialStatus: AdminDirectoryViewStatus = isAuthorizedOwner
      ? 'loading'
      : 'unauthorized';
    let initialUsers: ReadonlyArray<AdminUser> = [];

    if (isAuthorizedOwner && initialDirectoryState) {
      if (initialDirectoryState.status === 'loaded') {
        try {
          const validated = validateCanonicalDirectoryUsersList({
            admins: initialDirectoryState.users ?? [],
          });
          initialStatus = validated.length === 0 ? 'empty' : 'loaded';
          initialUsers = validated;
        } catch {
          initialStatus = 'malformed';
          initialUsers = [];
        }
      } else {
        initialStatus = initialDirectoryState.status;
        initialUsers = [];
      }
    }

    controllerRef.current = new AdminDirectoryLoadController({
      status: initialStatus,
      users: initialUsers,
      boundUserUid: currentUser?.id ?? null,
      boundTabId: activeTabId,
    });
  }

  const [directorySnapshot, setDirectorySnapshot] =
    useState<AdminDirectoryStateSnapshot>(() =>
      controllerRef.current!.getSnapshot()
    );

  const [isInvitationPanelOpen, setIsInvitationPanelOpen] = useState<boolean>(
    () => Boolean(initialInvitationPanelOpen && canCreateInvitation)
  );

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<string>('ALL');
  const [selectedStatusFilter, setSelectedStatusFilter] =
    useState<string>('ALL');

  const executeDirectoryLoad = useCallback(async () => {
    const controller = controllerRef.current;
    if (!controller) return;
    const loader =
      loadDirectory ?? (() => listAdminUsers(clientDeps));
    await controller.loadDirectory(currentUser, activeTabId, loader);
  }, [currentUser, activeTabId, clientDeps, loadDirectory]);

  useEffect(() => {
    const controller = controllerRef.current!;
    controller.mount();
    const unsubscribe = controller.subscribe((nextSnap) => {
      setDirectorySnapshot(nextSnap);
    });

    if (!isAuthorizedOwner) {
      controller.syncContext(currentUser, activeTabId);
    } else if (!initialDirectoryState) {
      void executeDirectoryLoad();
    }

    return () => {
      unsubscribe();
      controller.unmount();
    };
  }, [
    currentUser,
    activeTabId,
    isAuthorizedOwner,
    initialDirectoryState,
    executeDirectoryLoad,
  ]);

  useEffect(() => {
    if (!canCreateInvitation && isInvitationPanelOpen) {
      setIsInvitationPanelOpen(false);
    }
  }, [canCreateInvitation, isInvitationPanelOpen]);

  const effectiveStatus: AdminDirectoryViewStatus = isAuthorizedOwner
    ? directorySnapshot.status
    : 'unauthorized';

  const canonicalUsers: AdminUser[] = useMemo(() => {
    if (effectiveStatus !== 'loaded') {
      return [];
    }
    return [...directorySnapshot.users];
  }, [effectiveStatus, directorySnapshot.users]);

  // Metrics computation strictly from canonical server records
  const totalCount = canonicalUsers.length;
  const activeCount = canonicalUsers.filter((u) => u.isActive).length;
  const inactiveCount = canonicalUsers.filter((u) => !u.isActive).length;
  const activeOwnersCount = AdminUserManager.getActiveOwnerCount(canonicalUsers);

  // Canonical Pipeline: Search & Filter
  const filteredUsers = useMemo(() => {
    return filterAdminDirectoryEntries(canonicalUsers, {
      searchQuery,
      selectedRoleFilter,
      selectedStatusFilter,
      isAr,
    });
  }, [
    canonicalUsers,
    searchQuery,
    selectedRoleFilter,
    selectedStatusFilter,
    isAr,
  ]);

  // Unauthorized Gate (either caller lacks active Owner/ManageUsers/Users domain or server rejected authorization)
  if (!isAuthorizedOwner || effectiveStatus === 'unauthorized') {
    return (
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-8 text-center space-y-4 max-w-xl mx-auto my-8"
        dir={isAr ? 'rtl' : 'ltr'}
        data-testid="admin-directory-unauthorized-state"
      >
        <div className="h-16 w-16 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto border border-rose-200 dark:border-rose-900">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
          {isAr
            ? 'غير مصرح بالوصول إلى دليل الهويات الإدارية'
            : 'Unauthorized Access to Administrative Directory'}
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          {isAr
            ? `يتطلب استعراض دليل المشرفين حساب مالك نشط (Owner) بصلاحية [${AdminPermission.ManageUsers}] مصادق عليه من الخادم. لم يتم عرض أي سجلات إدارية.`
            : `Viewing the administrative user directory requires an active server-verified Owner account with [${AdminPermission.ManageUsers}] permission. No directory records are displayed.`}
        </p>
      </div>
    );
  }

  return (
    <div
      className="space-y-6 w-full max-w-full min-w-0"
      dir={isAr ? 'rtl' : 'ltr'}
      data-testid="admin-users-management-root"
    >
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
                  {isAr
                    ? 'إدارة المستخدمين والصلاحيات (RBAC)'
                    : 'Users & Access Controls (RBAC)'}
                </h2>
                <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 shrink-0">
                  {isAr
                    ? '· دليل خادمي (للقراءة فقط)'
                    : '· Server Directory (Read-Only)'}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {isAr
                  ? 'استعراض الهويات الإدارية الفعلية المسجلة في الخادم ومراقبة الأدوار والصلاحيات الفعالة.'
                  : 'Inspect canonical server-verified administrative identities, assigned roles, and effective permissions.'}
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
            {canCreateInvitation && (
              <button
                type="button"
                onClick={() => setIsInvitationPanelOpen((prev) => !prev)}
                aria-expanded={isInvitationPanelOpen}
                className="w-full sm:w-auto px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-colors shrink-0 whitespace-nowrap"
                data-testid="open-admin-invitation-panel-btn"
              >
                <MailPlus className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {isInvitationPanelOpen
                    ? isAr
                      ? 'إخفاء نافذة الدعوة المعلقة'
                      : 'Hide Pending Invitation Form'
                    : isAr
                      ? 'إنشاء دعوة إدارية معلقة'
                      : 'Create Pending Invitation'}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => void executeDirectoryLoad()}
              disabled={effectiveStatus === 'loading'}
              className="w-full sm:w-auto px-3.5 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 text-xs font-bold rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-50 shrink-0 whitespace-nowrap"
              data-testid="admin-directory-refresh-btn"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 shrink-0 ${
                  effectiveStatus === 'loading' ? 'animate-spin' : ''
                }`}
              />
              <span>{isAr ? 'تحديث الدليل' : 'Refresh Directory'}</span>
            </button>
          </div>
        </div>

        {/* Bilingual Read-Only Notice (Mutating Actions Disabled in AUTH-03C2) */}
        <div
          className="mt-4 p-3.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/60 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200"
          role="status"
          data-testid="admin-directory-mutation-disabled-notice"
        >
          <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1 min-w-0">
            <p className="font-semibold leading-relaxed">
              {isAr
                ? ADMIN_DIRECTORY_MUTATION_DISABLED_NOTICE_AR
                : ADMIN_DIRECTORY_MUTATION_DISABLED_NOTICE_EN}
            </p>
          </div>
        </div>

        {/* Metrics Grid (only shown when server response is loaded or genuinely empty) */}
        {(effectiveStatus === 'loaded' || effectiveStatus === 'empty') && (
          <div
            className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-5 min-w-0 tabular-nums"
            data-testid="admin-directory-metrics-grid"
          >
            <div className="bg-gray-50 dark:bg-gray-850/60 p-3 rounded-xl border border-gray-200/60 dark:border-gray-750 min-w-0">
              <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400 truncate">
                {isAr ? 'إجمالي الهويات' : 'Total Identities'}
              </p>
              <p
                className="text-xl font-extrabold text-gray-900 dark:text-gray-100 mt-0.5 tabular-nums"
                data-testid="metric-total-identities"
              >
                {totalCount}
              </p>
            </div>

            <div className="bg-emerald-50/50 dark:bg-emerald-950/20 p-3 rounded-xl border border-emerald-200/60 dark:border-emerald-900/40 min-w-0">
              <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 truncate">
                {isAr ? 'الهويات النشطة' : 'Active Users'}
              </p>
              <p
                className="text-xl font-extrabold text-emerald-800 dark:text-emerald-300 mt-0.5 tabular-nums"
                data-testid="metric-active-users"
              >
                {activeCount}
              </p>
            </div>

            <div className="bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-200/60 dark:border-slate-800 min-w-0">
              <p className="text-[11px] font-bold text-slate-600 dark:text-slate-400 truncate">
                {isAr ? 'الهويات المعطلة' : 'Inactive Users'}
              </p>
              <p
                className="text-xl font-extrabold text-slate-800 dark:text-slate-300 mt-0.5 tabular-nums"
                data-testid="metric-inactive-users"
              >
                {inactiveCount}
              </p>
            </div>

            <div className="bg-rose-50/50 dark:bg-rose-950/20 p-3 rounded-xl border border-rose-200/60 dark:border-rose-900/40 min-w-0">
              <p className="text-[11px] font-bold text-rose-700 dark:text-rose-400 truncate">
                {isAr ? 'المالكون النشطون' : 'Active Owners'}
              </p>
              <p
                className="text-xl font-extrabold text-rose-800 dark:text-rose-300 mt-0.5 tabular-nums"
                data-testid="metric-active-owners"
              >
                {activeOwnersCount}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 1B. Owner-Only Pending Invitation Creation Panel (AUTH-03C3) */}
      {canCreateInvitation && isInvitationPanelOpen && (
        <AdminInvitationCreationPanel
          currentUser={currentUser}
          activeTabId={activeTabId}
          existingDirectoryUsers={canonicalUsers}
          clientDeps={clientDeps}
          invokeCreateInvitation={invokeCreateInvitation}
          initialSubmissionState={initialInvitationSubmissionState}
          onClose={() => setIsInvitationPanelOpen(false)}
        />
      )}

      {/* 2A. Loading State */}
      {effectiveStatus === 'loading' && (
        <div
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-12 text-center space-y-3 shadow-xs min-w-0 max-w-full"
          data-testid="admin-directory-loading-state"
        >
          <div className="h-12 w-12 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
          <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">
            {isAr
              ? 'جاري تحميل دليل الهويات الإدارية من الخادم...'
              : 'Loading administrative directory from server...'}
          </h4>
          <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md mx-auto">
            {isAr
              ? 'يتم التحقق من الصلاحيات واسترجاع السجلات الفعلية من الخدمة الخادمية المعتمدة.'
              : 'Verifying authority and retrieving canonical administrative records from the server service.'}
          </p>
        </div>
      )}

      {/* 2B. Network / Service Unavailable State */}
      {effectiveStatus === 'unavailable' && (
        <div
          className="bg-white dark:bg-gray-900 rounded-2xl border border-amber-200 dark:border-amber-900/60 p-10 text-center space-y-4 shadow-xs min-w-0 max-w-full"
          data-testid="admin-directory-unavailable-state"
        >
          <div className="h-12 w-12 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
            <WifiOff className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">
              {isAr
                ? 'خدمة دليل المشرفين غير متاحة حالياً'
                : 'Administrative Directory Service Unavailable'}
            </h4>
            <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md mx-auto">
              {isAr
                ? 'تعذر الاتصال بالخدمة الخادمية لدليل الهويات الإدارية. لم يتم عرض أي بيانات محلية أو افتراضية.'
                : 'Could not reach the server-authoritative administrative directory service. No local or mock fallback data is shown.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void executeDirectoryLoad()}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl inline-flex items-center gap-2 cursor-pointer transition-colors"
            data-testid="admin-directory-retry-btn"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{isAr ? 'إعادة المحاولة' : 'Retry'}</span>
          </button>
        </div>
      )}

      {/* 2C. Malformed Server Response State */}
      {effectiveStatus === 'malformed' && (
        <div
          className="bg-white dark:bg-gray-900 rounded-2xl border border-rose-200 dark:border-rose-900/60 p-10 text-center space-y-4 shadow-xs min-w-0 max-w-full"
          data-testid="admin-directory-malformed-state"
        >
          <div className="h-12 w-12 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">
              {isAr
                ? 'رفض استجابة الخادم غير المتوافقة (إغلاق آمن)'
                : 'Malformed Server Response Rejected (Fail-Closed)'}
            </h4>
            <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md mx-auto">
              {isAr
                ? 'تضمنت استجابة الخادم سجلات إدارية غير صالحة أو مكررة أو أدواراً غير معتمدة. تم إيقاف العرض حفاظاً على سلامة الصلاحيات.'
                : 'The server response contained invalid, duplicate, or non-canonical administrative records. Display has been blocked for security.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void executeDirectoryLoad()}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl inline-flex items-center gap-2 cursor-pointer transition-colors"
            data-testid="admin-directory-retry-btn"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{isAr ? 'إعادة المحاولة' : 'Retry'}</span>
          </button>
        </div>
      )}

      {/* 2D. Genuine Empty Directory State */}
      {effectiveStatus === 'empty' && (
        <div
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-12 text-center space-y-3 shadow-xs min-w-0 max-w-full"
          data-testid="admin-directory-empty-state"
        >
          <div className="h-12 w-12 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400 flex items-center justify-center mx-auto">
            <Users className="w-6 h-6" />
          </div>
          <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">
            {isAr
              ? 'لا توجد هويات إدارية مسجلة في الدليل الخادمي'
              : 'No Administrative Identities in Server Directory'}
          </h4>
          <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
            {isAr
              ? 'لم يُرجع الخادم أي سجلات ضمن مجموعة الهويات الإدارية المعتمدة (0 سجل).'
              : 'The canonical server directory returned zero administrative identity records (0 records).'}
          </p>
        </div>
      )}

      {/* 3. Real Directory Loaded: Search, Filter & Responsive Views */}
      {effectiveStatus === 'loaded' && (
        <div
          className="space-y-6 min-w-0 max-w-full"
          data-testid="admin-directory-loaded-state"
        >
          {/* Search & Filter Bar */}
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
                  placeholder={
                    isAr
                      ? 'البحث بالاسم، البريد، أو الدور الإداري...'
                      : 'Search by name, email, or role...'
                  }
                  className="w-full min-w-0 ps-10 pe-4 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-hidden focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                  id="users-search-input"
                />
              </div>

              {/* Role Filter & Status Filter */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:flex md:items-center gap-2 min-w-0">
                <div className="relative min-w-0 w-full sm:w-auto">
                  <select
                    value={selectedRoleFilter}
                    onChange={(e) => setSelectedRoleFilter(e.target.value)}
                    className="w-full sm:w-auto min-w-0 max-w-full truncate px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-semibold text-gray-800 dark:text-gray-200 focus:outline-hidden focus:border-emerald-500 cursor-pointer"
                    id="role-filter-select"
                  >
                    <option value="ALL">
                      {isAr ? 'جميع الأدوار' : 'All Roles'}
                    </option>
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
                    <option value="ALL">
                      {isAr ? 'جميع الحالات' : 'All Statuses'}
                    </option>
                    <option value="ACTIVE">
                      {isAr ? 'نشط فقط' : 'Active Only'}
                    </option>
                    <option value="INACTIVE">
                      {isAr ? 'معطل فقط' : 'Inactive Only'}
                    </option>
                  </select>
                </div>
              </div>
            </div>

            {/* Filter Summary Results */}
            <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400 pt-1 border-t border-gray-100 dark:border-gray-800 flex-wrap gap-1 min-w-0 tabular-nums">
              <span className="min-w-0 truncate">
                {isAr
                  ? `عرض ${filteredUsers.length} من إجمالي ${totalCount} هوية`
                  : `Showing ${filteredUsers.length} of ${totalCount} identities`}
              </span>
              {(searchQuery ||
                selectedRoleFilter !== 'ALL' ||
                selectedStatusFilter !== 'ALL') && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedRoleFilter('ALL');
                    setSelectedStatusFilter('ALL');
                  }}
                  className="text-emerald-600 dark:text-emerald-400 font-bold hover:underline cursor-pointer shrink-0"
                  data-testid="admin-directory-reset-filters-btn"
                >
                  {isAr ? 'إعادة ضبط التصفية' : 'Reset Filters'}
                </button>
              )}
            </div>
          </div>

          {/* Filter No-Match State */}
          {filteredUsers.length === 0 && (
            <div
              className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-12 text-center space-y-3 shadow-xs min-w-0 max-w-full"
              data-testid="admin-directory-filter-empty-state"
            >
              <div className="h-12 w-12 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400 flex items-center justify-center mx-auto">
                <Search className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                {isAr
                  ? 'لا توجد نتائج مطابقة'
                  : 'No identities match your criteria'}
              </h4>
              <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
                {isAr
                  ? 'جرّب تعديل مصطلحات البحث أو تغيير خيارات التصفية للأدوار والحالة.'
                  : 'Try adjusting your search terms or clearing the role/status filters.'}
              </p>
            </div>
          )}

          {/* Responsive Data Presentation */}
          {filteredUsers.length > 0 && (
            <>
              {/* A. Compact Cards (< 1280px / xl breakpoint) */}
              <div
                className="xl:hidden grid grid-cols-1 md:grid-cols-2 gap-3.5 min-w-0 max-w-full"
                id="users-compact-cards-view"
              >
                {filteredUsers.map((user) => {
                  const isCurrentSession = user.id === currentUser.id;
                  const isLastActive = AdminUserManager.isLastActiveOwner(
                    user,
                    canonicalUsers
                  );
                  const permissions = Array.from(
                    AdminAccessService.getPermissionsForRole(user.role)
                  );
                  const meta = ROLE_METADATA[user.role];

                  return (
                    <div
                      key={user.id}
                      data-testid={`admin-directory-card-${user.id}`}
                      className={`bg-white dark:bg-gray-900 rounded-2xl border p-4 shadow-xs transition-all space-y-3.5 relative overflow-hidden min-w-0 max-w-full ${
                        isCurrentSession
                          ? 'border-emerald-500/50 dark:border-emerald-500/50 bg-emerald-50/20 dark:bg-emerald-950/10'
                          : 'border-gray-200/80 dark:border-gray-800/80'
                      }`}
                    >
                      {/* Top Bar with Name & Status */}
                      <div className="flex items-start justify-between gap-2 min-w-0">
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <div
                            className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 border ${meta.badgeColorClass}`}
                          >
                            <span className="font-extrabold text-sm uppercase">
                              {user.name.charAt(0)}
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                              <h4 className="text-xs sm:text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
                                {user.name}
                              </h4>
                              {isCurrentSession && (
                                <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 shrink-0">
                                  {isAr ? '· الجلسة الحالية' : '· Current Session'}
                                </span>
                              )}
                              {isLastActive && (
                                <span className="text-[10px] font-bold text-rose-700 dark:text-rose-400 shrink-0">
                                  {isAr ? '· المالك الأخير' : '· Last Owner'}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate font-mono">
                              {user.email}
                            </p>
                          </div>
                        </div>

                        <span
                          className={`text-xs font-bold shrink-0 ${
                            user.isActive
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-gray-500 dark:text-gray-400'
                          }`}
                          data-testid={`admin-directory-status-${user.id}`}
                        >
                          {getStatusLabel(user.isActive, isAr)}
                        </span>
                      </div>

                      {/* Role & Summary */}
                      <div className="pt-2 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between flex-wrap gap-2 min-w-0">
                        <span className="text-xs font-bold text-gray-800 dark:text-gray-200 flex items-center gap-1.5 max-w-full truncate">
                          <Shield className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          <span className="truncate">
                            {getRoleLabel(user.role, isAr)}
                          </span>
                        </span>

                        <span className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1 shrink-0 tabular-nums">
                          <Sparkles className="w-3 h-3 text-emerald-600 shrink-0" />
                          <span>
                            {user.isActive
                              ? `${permissions.length} ${
                                  isAr ? 'صلاحيات' : 'perms'
                                }`
                              : `${
                                  isAr
                                    ? 'محظور الصلاحيات'
                                    : '0 perms (inactive)'
                                }`}
                          </span>
                        </span>
                      </div>

                      {/* Read-Only Authority Indicator */}
                      <div className="pt-2 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between text-[11px] text-gray-400 dark:text-gray-500">
                        <span className="font-mono truncate">{user.id}</span>
                        <span
                          className="inline-flex items-center gap-1 font-semibold shrink-0"
                          data-testid={`user-readonly-indicator-${user.id}`}
                        >
                          <Lock className="w-3 h-3" />
                          <span>
                            {isAr ? 'للقراءة فقط' : 'Read-Only'}
                          </span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* B. Dense Desktop Table (>= 1280px / xl breakpoint) */}
              <div
                className="hidden xl:block bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/80 dark:border-gray-800/80 shadow-xs overflow-hidden"
                id="users-dense-table-view"
              >
                <table className="w-full text-start border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200/80 dark:border-gray-800/80 bg-gray-50/70 dark:bg-gray-850/70 text-[11px] font-bold text-gray-500 dark:text-gray-400">
                      <th className="py-3.5 px-4 text-start">
                        {isAr ? 'الهوية والمستخدم' : 'Identity & User'}
                      </th>
                      <th className="py-3.5 px-4 text-start">
                        {isAr ? 'البريد الإلكتروني' : 'Email Address'}
                      </th>
                      <th className="py-3.5 px-4 text-start">
                        {isAr ? 'الدور المعتمد (Role)' : 'Assigned Role'}
                      </th>
                      <th className="py-3.5 px-4 text-start">
                        {isAr ? 'الحالة' : 'Status'}
                      </th>
                      <th className="py-3.5 px-4 text-start">
                        {isAr ? 'الصلاحيات الفعالة' : 'Effective Permissions'}
                      </th>
                      <th className="py-3.5 px-4 text-end">
                        {isAr ? 'حالة التعديل' : 'Access Mode'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-xs text-gray-800 dark:text-gray-200">
                    {filteredUsers.map((user) => {
                      const isCurrentSession = user.id === currentUser.id;
                      const isLastActive = AdminUserManager.isLastActiveOwner(
                        user,
                        canonicalUsers
                      );
                      const permissions = Array.from(
                        AdminAccessService.getPermissionsForRole(user.role)
                      );
                      const meta = ROLE_METADATA[user.role];

                      return (
                        <tr
                          key={user.id}
                          data-testid={`admin-directory-row-${user.id}`}
                          className={`hover:bg-gray-50/60 dark:hover:bg-gray-800/50 transition-colors ${
                            isCurrentSession
                              ? 'bg-emerald-50/20 dark:bg-emerald-950/10'
                              : ''
                          }`}
                        >
                          {/* Identity & Name */}
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2.5">
                              <div
                                className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 border font-bold text-xs uppercase ${meta.badgeColorClass}`}
                              >
                                {user.name.charAt(0)}
                              </div>
                              <div>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-bold text-gray-900 dark:text-gray-100">
                                    {user.name}
                                  </span>
                                  {isCurrentSession && (
                                    <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                                      {isAr ? '· الجلسة' : '· Session'}
                                    </span>
                                  )}
                                  {isLastActive && (
                                    <span className="text-[10px] font-bold text-rose-700 dark:text-rose-400">
                                      {isAr ? '· المالك الأخير' : '· Last Owner'}
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] text-gray-400 font-mono">
                                  {user.id}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* Email */}
                          <td className="py-3 px-4 font-mono text-gray-600 dark:text-gray-300">
                            {user.email}
                          </td>

                          {/* Role */}
                          <td className="py-3 px-4">
                            <span className="text-xs font-bold text-gray-800 dark:text-gray-200 inline-flex items-center gap-1.5">
                              <Shield className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                              <span>{getRoleLabel(user.role, isAr)}</span>
                            </span>
                          </td>

                          {/* Status */}
                          <td className="py-3 px-4">
                            <span
                              className={`text-xs font-bold ${
                                user.isActive
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-gray-500 dark:text-gray-400'
                              }`}
                            >
                              {getStatusLabel(user.isActive, isAr)}
                            </span>
                          </td>

                          {/* Effective Permissions Count & Preview */}
                          <td className="py-3 px-4 tabular-nums">
                            {user.isActive ? (
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300">
                                  {permissions.length} / 10
                                </span>
                                <span className="text-[10px] text-gray-400 truncate max-w-[180px]">
                                  {permissions
                                    .map((p) => getPermissionLabel(p, isAr))
                                    .slice(0, 3)
                                    .join('، ')}
                                  {permissions.length > 3 ? '...' : ''}
                                </span>
                              </div>
                            ) : (
                              <span className="text-[11px] text-gray-400 italic">
                                {isAr
                                  ? '0 صلاحيات (معطل)'
                                  : '0 permissions (inactive)'}
                              </span>
                            )}
                          </td>

                          {/* Read-Only Mode */}
                          <td className="py-3 px-4 text-end">
                            <span className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 inline-flex items-center gap-1">
                              <Lock className="w-3 h-3" />
                              <span>
                                {isAr ? 'للقراءة فقط' : 'Read-Only'}
                              </span>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Existing Modals Retained Closed (Mutating Flows Disabled in AUTH-03C2) */}
      <UserEditorModal
        isOpen={false}
        onClose={() => {}}
        user={null}
        currentSessionUser={currentUser}
        allUsers={canonicalUsers}
        onUpdateUser={NOOP_USER_MUTATION}
      />

      <CreateUserModal
        isOpen={false}
        onClose={() => {}}
        existingUsers={canonicalUsers}
        onUserCreated={NOOP_USER_MUTATION}
      />
    </div>
  );
};

