import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
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
  X,
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
  changeAdminRole,
  deactivateAdmin,
  initializeAdminRevision,
  listAdminUsers,
  reactivateAdmin,
  type AdminIdentityClientDependencies,
  type AdminLifecycleClientResponse,
  type AdminLifecycleOperation,
  type ChangeAdminRoleClientInput,
  type CreateAdminInvitationClientInput,
  type CreateAdminInvitationClientResponse,
  type DeactivateAdminClientInput,
  type InitializeAdminRevisionClientInput,
  type ListAdminUsersClientResponse,
  type ReactivateAdminClientInput,
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
  'يمكنك استعراض الهويات الإدارية الفعلية، وإدارة الدعوات الإدارية المعلقة، وتنفيذ إجراءات دورة حياة الحسابات غير المالكة المؤهلة (تهيئة الحساب القديم، تغيير الدور الإداري، تعطيل الحساب الإداري، وإعادة تفعيل الحساب الإداري) بعد التأكيد الصريح والتحقق الخادمي.';

export const ADMIN_DIRECTORY_MUTATION_DISABLED_NOTICE_EN =
  'You can inspect canonical administrative identities, manage pending administrative invitations, and execute guarded lifecycle operations on eligible non-Owner accounts (initialize legacy account, change administrative role, deactivate administrative account, and reactivate administrative account) with explicit Owner confirmation and server verification.';

export const ADMIN_LIFECYCLE_MUTATION_DISABLED_NOTICE_AR =
  'وضع المعاينة والتحقق الآمن: زر تأكيد الإجراء معطل بالكامل في هذه المرحلة. لا يتم إرسال أي تعديلات حية إلى الخادم.';

export const ADMIN_LIFECYCLE_MUTATION_DISABLED_NOTICE_EN =
  'Safe Preview Mode: Confirmation submission is unconditionally disabled in this unit. No live mutations are sent to the server.';

export const ADMIN_LIFECYCLE_LEGACY_UNVERSIONED_NOTICE_AR =
  'حساب قديم بدون مراجعة معتمدة (للقراءة فقط)';

export const ADMIN_LIFECYCLE_LEGACY_UNVERSIONED_NOTICE_EN =
  'Legacy unversioned account (read-only)';

export const ADMIN_LIFECYCLE_INITIALIZE_ACTION_LABEL_AR =
  'تهيئة الحساب القديم';

export const ADMIN_LIFECYCLE_INITIALIZE_ACTION_LABEL_EN =
  'Initialize legacy account';

export const ADMIN_LIFECYCLE_CHANGE_ROLE_LABEL_AR =
  'تغيير الدور الإداري';

export const ADMIN_LIFECYCLE_CHANGE_ROLE_LABEL_EN =
  'Change administrative role';

export const ADMIN_LIFECYCLE_DEACTIVATE_LABEL_AR =
  'تعطيل الحساب الإداري';

export const ADMIN_LIFECYCLE_DEACTIVATE_LABEL_EN =
  'Deactivate administrative account';

export const ADMIN_LIFECYCLE_REACTIVATE_LABEL_AR =
  'إعادة تفعيل الحساب الإداري';

export const ADMIN_LIFECYCLE_REACTIVATE_LABEL_EN =
  'Reactivate administrative account';

export const ADMIN_LIFECYCLE_CONFIRM_OPERATION_LABEL_AR =
  'تأكيد العملية';

export const ADMIN_LIFECYCLE_CONFIRM_OPERATION_LABEL_EN =
  'Confirm operation';

export const ADMIN_LIFECYCLE_OPERATION_COMPLETED_LABEL_AR =
  'تم تنفيذ العملية بنجاح';

export const ADMIN_LIFECYCLE_OPERATION_COMPLETED_LABEL_EN =
  'Operation completed';

export const ADMIN_LIFECYCLE_REVISION_CONFLICT_LABEL_AR =
  'تعارض في رقم المراجعة';

export const ADMIN_LIFECYCLE_REVISION_CONFLICT_LABEL_EN =
  'Revision conflict';

export const ADMIN_LIFECYCLE_REFRESH_REQUIRED_LABEL_AR =
  'يلزم تحديث الدليل';

export const ADMIN_LIFECYCLE_REFRESH_REQUIRED_LABEL_EN =
  'Refresh required';

export const ADMIN_LIFECYCLE_PERMISSION_DENIED_LABEL_AR =
  'تم رفض الصلاحية';

export const ADMIN_LIFECYCLE_PERMISSION_DENIED_LABEL_EN =
  'Permission denied';

export const ADMIN_LIFECYCLE_INITIALIZE_EXPLANATION_AR =
  'يقوم هذا الإجراء بتهيئة رقم المراجعة الأولي للحساب القديم فقط دون تغيير الدور الإداري أو حالة التفعيل الحالية للحساب.';

export const ADMIN_LIFECYCLE_INITIALIZE_EXPLANATION_EN =
  'This operation initializes the authoritative revision for the legacy account without changing its current administrative role or active status.';

export const NON_OWNER_LIFECYCLE_ROLES: ReadonlyArray<AdminRole> = Object.freeze([
  AdminRole.ContentEditor,
  AdminRole.LibraryCurator,
  AdminRole.RightsReviewer,
  AdminRole.TrainingManager,
  AdminRole.Trainer,
  AdminRole.CitizenModerator,
  AdminRole.AIAssistant,
  AdminRole.Viewer,
]);

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

export const ADMIN_LIFECYCLE_INITIALIZE_CONFIRM_CHECKBOX_AR =
  'أؤكد بصفتي مالكاً مفوضاً تهيئة رقم المراجعة الأولي لهذا الحساب الإداري القديم دون تغيير دوره أو حالته.';

export const ADMIN_LIFECYCLE_INITIALIZE_CONFIRM_CHECKBOX_EN =
  'I explicitly confirm initializing the authoritative revision for this legacy administrative account without changing its role or status.';

export const ADMIN_LIFECYCLE_CHANGE_ROLE_CONFIRM_CHECKBOX_AR =
  'أؤكد بصفتي مالكاً مفوضاً تغيير الدور الإداري لهذا الحساب وفق المراجعة المعتمدة المعروضة أعلاه.';

export const ADMIN_LIFECYCLE_CHANGE_ROLE_CONFIRM_CHECKBOX_EN =
  'I explicitly confirm changing the administrative role for this account at the displayed authoritative revision.';

export const ADMIN_LIFECYCLE_DEACTIVATE_CONFIRM_CHECKBOX_AR =
  'أؤكد بصفتي مالكاً مفوضاً تعطيل هذا الحساب الإداري وإيقاف صلاحياته الفعالة وفق المراجعة المعتمدة.';

export const ADMIN_LIFECYCLE_DEACTIVATE_CONFIRM_CHECKBOX_EN =
  'I explicitly confirm deactivating this administrative account and revoking its active permissions at the displayed revision.';

export const ADMIN_LIFECYCLE_REACTIVATE_CONFIRM_CHECKBOX_AR =
  'أؤكد بصفتي مالكاً مفوضاً إعادة تفعيل هذا الحساب الإداري واستعادة صلاحيات دوره المعتمد وفق المراجعة المعروضة.';

export const ADMIN_LIFECYCLE_REACTIVATE_CONFIRM_CHECKBOX_EN =
  'I explicitly confirm reactivating this administrative account and restoring its role permissions at the displayed revision.';

export type AdminRevisionInitSubmissionStatus =
  | 'idle'
  | 'submitting'
  | 'succeeded'
  | 'error';

export type AdminRevisionInitErrorCategory =
  | 'unauthorized'
  | 'target-ineligible'
  | 'owner-promotion'
  | 'noop-operation'
  | 'unconfirmed'
  | 'stale-directory'
  | 'conflict'
  | 'unavailable'
  | 'malformed-response';

export type AdminLifecycleErrorCategory = AdminRevisionInitErrorCategory;

export interface AdminRevisionInitSubmissionSnapshot {
  readonly status: AdminRevisionInitSubmissionStatus;
  readonly isConfirmed: boolean;
  readonly requiresRefreshBeforeRetry: boolean;
  readonly errorCategory: AdminRevisionInitErrorCategory | null;
  readonly errorMessageAr: string | null;
  readonly errorMessageEn: string | null;
  readonly boundCallerUid: string | null;
  readonly boundTargetUid: string | null;
  readonly boundTargetEmail?: string | null;
  readonly boundTargetRole?: AdminRole | null;
  readonly boundTargetIsActive?: boolean | null;
  readonly boundTargetRevision?: number | null;
  readonly boundOperation?: AdminLifecycleOperation | null;
  readonly boundProposedRole?: AdminRole | null;
  readonly boundDirectoryGeneration: number;
  readonly lastCompletedOperation?: AdminLifecycleOperation | null;
  readonly lastCompletedTargetUid?: string | null;
  readonly lastAuditEventId?: string | null;
}

export type AdminLifecycleSubmissionSnapshot = AdminRevisionInitSubmissionSnapshot;

export const INIT_REVISION_ERROR_MESSAGES: Record<
  AdminRevisionInitErrorCategory,
  { readonly ar: string; readonly en: string }
> = Object.freeze({
  unauthorized: {
    ar: `${ADMIN_LIFECYCLE_PERMISSION_DENIED_LABEL_AR}: يجب أن تكون مالكاً نشطاً مفوضاً بإدارة المستخدمين لتنفيذ هذه العملية.`,
    en: `${ADMIN_LIFECYCLE_PERMISSION_DENIED_LABEL_EN}: An authenticated active Owner with ManageUsers permission is required.`,
  },
  'target-ineligible': {
    ar: 'الحساب المحدد غير مؤهل لهذه العملية (حساب مالك محمي، أو الجلسة الحالية، أو حالة المراجعة غير متوافقة مع العملية).',
    en: 'The selected account is ineligible for this operation (protected Owner account, current session, or incompatible revision state).',
  },
  'owner-promotion': {
    ar: `${ADMIN_LIFECYCLE_PERMISSION_DENIED_LABEL_AR}: يُمنع ترقية أي حساب إلى دور المالك (Owner)؛ لا توجد سياسة ترقية لمالك.`,
    en: `${ADMIN_LIFECYCLE_PERMISSION_DENIED_LABEL_EN}: Promoting any account to Owner is forbidden.`,
  },
  'noop-operation': {
    ar: 'العملية المطلوبة لا تُحدث أي تغيير على الدور الحالي أو حالة الحساب الفعالة.',
    en: 'The requested operation is a no-op because the account already has the selected role or active status.',
  },
  unconfirmed: {
    ar: 'يرجى تحديد مربع التأكيد الصريح لهوية الحساب المستهدف والعملية المحددة قبل الإرسال.',
    en: 'Please check the explicit confirmation acknowledgment box for the target account and selected operation before submitting.',
  },
  'stale-directory': {
    ar: `${ADMIN_LIFECYCLE_REFRESH_REQUIRED_LABEL_AR}: تغيرت بيانات الحساب أو سياق الدليل. يرجى تحديث الدليل والتحقق من أحدث حالة قبل المتابعة.`,
    en: `${ADMIN_LIFECYCLE_REFRESH_REQUIRED_LABEL_EN}: Account state or directory context changed. Please refresh the directory and verify the latest state before proceeding.`,
  },
  conflict: {
    ar: `${ADMIN_LIFECYCLE_REVISION_CONFLICT_LABEL_AR}: حدث تعارض في حالة الحساب أو رقم المراجعة على الخادم. ${ADMIN_LIFECYCLE_REFRESH_REQUIRED_LABEL_AR} قبل أي محاولة أخرى.`,
    en: `${ADMIN_LIFECYCLE_REVISION_CONFLICT_LABEL_EN}: A server revision or state conflict occurred. ${ADMIN_LIFECYCLE_REFRESH_REQUIRED_LABEL_EN} before trying again.`,
  },
  unavailable: {
    ar: `تعذر إتمام الاتصال بالخادم. لم يتم تعديل الحالة محلياً؛ ${ADMIN_LIFECYCLE_REFRESH_REQUIRED_LABEL_AR} للتحقق من حالة الحساب.`,
    en: `Could not complete the server request. Local state was not modified; ${ADMIN_LIFECYCLE_REFRESH_REQUIRED_LABEL_EN} to verify account state.`,
  },
  'malformed-response': {
    ar: `رفض استجابة الخادم غير المتوافقة (إغلاق آمن). ${ADMIN_LIFECYCLE_REFRESH_REQUIRED_LABEL_AR} للتحقق من حالة الحساب.`,
    en: `Rejected malformed server response (fail-closed). ${ADMIN_LIFECYCLE_REFRESH_REQUIRED_LABEL_EN} to verify account state.`,
  },
});

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
  initialLifecycleTarget?: AdminUser | null;
  initialLifecycleOperation?: AdminLifecycleOperation;
  initialLifecycleTargetRole?: AdminRole;
  initialLifecycleConfirmed?: boolean;
  initialLifecycleSubmissionState?: Partial<AdminRevisionInitSubmissionSnapshot>;
  invokeInitializeRevision?: (
    input: InitializeAdminRevisionClientInput
  ) => Promise<AdminLifecycleClientResponse>;
  invokeChangeRole?: (
    input: ChangeAdminRoleClientInput
  ) => Promise<AdminLifecycleClientResponse>;
  invokeDeactivate?: (
    input: DeactivateAdminClientInput
  ) => Promise<AdminLifecycleClientResponse>;
  invokeReactivate?: (
    input: ReactivateAdminClientInput
  ) => Promise<AdminLifecycleClientResponse>;
  invokeCreateInvitation?: (
    input: CreateAdminInvitationClientInput
  ) => Promise<CreateAdminInvitationClientResponse>;
  users?: AdminUser[];
  onUpdateUser?: (updatedUser: AdminUser) => void;
  onCreateUser?: (newUser: AdminUser) => void;
}

const CANONICAL_ADMIN_REQUIRED_KEYS = new Set<string>([
  'id',
  'name',
  'email',
  'role',
  'isActive',
]);

const CANONICAL_ADMIN_ALLOWED_KEYS = new Set<string>([
  'id',
  'name',
  'email',
  'role',
  'isActive',
  'revision',
]);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function getAdminUserRevision(user: AdminUser | null | undefined): number | undefined {
  if (!user) return undefined;
  const rev = (user as { revision?: unknown }).revision;
  if (typeof rev === 'number' && Number.isSafeInteger(rev) && rev >= 1 && !Number.isNaN(rev)) {
    return rev;
  }
  return undefined;
}

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
      keys.some((k) => !CANONICAL_ADMIN_ALLOWED_KEYS.has(k)) ||
      Array.from(CANONICAL_ADMIN_REQUIRED_KEYS).some((k) => !keys.includes(k))
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

    let sanitizedRevision: number | undefined;
    if ('revision' in entry) {
      const rev = entry.revision;
      if (
        typeof rev !== 'number' ||
        !Number.isInteger(rev) ||
        !Number.isSafeInteger(rev) ||
        rev < 1 ||
        Number.isNaN(rev)
      ) {
        throw new AdminIdentityClientError(
          'internal',
          'MALFORMED_ADMIN_RECORD'
        );
      }
      sanitizedRevision = rev;
    }

    seenIds.add(id);
    validated.push(
      Object.freeze({
        id,
        name,
        email,
        role: entry.role,
        isActive: entry.isActive,
        ...(sanitizedRevision !== undefined ? { revision: sanitizedRevision } : {}),
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

export function validateLifecycleOperationEligibility(
  caller: AdminUser | null | undefined,
  activeTabId: string,
  target: AdminUser | null | undefined,
  directorySnapshot: AdminDirectoryStateSnapshot | undefined,
  operation: AdminLifecycleOperation,
  proposedRole?: AdminRole
): {
  readonly eligible: boolean;
  readonly reason: AdminRevisionInitErrorCategory | null;
  readonly canonicalTarget: AdminUser | null;
  readonly expectedRevision: number | null;
} {
  if (!isAuthorizedOwnerForUsersDirectory(caller, activeTabId) || !caller) {
    return {
      eligible: false,
      reason: 'unauthorized',
      canonicalTarget: null,
      expectedRevision: null,
    };
  }

  if (
    !target ||
    typeof target !== 'object' ||
    typeof target.id !== 'string' ||
    !target.id.trim() ||
    typeof target.isActive !== 'boolean'
  ) {
    return {
      eligible: false,
      reason: 'target-ineligible',
      canonicalTarget: null,
      expectedRevision: null,
    };
  }

  if (
    target.id === caller.id ||
    target.role === AdminRole.Owner ||
    !isValidAdminRole(target.role)
  ) {
    return {
      eligible: false,
      reason: 'target-ineligible',
      canonicalTarget: null,
      expectedRevision: null,
    };
  }

  let canonicalTarget: AdminUser = target;

  if (directorySnapshot) {
    if (
      directorySnapshot.status !== 'loaded' ||
      directorySnapshot.boundUserUid !== caller.id ||
      directorySnapshot.boundTabId !== activeTabId
    ) {
      return {
        eligible: false,
        reason: 'stale-directory',
        canonicalTarget: null,
        expectedRevision: null,
      };
    }

    const latest = directorySnapshot.users.find((u) => u.id === target.id);
    if (!latest) {
      return {
        eligible: false,
        reason: 'stale-directory',
        canonicalTarget: null,
        expectedRevision: null,
      };
    }

    if (
      latest.id === caller.id ||
      latest.role === AdminRole.Owner ||
      !isValidAdminRole(latest.role)
    ) {
      return {
        eligible: false,
        reason: 'target-ineligible',
        canonicalTarget: null,
        expectedRevision: null,
      };
    }

    if (
      latest.id !== target.id ||
      latest.email !== target.email ||
      latest.role !== target.role ||
      latest.isActive !== target.isActive ||
      getAdminUserRevision(latest) !== getAdminUserRevision(target)
    ) {
      return {
        eligible: false,
        reason: 'stale-directory',
        canonicalTarget: null,
        expectedRevision: null,
      };
    }

    canonicalTarget = latest;
  }

  const targetRev = getAdminUserRevision(canonicalTarget);

  if (operation === 'InitializeRevision') {
    if (targetRev !== undefined) {
      return {
        eligible: false,
        reason: 'target-ineligible',
        canonicalTarget: null,
        expectedRevision: null,
      };
    }
    return {
      eligible: true,
      reason: null,
      canonicalTarget,
      expectedRevision: null,
    };
  }

  if (
    operation === 'ChangeRole' ||
    operation === 'Deactivate' ||
    operation === 'Reactivate'
  ) {
    if (targetRev === undefined) {
      return {
        eligible: false,
        reason: 'target-ineligible',
        canonicalTarget: null,
        expectedRevision: null,
      };
    }

    if (operation === 'ChangeRole') {
      if (proposedRole === AdminRole.Owner) {
        return {
          eligible: false,
          reason: 'owner-promotion',
          canonicalTarget: null,
          expectedRevision: null,
        };
      }
      if (
        !proposedRole ||
        !isValidAdminRole(proposedRole) ||
        !NON_OWNER_LIFECYCLE_ROLES.includes(proposedRole)
      ) {
        return {
          eligible: false,
          reason: 'target-ineligible',
          canonicalTarget: null,
          expectedRevision: null,
        };
      }
      if (proposedRole === canonicalTarget.role) {
        return {
          eligible: false,
          reason: 'noop-operation',
          canonicalTarget: null,
          expectedRevision: null,
        };
      }
    } else if (operation === 'Deactivate') {
      if (canonicalTarget.isActive !== true) {
        return {
          eligible: false,
          reason: 'noop-operation',
          canonicalTarget: null,
          expectedRevision: null,
        };
      }
    } else if (operation === 'Reactivate') {
      if (canonicalTarget.isActive !== false) {
        return {
          eligible: false,
          reason: 'noop-operation',
          canonicalTarget: null,
          expectedRevision: null,
        };
      }
    }

    return {
      eligible: true,
      reason: null,
      canonicalTarget,
      expectedRevision: targetRev,
    };
  }

  return {
    eligible: false,
    reason: 'target-ineligible',
    canonicalTarget: null,
    expectedRevision: null,
  };
}

export function isTargetEligibleForRevisionInitialization(
  caller: AdminUser | null | undefined,
  activeTabId: string,
  target: AdminUser | null | undefined,
  directorySnapshot?: AdminDirectoryStateSnapshot
): {
  readonly eligible: boolean;
  readonly reason: AdminRevisionInitErrorCategory | null;
  readonly canonicalTarget: AdminUser | null;
} {
  const result = validateLifecycleOperationEligibility(
    caller,
    activeTabId,
    target,
    directorySnapshot,
    'InitializeRevision'
  );
  return {
    eligible: result.eligible,
    reason: result.reason,
    canonicalTarget: result.canonicalTarget,
  };
}

export function classifyInitRevisionError(
  error: unknown
): AdminRevisionInitErrorCategory {
  if (
    error instanceof AdminIdentityClientError ||
    (error &&
      typeof error === 'object' &&
      (error as { name?: string }).name === 'AdminIdentityClientError')
  ) {
    const clientErr = error as AdminIdentityClientError;
    const rawCode = String(clientErr.code ?? '');
    const rawReason = String(clientErr.reason ?? '');

    if (
      rawCode === 'unauthenticated' ||
      rawCode === 'permission-denied' ||
      rawReason === 'UNAUTHENTICATED_SESSION' ||
      rawReason === 'PERMISSION_DENIED' ||
      rawReason === 'SPOOFED_AUTHORITY_REJECTED'
    ) {
      return 'unauthorized';
    }
    if (rawReason === 'OWNER_PROMOTION_FORBIDDEN') {
      return 'owner-promotion';
    }
    if (rawReason === 'NOOP_LIFECYCLE_MUTATION') {
      return 'noop-operation';
    }
    if (
      rawReason === 'SELF_MUTATION_FORBIDDEN' ||
      rawReason === 'OWNER_ACCOUNT_PROTECTED' ||
      rawReason === 'TARGET_NOT_FOUND' ||
      rawReason === 'INVALID_ARGUMENT' ||
      rawCode === 'invalid-argument' ||
      rawCode === 'not-found'
    ) {
      return 'target-ineligible';
    }
    if (
      rawReason === 'REVISION_ALREADY_INITIALIZED' ||
      rawReason === 'REVISION_MISMATCH' ||
      rawReason === 'REVISION_CONFLICT' ||
      rawReason === 'FAILED_PRECONDITION' ||
      rawCode === 'failed-precondition' ||
      rawCode === 'aborted' ||
      rawCode === 'already-exists'
    ) {
      return 'conflict';
    }
    if (
      rawReason === 'MALFORMED_LIFECYCLE_RECORD' ||
      rawReason === 'MALFORMED_ADMIN_RECORD' ||
      rawReason === 'INVALID_ADMIN_ROLE' ||
      rawReason === 'INVALID_SERVER_RESPONSE' ||
      rawCode === 'internal'
    ) {
      return 'malformed-response';
    }
    return 'unavailable';
  }
  return 'unavailable';
}

export const classifyLifecycleError = classifyInitRevisionError;

export function validateLifecycleSuccessResponse(
  response: unknown,
  expectedOperation: AdminLifecycleOperation,
  expectedTarget: AdminUser,
  expectedTargetRole?: AdminRole
): AdminLifecycleClientResponse {
  if (!response || typeof response !== 'object') {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_LIFECYCLE_RECORD'
    );
  }

  const candidate = response as AdminLifecycleClientResponse;
  const expectedPrevRev = getAdminUserRevision(expectedTarget);

  if (
    candidate.operation !== expectedOperation ||
    candidate.targetUid !== expectedTarget.id ||
    typeof candidate.currentRevision !== 'number' ||
    !Number.isInteger(candidate.currentRevision) ||
    !Number.isSafeInteger(candidate.currentRevision) ||
    candidate.currentRevision < 1 ||
    Number.isNaN(candidate.currentRevision) ||
    typeof candidate.committedAtIso !== 'string' ||
    !candidate.committedAtIso.trim() ||
    !candidate.admin ||
    typeof candidate.admin !== 'object' ||
    candidate.admin.id !== expectedTarget.id ||
    candidate.admin.revision !== candidate.currentRevision ||
    candidate.admin.role === AdminRole.Owner ||
    !isValidAdminRole(candidate.admin.role) ||
    !candidate.auditReceipt ||
    typeof candidate.auditReceipt !== 'object' ||
    candidate.auditReceipt.targetId !== expectedTarget.id ||
    typeof candidate.auditReceipt.auditEventId !== 'string' ||
    !candidate.auditReceipt.auditEventId.trim() ||
    typeof candidate.auditReceipt.action !== 'string' ||
    !candidate.auditReceipt.action.trim() ||
    typeof candidate.auditReceipt.targetType !== 'string' ||
    !candidate.auditReceipt.targetType.trim() ||
    typeof candidate.auditReceipt.timestamp !== 'string' ||
    !candidate.auditReceipt.timestamp.trim()
  ) {
    throw new AdminIdentityClientError(
      'internal',
      'MALFORMED_LIFECYCLE_RECORD'
    );
  }

  if (expectedOperation === 'InitializeRevision') {
    if (
      candidate.previousRevision !== null ||
      candidate.admin.role !== expectedTarget.role ||
      candidate.admin.isActive !== expectedTarget.isActive
    ) {
      throw new AdminIdentityClientError(
        'internal',
        'MALFORMED_LIFECYCLE_RECORD'
      );
    }
  } else {
    if (
      expectedPrevRev === undefined ||
      candidate.previousRevision !== expectedPrevRev ||
      candidate.currentRevision <= expectedPrevRev ||
      candidate.currentRevision !== expectedPrevRev + 1
    ) {
      throw new AdminIdentityClientError(
        'internal',
        'MALFORMED_LIFECYCLE_RECORD'
      );
    }

    if (expectedOperation === 'ChangeRole') {
      if (
        !expectedTargetRole ||
        expectedTargetRole === AdminRole.Owner ||
        candidate.admin.role !== expectedTargetRole ||
        candidate.admin.isActive !== expectedTarget.isActive
      ) {
        throw new AdminIdentityClientError(
          'internal',
          'MALFORMED_LIFECYCLE_RECORD'
        );
      }
    } else if (expectedOperation === 'Deactivate') {
      if (
        candidate.admin.role !== expectedTarget.role ||
        candidate.admin.isActive !== false
      ) {
        throw new AdminIdentityClientError(
          'internal',
          'MALFORMED_LIFECYCLE_RECORD'
        );
      }
    } else if (expectedOperation === 'Reactivate') {
      if (
        candidate.admin.role !== expectedTarget.role ||
        candidate.admin.isActive !== true
      ) {
        throw new AdminIdentityClientError(
          'internal',
          'MALFORMED_LIFECYCLE_RECORD'
        );
      }
    }
  }

  return candidate;
}

export function validateInitializeRevisionSuccessResponse(
  response: unknown,
  expectedTarget: AdminUser
): AdminLifecycleClientResponse {
  return validateLifecycleSuccessResponse(
    response,
    'InitializeRevision',
    expectedTarget
  );
}

export class AdminRevisionInitializationController {
  private snapshot: AdminRevisionInitSubmissionSnapshot;
  private isMounted = true;
  private inFlight = false;
  private submissionGeneration = 0;
  private readonly listeners = new Set<
    (snap: AdminRevisionInitSubmissionSnapshot) => void
  >();

  constructor(initial?: Partial<AdminRevisionInitSubmissionSnapshot>) {
    this.snapshot = Object.freeze({
      status: initial?.status ?? 'idle',
      isConfirmed: initial?.isConfirmed ?? false,
      requiresRefreshBeforeRetry: initial?.requiresRefreshBeforeRetry ?? false,
      errorCategory: initial?.errorCategory ?? null,
      errorMessageAr: initial?.errorMessageAr ?? null,
      errorMessageEn: initial?.errorMessageEn ?? null,
      boundCallerUid: initial?.boundCallerUid ?? null,
      boundTargetUid: initial?.boundTargetUid ?? null,
      boundDirectoryGeneration: initial?.boundDirectoryGeneration ?? 0,
      boundTargetEmail: initial?.boundTargetEmail ?? null,
      boundTargetRole: initial?.boundTargetRole ?? null,
      boundTargetIsActive: initial?.boundTargetIsActive ?? null,
      boundTargetRevision:
        initial?.boundTargetRevision !== undefined
          ? initial.boundTargetRevision
          : null,
      boundOperation: initial?.boundOperation ?? null,
      boundProposedRole: initial?.boundProposedRole ?? null,
      lastCompletedOperation: initial?.lastCompletedOperation ?? null,
      lastCompletedTargetUid: initial?.lastCompletedTargetUid ?? null,
      lastAuditEventId: initial?.lastAuditEventId ?? null,
    });
    if (this.snapshot.status === 'submitting') {
      this.inFlight = true;
    }
  }

  public getSnapshot(): AdminRevisionInitSubmissionSnapshot {
    return this.snapshot;
  }

  public mount(): void {
    this.isMounted = true;
  }

  public unmount(): void {
    this.isMounted = false;
    this.inFlight = false;
    this.submissionGeneration += 1;
    this.listeners.clear();
  }

  public subscribe(
    listener: (snap: AdminRevisionInitSubmissionSnapshot) => void
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(next: AdminRevisionInitSubmissionSnapshot): void {
    this.snapshot = Object.freeze(next);
    if (this.isMounted) {
      for (const listener of this.listeners) {
        listener(this.snapshot);
      }
    }
  }

  public resetForTarget(
    caller: AdminUser | null | undefined,
    target: AdminUser | null | undefined,
    directoryGeneration: number,
    initialConfirmed = false,
    operation?: AdminLifecycleOperation | null,
    proposedRole?: AdminRole | null
  ): AdminRevisionInitSubmissionSnapshot {
    this.inFlight = false;
    this.submissionGeneration += 1;
    const targetRev = getAdminUserRevision(target);
    this.emit({
      status: 'idle',
      isConfirmed: Boolean(initialConfirmed),
      requiresRefreshBeforeRetry: false,
      errorCategory: null,
      errorMessageAr: null,
      errorMessageEn: null,
      boundCallerUid: caller?.id ?? null,
      boundTargetUid: target?.id ?? null,
      boundDirectoryGeneration: directoryGeneration,
      boundTargetEmail: target?.email ?? null,
      boundTargetRole: target?.role ?? null,
      boundTargetIsActive:
        typeof target?.isActive === 'boolean' ? target.isActive : null,
      boundTargetRevision: targetRev !== undefined ? targetRev : null,
      boundOperation: operation ?? null,
      boundProposedRole: proposedRole ?? null,
      lastCompletedOperation: this.snapshot.lastCompletedOperation ?? null,
      lastCompletedTargetUid: this.snapshot.lastCompletedTargetUid ?? null,
      lastAuditEventId: this.snapshot.lastAuditEventId ?? null,
    });
    return this.snapshot;
  }

  public resetConfirmationForOperationChange(
    operation: AdminLifecycleOperation,
    proposedRole?: AdminRole | null
  ): AdminRevisionInitSubmissionSnapshot {
    if (this.inFlight || this.snapshot.status === 'submitting') {
      return this.snapshot;
    }
    this.emit({
      ...this.snapshot,
      status: this.snapshot.requiresRefreshBeforeRetry
        ? this.snapshot.status
        : 'idle',
      isConfirmed: false,
      errorCategory: this.snapshot.requiresRefreshBeforeRetry
        ? this.snapshot.errorCategory
        : null,
      errorMessageAr: this.snapshot.requiresRefreshBeforeRetry
        ? this.snapshot.errorMessageAr
        : null,
      errorMessageEn: this.snapshot.requiresRefreshBeforeRetry
        ? this.snapshot.errorMessageEn
        : null,
      boundOperation: operation,
      boundProposedRole:
        operation === 'ChangeRole' ? (proposedRole ?? null) : null,
    });
    return this.snapshot;
  }

  public syncContext(
    caller: AdminUser | null | undefined,
    activeTabId: string,
    target: AdminUser | null | undefined,
    directorySnapshot: AdminDirectoryStateSnapshot
  ): AdminRevisionInitSubmissionSnapshot {
    const isAuthorized = isAuthorizedOwnerForUsersDirectory(caller, activeTabId);
    const nextCallerUid = isAuthorized && caller ? caller.id : null;
    const nextTargetUid = target?.id ?? null;

    if (
      !isAuthorized ||
      nextCallerUid !== this.snapshot.boundCallerUid ||
      nextTargetUid !== this.snapshot.boundTargetUid
    ) {
      this.inFlight = false;
      this.submissionGeneration += 1;
      const targetRev = getAdminUserRevision(target);
      this.emit({
        status: isAuthorized ? 'idle' : 'error',
        isConfirmed: false,
        requiresRefreshBeforeRetry: !isAuthorized,
        errorCategory: isAuthorized ? null : 'unauthorized',
        errorMessageAr: isAuthorized
          ? null
          : INIT_REVISION_ERROR_MESSAGES.unauthorized.ar,
        errorMessageEn: isAuthorized
          ? null
          : INIT_REVISION_ERROR_MESSAGES.unauthorized.en,
        boundCallerUid: nextCallerUid,
        boundTargetUid: nextTargetUid,
        boundDirectoryGeneration: directorySnapshot.requestGeneration,
        boundTargetEmail: target?.email ?? null,
        boundTargetRole: target?.role ?? null,
        boundTargetIsActive:
          typeof target?.isActive === 'boolean' ? target.isActive : null,
        boundTargetRevision: targetRev !== undefined ? targetRev : null,
        boundOperation: null,
        boundProposedRole: null,
        lastCompletedOperation: this.snapshot.lastCompletedOperation ?? null,
        lastCompletedTargetUid: this.snapshot.lastCompletedTargetUid ?? null,
        lastAuditEventId: this.snapshot.lastAuditEventId ?? null,
      });
      return this.snapshot;
    }

    if (
      directorySnapshot.requestGeneration !==
        this.snapshot.boundDirectoryGeneration &&
      directorySnapshot.status === 'loaded'
    ) {
      this.inFlight = false;
      this.submissionGeneration += 1;
      const targetRev = getAdminUserRevision(target);
      this.emit({
        status: this.snapshot.status === 'succeeded' ? 'succeeded' : 'idle',
        isConfirmed: false,
        requiresRefreshBeforeRetry: false,
        errorCategory: null,
        errorMessageAr: null,
        errorMessageEn: null,
        boundCallerUid: nextCallerUid,
        boundTargetUid: nextTargetUid,
        boundDirectoryGeneration: directorySnapshot.requestGeneration,
        boundTargetEmail: target?.email ?? null,
        boundTargetRole: target?.role ?? null,
        boundTargetIsActive:
          typeof target?.isActive === 'boolean' ? target.isActive : null,
        boundTargetRevision: targetRev !== undefined ? targetRev : null,
        boundOperation: this.snapshot.boundOperation ?? null,
        boundProposedRole: this.snapshot.boundProposedRole ?? null,
        lastCompletedOperation: this.snapshot.lastCompletedOperation ?? null,
        lastCompletedTargetUid: this.snapshot.lastCompletedTargetUid ?? null,
        lastAuditEventId: this.snapshot.lastAuditEventId ?? null,
      });
    }

    return this.snapshot;
  }

  public setConfirmed(
    confirmed: boolean,
    caller: AdminUser | null | undefined,
    activeTabId: string,
    target: AdminUser | null | undefined,
    directorySnapshot: AdminDirectoryStateSnapshot,
    operation: AdminLifecycleOperation = 'InitializeRevision',
    proposedRole?: AdminRole
  ): AdminRevisionInitSubmissionSnapshot {
    if (this.inFlight || this.snapshot.status === 'submitting') {
      return this.snapshot;
    }
    if (this.snapshot.requiresRefreshBeforeRetry) {
      return this.snapshot;
    }

    const check = validateLifecycleOperationEligibility(
      caller,
      activeTabId,
      target,
      directorySnapshot,
      operation,
      proposedRole
    );
    if (!check.eligible || !caller || !check.canonicalTarget) {
      const cat = check.reason ?? 'target-ineligible';
      const needsRefresh =
        cat !== 'unconfirmed' &&
        cat !== 'noop-operation' &&
        cat !== 'owner-promotion';
      this.emit({
        ...this.snapshot,
        status: 'error',
        isConfirmed: false,
        requiresRefreshBeforeRetry: needsRefresh,
        errorCategory: cat,
        errorMessageAr: INIT_REVISION_ERROR_MESSAGES[cat].ar,
        errorMessageEn: INIT_REVISION_ERROR_MESSAGES[cat].en,
      });
      return this.snapshot;
    }

    const canonicalTarget = check.canonicalTarget;

    this.emit({
      ...this.snapshot,
      status: 'idle',
      isConfirmed: Boolean(confirmed),
      errorCategory: null,
      errorMessageAr: null,
      errorMessageEn: null,
      boundCallerUid: caller.id,
      boundTargetUid: canonicalTarget.id,
      boundDirectoryGeneration: directorySnapshot.requestGeneration,
      boundTargetEmail: canonicalTarget.email,
      boundTargetRole: canonicalTarget.role,
      boundTargetIsActive: canonicalTarget.isActive,
      boundTargetRevision: check.expectedRevision,
      boundOperation: operation,
      boundProposedRole:
        operation === 'ChangeRole' ? (proposedRole ?? null) : null,
    });
    return this.snapshot;
  }

  public async submitLifecycleOperation(params: {
    readonly caller: AdminUser | null | undefined;
    readonly activeTabId: string;
    readonly target: AdminUser | null | undefined;
    readonly operation: AdminLifecycleOperation;
    readonly proposedRole?: AdminRole;
    readonly directorySnapshot: AdminDirectoryStateSnapshot;
    readonly invokeInit?: (
      input: InitializeAdminRevisionClientInput
    ) => Promise<AdminLifecycleClientResponse>;
    readonly invokeChangeRole?: (
      input: ChangeAdminRoleClientInput
    ) => Promise<AdminLifecycleClientResponse>;
    readonly invokeDeactivate?: (
      input: DeactivateAdminClientInput
    ) => Promise<AdminLifecycleClientResponse>;
    readonly invokeReactivate?: (
      input: ReactivateAdminClientInput
    ) => Promise<AdminLifecycleClientResponse>;
    readonly refreshDirectory: () => Promise<unknown>;
    readonly onModalClose?: () => void;
  }): Promise<AdminRevisionInitSubmissionSnapshot> {
    if (this.inFlight || this.snapshot.status === 'submitting') {
      return this.snapshot;
    }

    if (this.snapshot.requiresRefreshBeforeRetry) {
      return this.snapshot;
    }

    if (
      !isAuthorizedOwnerForUsersDirectory(params.caller, params.activeTabId) ||
      !params.caller
    ) {
      this.emit({
        ...this.snapshot,
        status: 'error',
        isConfirmed: false,
        requiresRefreshBeforeRetry: true,
        errorCategory: 'unauthorized',
        errorMessageAr: INIT_REVISION_ERROR_MESSAGES.unauthorized.ar,
        errorMessageEn: INIT_REVISION_ERROR_MESSAGES.unauthorized.en,
      });
      return this.snapshot;
    }

    const check = validateLifecycleOperationEligibility(
      params.caller,
      params.activeTabId,
      params.target,
      params.directorySnapshot,
      params.operation,
      params.proposedRole
    );
    if (!check.eligible || !check.canonicalTarget) {
      const cat = check.reason ?? 'target-ineligible';
      const needsRefresh =
        cat !== 'unconfirmed' &&
        cat !== 'noop-operation' &&
        cat !== 'owner-promotion';
      this.emit({
        ...this.snapshot,
        status: 'error',
        isConfirmed: false,
        requiresRefreshBeforeRetry: needsRefresh,
        errorCategory: cat,
        errorMessageAr: INIT_REVISION_ERROR_MESSAGES[cat].ar,
        errorMessageEn: INIT_REVISION_ERROR_MESSAGES[cat].en,
      });
      return this.snapshot;
    }

    const targetSnapshot = check.canonicalTarget;

    const hasMismatchedBoundFields =
      (this.snapshot.boundTargetEmail !== undefined &&
        this.snapshot.boundTargetEmail !== null &&
        this.snapshot.boundTargetEmail !== targetSnapshot.email) ||
      (this.snapshot.boundTargetRole !== undefined &&
        this.snapshot.boundTargetRole !== null &&
        this.snapshot.boundTargetRole !== targetSnapshot.role) ||
      (this.snapshot.boundTargetIsActive !== undefined &&
        this.snapshot.boundTargetIsActive !== null &&
        this.snapshot.boundTargetIsActive !== targetSnapshot.isActive) ||
      (this.snapshot.boundTargetRevision !== undefined &&
        this.snapshot.boundTargetRevision !== null &&
        this.snapshot.boundTargetRevision !== check.expectedRevision) ||
      (this.snapshot.boundOperation !== undefined &&
        this.snapshot.boundOperation !== null &&
        this.snapshot.boundOperation !== params.operation) ||
      (params.operation === 'ChangeRole' &&
        this.snapshot.boundProposedRole !== undefined &&
        this.snapshot.boundProposedRole !== null &&
        this.snapshot.boundProposedRole !== params.proposedRole);

    if (
      !this.snapshot.isConfirmed ||
      this.snapshot.boundCallerUid !== params.caller.id ||
      this.snapshot.boundTargetUid !== targetSnapshot.id ||
      hasMismatchedBoundFields
    ) {
      this.emit({
        ...this.snapshot,
        status: 'error',
        isConfirmed: false,
        requiresRefreshBeforeRetry: false,
        errorCategory: 'unconfirmed',
        errorMessageAr: INIT_REVISION_ERROR_MESSAGES.unconfirmed.ar,
        errorMessageEn: INIT_REVISION_ERROR_MESSAGES.unconfirmed.en,
      });
      return this.snapshot;
    }

    this.inFlight = true;
    const generation = ++this.submissionGeneration;
    const callerUid = params.caller.id;

    this.emit({
      ...this.snapshot,
      status: 'submitting',
      errorCategory: null,
      errorMessageAr: null,
      errorMessageEn: null,
    });

    try {
      let response: AdminLifecycleClientResponse;

      if (params.operation === 'InitializeRevision') {
        if (!params.invokeInit) {
          throw new AdminIdentityClientError(
            'unavailable',
            'SERVICE_UNAVAILABLE'
          );
        }
        const exactPayload: InitializeAdminRevisionClientInput = Object.freeze({
          targetUid: targetSnapshot.id,
        });
        response = await params.invokeInit(exactPayload);
      } else if (params.operation === 'ChangeRole') {
        if (
          !params.invokeChangeRole ||
          check.expectedRevision === null ||
          !params.proposedRole
        ) {
          throw new AdminIdentityClientError(
            'unavailable',
            'SERVICE_UNAVAILABLE'
          );
        }
        const exactPayload: ChangeAdminRoleClientInput = Object.freeze({
          targetUid: targetSnapshot.id,
          expectedRevision: check.expectedRevision,
          targetRole: params.proposedRole,
        });
        response = await params.invokeChangeRole(exactPayload);
      } else if (params.operation === 'Deactivate') {
        if (!params.invokeDeactivate || check.expectedRevision === null) {
          throw new AdminIdentityClientError(
            'unavailable',
            'SERVICE_UNAVAILABLE'
          );
        }
        const exactPayload: DeactivateAdminClientInput = Object.freeze({
          targetUid: targetSnapshot.id,
          expectedRevision: check.expectedRevision,
        });
        response = await params.invokeDeactivate(exactPayload);
      } else {
        if (!params.invokeReactivate || check.expectedRevision === null) {
          throw new AdminIdentityClientError(
            'unavailable',
            'SERVICE_UNAVAILABLE'
          );
        }
        const exactPayload: ReactivateAdminClientInput = Object.freeze({
          targetUid: targetSnapshot.id,
          expectedRevision: check.expectedRevision,
        });
        response = await params.invokeReactivate(exactPayload);
      }

      if (
        !this.isMounted ||
        this.submissionGeneration !== generation ||
        this.snapshot.boundCallerUid !== callerUid ||
        this.snapshot.boundTargetUid !== targetSnapshot.id ||
        !isAuthorizedOwnerForUsersDirectory(params.caller, params.activeTabId)
      ) {
        this.inFlight = false;
        return this.snapshot;
      }

      const validatedResponse = validateLifecycleSuccessResponse(
        response,
        params.operation,
        targetSnapshot,
        params.proposedRole
      );

      this.inFlight = false;
      this.emit({
        status: 'succeeded',
        isConfirmed: false,
        requiresRefreshBeforeRetry: false,
        errorCategory: null,
        errorMessageAr: null,
        errorMessageEn: null,
        boundCallerUid: callerUid,
        boundTargetUid: targetSnapshot.id,
        boundDirectoryGeneration: params.directorySnapshot.requestGeneration,
        boundTargetEmail: targetSnapshot.email,
        boundTargetRole: validatedResponse.admin.role,
        boundTargetIsActive: validatedResponse.admin.isActive,
        boundTargetRevision: validatedResponse.currentRevision,
        boundOperation: params.operation,
        boundProposedRole:
          params.operation === 'ChangeRole'
            ? (params.proposedRole ?? null)
            : null,
        lastCompletedOperation: params.operation,
        lastCompletedTargetUid: targetSnapshot.id,
        lastAuditEventId: validatedResponse.auditReceipt.auditEventId,
      });

      params.onModalClose?.();
      await params.refreshDirectory();

      return this.snapshot;
    } catch (error: unknown) {
      this.inFlight = false;
      if (!this.isMounted || this.submissionGeneration !== generation) {
        return this.snapshot;
      }

      const category = classifyInitRevisionError(error);
      this.emit({
        ...this.snapshot,
        status: 'error',
        isConfirmed: false,
        requiresRefreshBeforeRetry: true,
        errorCategory: category,
        errorMessageAr: INIT_REVISION_ERROR_MESSAGES[category].ar,
        errorMessageEn: INIT_REVISION_ERROR_MESSAGES[category].en,
      });
      return this.snapshot;
    }
  }

  public async submitInitializeRevision(params: {
    readonly caller: AdminUser | null | undefined;
    readonly activeTabId: string;
    readonly target: AdminUser | null | undefined;
    readonly operation: AdminLifecycleOperation;
    readonly directorySnapshot: AdminDirectoryStateSnapshot;
    readonly invokeInit: (
      input: InitializeAdminRevisionClientInput
    ) => Promise<AdminLifecycleClientResponse>;
    readonly refreshDirectory: () => Promise<unknown>;
    readonly onModalClose?: () => void;
  }): Promise<AdminRevisionInitSubmissionSnapshot> {
    if (params.operation !== 'InitializeRevision') {
      this.emit({
        ...this.snapshot,
        status: 'error',
        isConfirmed: false,
        requiresRefreshBeforeRetry: false,
        errorCategory: 'target-ineligible',
        errorMessageAr: INIT_REVISION_ERROR_MESSAGES['target-ineligible'].ar,
        errorMessageEn: INIT_REVISION_ERROR_MESSAGES['target-ineligible'].en,
      });
      return this.snapshot;
    }
    return this.submitLifecycleOperation({
      caller: params.caller,
      activeTabId: params.activeTabId,
      target: params.target,
      operation: 'InitializeRevision',
      directorySnapshot: params.directorySnapshot,
      invokeInit: params.invokeInit,
      refreshDirectory: params.refreshDirectory,
      onModalClose: params.onModalClose,
    });
  }
}

export const AdminLifecycleSubmissionController =
  AdminRevisionInitializationController;

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
  initialLifecycleTarget = null,
  initialLifecycleOperation = 'ChangeRole',
  initialLifecycleTargetRole = AdminRole.ContentEditor,
  initialLifecycleConfirmed = false,
  initialLifecycleSubmissionState,
  invokeInitializeRevision,
  invokeChangeRole,
  invokeDeactivate,
  invokeReactivate,
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

  // Guarded Admin Lifecycle Modal State
  const [activeLifecycleTarget, setActiveLifecycleTarget] = useState<AdminUser | null>(
    () => initialLifecycleTarget
  );
  const [selectedOperation, setSelectedOperation] = useState<AdminLifecycleOperation>(
    () => initialLifecycleOperation
  );
  const [selectedTargetRole, setSelectedTargetRole] = useState<AdminRole>(
    () => initialLifecycleTargetRole
  );

  const initControllerRef = useRef<AdminRevisionInitializationController | null>(null);
  if (!initControllerRef.current) {
    const initialTargetRev = getAdminUserRevision(initialLifecycleTarget);
    const initialEffectiveOp: AdminLifecycleOperation = initialLifecycleTarget
      ? initialTargetRev === undefined
        ? 'InitializeRevision'
        : initialLifecycleOperation === 'InitializeRevision'
        ? initialLifecycleTarget.isActive
          ? 'ChangeRole'
          : 'Reactivate'
        : initialLifecycleOperation
      : initialLifecycleOperation;

    initControllerRef.current = new AdminRevisionInitializationController({
      status: initialLifecycleSubmissionState?.status ?? 'idle',
      isConfirmed:
        initialLifecycleSubmissionState?.isConfirmed ??
        Boolean(initialLifecycleConfirmed),
      requiresRefreshBeforeRetry:
        initialLifecycleSubmissionState?.requiresRefreshBeforeRetry ?? false,
      errorCategory: initialLifecycleSubmissionState?.errorCategory ?? null,
      errorMessageAr: initialLifecycleSubmissionState?.errorMessageAr ?? null,
      errorMessageEn: initialLifecycleSubmissionState?.errorMessageEn ?? null,
      boundCallerUid:
        initialLifecycleSubmissionState?.boundCallerUid ??
        (isAuthorizedOwner ? currentUser?.id ?? null : null),
      boundTargetUid:
        initialLifecycleSubmissionState?.boundTargetUid ??
        (initialLifecycleTarget?.id ?? null),
      boundDirectoryGeneration:
        initialLifecycleSubmissionState?.boundDirectoryGeneration ??
        controllerRef.current.getSnapshot().requestGeneration,
      boundTargetEmail:
        initialLifecycleSubmissionState?.boundTargetEmail ??
        (initialLifecycleTarget?.email ?? null),
      boundTargetRole:
        initialLifecycleSubmissionState?.boundTargetRole ??
        (initialLifecycleTarget?.role ?? null),
      boundTargetIsActive:
        initialLifecycleSubmissionState?.boundTargetIsActive ??
        (typeof initialLifecycleTarget?.isActive === 'boolean'
          ? initialLifecycleTarget.isActive
          : null),
      boundTargetRevision:
        initialLifecycleSubmissionState?.boundTargetRevision !== undefined
          ? initialLifecycleSubmissionState.boundTargetRevision
          : (initialTargetRev !== undefined ? initialTargetRev : null),
      boundOperation:
        initialLifecycleSubmissionState?.boundOperation ??
        (initialLifecycleTarget ? initialEffectiveOp : null),
      boundProposedRole:
        initialLifecycleSubmissionState?.boundProposedRole ??
        (initialEffectiveOp === 'ChangeRole' ? initialLifecycleTargetRole : null),
      lastCompletedOperation:
        initialLifecycleSubmissionState?.lastCompletedOperation ?? null,
      lastCompletedTargetUid:
        initialLifecycleSubmissionState?.lastCompletedTargetUid ?? null,
      lastAuditEventId:
        initialLifecycleSubmissionState?.lastAuditEventId ?? null,
    });
  }

  const [initSubmissionSnapshot, setInitSubmissionSnapshot] =
    useState<AdminRevisionInitSubmissionSnapshot>(() =>
      initControllerRef.current!.getSnapshot()
    );

  const lifecycleModalDialogRef = useRef<HTMLDivElement | null>(null);
  const lifecycleModalCloseBtnRef = useRef<HTMLButtonElement | null>(null);
  const lifecycleModalPreviousFocusRef = useRef<HTMLElement | null>(null);
  const isLifecycleModalOpen = Boolean(
    activeLifecycleTarget && isAuthorizedOwner
  );

  const handleOpenLifecycleModal = useCallback(
    (targetUser: AdminUser) => {
      if (
        typeof document !== 'undefined' &&
        document.activeElement instanceof HTMLElement
      ) {
        lifecycleModalPreviousFocusRef.current = document.activeElement;
      }
      setActiveLifecycleTarget(targetUser);
      const rev = getAdminUserRevision(targetUser);
      let nextOp: AdminLifecycleOperation = 'ChangeRole';
      if (rev === undefined) {
        nextOp = 'InitializeRevision';
      } else if (!targetUser.isActive) {
        nextOp = 'Reactivate';
      } else {
        nextOp = 'ChangeRole';
      }
      setSelectedOperation(nextOp);
      const defaultRole =
        targetUser.role === AdminRole.ContentEditor
          ? AdminRole.RightsReviewer
          : AdminRole.ContentEditor;
      setSelectedTargetRole(defaultRole);
      initControllerRef.current?.resetForTarget(
        currentUser,
        targetUser,
        directorySnapshot.requestGeneration,
        false,
        nextOp,
        nextOp === 'ChangeRole' ? defaultRole : null
      );
    },
    [currentUser, directorySnapshot.requestGeneration]
  );

  const handleCloseLifecycleModal = useCallback(() => {
    if (initControllerRef.current?.getSnapshot().status === 'submitting') {
      return;
    }
    setActiveLifecycleTarget(null);
    initControllerRef.current?.resetForTarget(
      currentUser,
      null,
      directorySnapshot.requestGeneration,
      false,
      null,
      null
    );
  }, [currentUser, directorySnapshot.requestGeneration]);

  // Lock background document scrolling while the lifecycle modal is open
  useEffect(() => {
    if (
      !isLifecycleModalOpen ||
      typeof document === 'undefined' ||
      !document.body
    ) {
      return;
    }
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [isLifecycleModalOpen]);

  // Focus management and restoration for the lifecycle modal
  useEffect(() => {
    if (!isLifecycleModalOpen || typeof document === 'undefined') {
      return;
    }
    if (
      !lifecycleModalPreviousFocusRef.current &&
      document.activeElement instanceof HTMLElement
    ) {
      lifecycleModalPreviousFocusRef.current = document.activeElement;
    }
    const focusTimer = setTimeout(() => {
      if (
        lifecycleModalCloseBtnRef.current &&
        !lifecycleModalCloseBtnRef.current.disabled
      ) {
        lifecycleModalCloseBtnRef.current.focus();
      } else {
        lifecycleModalDialogRef.current?.focus();
      }
    }, 0);
    return () => {
      clearTimeout(focusTimer);
      const prevEl = lifecycleModalPreviousFocusRef.current;
      if (
        prevEl &&
        typeof prevEl.focus === 'function' &&
        (typeof document.contains !== 'function' || document.contains(prevEl))
      ) {
        prevEl.focus();
      }
      lifecycleModalPreviousFocusRef.current = null;
    };
  }, [isLifecycleModalOpen]);

  // Keyboard accessibility: Escape-to-close (respecting submission lock) and Tab focus trap
  useEffect(() => {
    if (!isLifecycleModalOpen || typeof window === 'undefined') {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (initControllerRef.current?.getSnapshot().status === 'submitting') {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        handleCloseLifecycleModal();
        return;
      }

      if (event.key === 'Tab') {
        const dialogEl = lifecycleModalDialogRef.current;
        if (!dialogEl || typeof document === 'undefined') return;
        const focusables = Array.from(
          dialogEl.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'
          )
        );
        if (focusables.length === 0) {
          event.preventDefault();
          dialogEl.focus();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (event.shiftKey) {
          if (!active || active === first || !focusables.includes(active)) {
            event.preventDefault();
            last.focus();
          }
        } else {
          if (!active || active === last || !focusables.includes(active)) {
            event.preventDefault();
            first.focus();
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isLifecycleModalOpen, handleCloseLifecycleModal]);

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

  const handleSelectLifecycleOperation = useCallback(
    (nextOp: AdminLifecycleOperation) => {
      setSelectedOperation(nextOp);
      initControllerRef.current?.resetConfirmationForOperationChange(
        nextOp,
        nextOp === 'ChangeRole' ? selectedTargetRole : null
      );
    },
    [selectedTargetRole]
  );

  const handleSelectTargetRole = useCallback(
    (nextRole: AdminRole) => {
      setSelectedTargetRole(nextRole);
      initControllerRef.current?.resetConfirmationForOperationChange(
        selectedOperation,
        nextRole
      );
    },
    [selectedOperation]
  );

  const handleToggleLifecycleConfirmation = useCallback(
    (
      checked: boolean,
      effectiveOperation: AdminLifecycleOperation,
      proposedRole?: AdminRole
    ) => {
      initControllerRef.current?.setConfirmed(
        checked,
        currentUser,
        activeTabId,
        activeLifecycleTarget,
        directorySnapshot,
        effectiveOperation,
        proposedRole
      );
    },
    [currentUser, activeTabId, activeLifecycleTarget, directorySnapshot]
  );

  const handleExecuteLifecycleOperation = useCallback(
    async (
      effectiveOp: AdminLifecycleOperation,
      proposedRole?: AdminRole
    ) => {
      const initController = initControllerRef.current;
      if (!initController || !activeLifecycleTarget) return;

      const initInvoker =
        invokeInitializeRevision ??
        ((input: InitializeAdminRevisionClientInput) =>
          initializeAdminRevision(input, clientDeps));
      const changeRoleInvoker =
        invokeChangeRole ??
        ((input: ChangeAdminRoleClientInput) =>
          changeAdminRole(input, clientDeps));
      const deactivateInvoker =
        invokeDeactivate ??
        ((input: DeactivateAdminClientInput) =>
          deactivateAdmin(input, clientDeps));
      const reactivateInvoker =
        invokeReactivate ??
        ((input: ReactivateAdminClientInput) =>
          reactivateAdmin(input, clientDeps));

      await initController.submitLifecycleOperation({
        caller: currentUser,
        activeTabId,
        target: activeLifecycleTarget,
        operation: effectiveOp,
        proposedRole,
        directorySnapshot,
        invokeInit: initInvoker,
        invokeChangeRole: changeRoleInvoker,
        invokeDeactivate: deactivateInvoker,
        invokeReactivate: reactivateInvoker,
        refreshDirectory: executeDirectoryLoad,
        onModalClose: () => {
          setActiveLifecycleTarget(null);
        },
      });
    },
    [
      activeLifecycleTarget,
      invokeInitializeRevision,
      invokeChangeRole,
      invokeDeactivate,
      invokeReactivate,
      clientDeps,
      currentUser,
      activeTabId,
      directorySnapshot,
      executeDirectoryLoad,
    ]
  );

  const handleRefreshAfterInitFailure = useCallback(async () => {
    await executeDirectoryLoad();
    const latestSnap = controllerRef.current?.getSnapshot();
    if (latestSnap && activeLifecycleTarget) {
      const updatedTarget =
        latestSnap.users.find((u) => u.id === activeLifecycleTarget.id) ?? null;
      setActiveLifecycleTarget(updatedTarget);
      const updatedRev = getAdminUserRevision(updatedTarget);
      const nextOp: AdminLifecycleOperation =
        updatedRev === undefined
          ? 'InitializeRevision'
          : updatedTarget && !updatedTarget.isActive
          ? 'Reactivate'
          : 'ChangeRole';
      setSelectedOperation(nextOp);
      initControllerRef.current?.resetForTarget(
        currentUser,
        updatedTarget,
        latestSnap.requestGeneration,
        false,
        nextOp,
        nextOp === 'ChangeRole' ? selectedTargetRole : null
      );
    }
  }, [executeDirectoryLoad, activeLifecycleTarget, currentUser, selectedTargetRole]);

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
    const initController = initControllerRef.current!;
    initController.mount();
    const unsubscribe = initController.subscribe((nextSnap) => {
      setInitSubmissionSnapshot(nextSnap);
    });
    return () => {
      unsubscribe();
      initController.unmount();
    };
  }, []);

  useEffect(() => {
    initControllerRef.current?.syncContext(
      currentUser,
      activeTabId,
      activeLifecycleTarget,
      directorySnapshot
    );
    if (!isAuthorizedOwner && activeLifecycleTarget) {
      setActiveLifecycleTarget(null);
    }
  }, [
    currentUser,
    activeTabId,
    activeLifecycleTarget,
    directorySnapshot,
    isAuthorizedOwner,
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

        {/* Bilingual Governance & Guarded Lifecycle Notice */}
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

        {/* Completed Lifecycle Operation Banner */}
        {initSubmissionSnapshot.status === 'succeeded' && (
          <div
            className="mt-3 p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 flex items-center justify-between gap-2.5 text-xs text-emerald-900 dark:text-emerald-200"
            role="status"
            data-testid="admin-lifecycle-completed-banner"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Shield className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="font-bold">
                {isAr
                  ? ADMIN_LIFECYCLE_OPERATION_COMPLETED_LABEL_AR
                  : ADMIN_LIFECYCLE_OPERATION_COMPLETED_LABEL_EN}
              </span>
              {initSubmissionSnapshot.lastAuditEventId && (
                <span
                  className="font-mono text-[11px] text-emerald-700 dark:text-emerald-300 truncate"
                  data-testid="admin-lifecycle-audit-receipt-id"
                >
                  ({initSubmissionSnapshot.lastAuditEventId})
                </span>
              )}
            </div>
          </div>
        )}

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

                      {/* Identity & Lifecycle Action Bar */}
                      {(() => {
                        const isOwnerAccount = user.role === AdminRole.Owner;
                        const isProtectedAccount = isOwnerAccount || isCurrentSession;
                        const userRev = getAdminUserRevision(user);
                        const isSafeRevision = userRev !== undefined;

                        return (
                          <div className="pt-2 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2 flex-wrap text-[11px]">
                            <div className="flex items-center gap-1.5 font-mono text-gray-500 dark:text-gray-400 truncate">
                              <span>{user.id}</span>
                              {isSafeRevision && (
                                <span
                                  className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold font-mono"
                                  data-testid={`user-revision-indicator-card-${user.id}`}
                                >
                                  v{userRev}
                                </span>
                              )}
                            </div>

                            {!isAuthorizedOwner ? (
                              <span
                                className="inline-flex items-center gap-1 font-semibold text-gray-400 dark:text-gray-500 shrink-0"
                                data-testid={`user-readonly-indicator-${user.id}`}
                              >
                                <Lock className="w-3 h-3" />
                                <span>{isAr ? 'للقراءة فقط' : 'Read-Only'}</span>
                              </span>
                            ) : isProtectedAccount ? (
                              <span
                                className="inline-flex items-center gap-1 font-semibold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 shrink-0"
                                data-testid={`user-protected-badge-${user.id}`}
                              >
                                <Lock className="w-3 h-3" />
                                <span>
                                  {isCurrentSession
                                    ? isAr ? 'الجلسة الحالية' : 'Current Session'
                                    : isAr ? 'حساب مالك محمي' : 'Protected Owner'}
                                </span>
                              </span>
                            ) : isSafeRevision ? (
                              <button
                                type="button"
                                onClick={() => handleOpenLifecycleModal(user)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 border border-emerald-200 dark:border-emerald-800 transition-colors cursor-pointer shrink-0"
                                data-testid={`admin-lifecycle-trigger-card-${user.id}`}
                                aria-label={isAr ? `إدارة حساب: ${user.name}` : `Manage account: ${user.name}`}
                              >
                                <Shield className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                <span>{isAr ? 'إدارة الحساب' : 'Manage Account'}</span>
                                <span
                                  className="text-[10px] px-1 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200 font-mono font-bold"
                                  data-testid={`user-revision-badge-card-${user.id}`}
                                >
                                  v{userRev}
                                </span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleOpenLifecycleModal(user)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 border border-amber-200 dark:border-amber-800 transition-colors cursor-pointer shrink-0"
                                data-testid={`admin-lifecycle-init-trigger-card-${user.id}`}
                                aria-label={isAr ? `${ADMIN_LIFECYCLE_INITIALIZE_ACTION_LABEL_AR}: ${user.name}` : `${ADMIN_LIFECYCLE_INITIALIZE_ACTION_LABEL_EN}: ${user.name}`}
                              >
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                                <span>{isAr ? ADMIN_LIFECYCLE_INITIALIZE_ACTION_LABEL_AR : ADMIN_LIFECYCLE_INITIALIZE_ACTION_LABEL_EN}</span>
                              </button>
                            )}
                          </div>
                        );
                      })()}
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
                        {isAr ? 'التحكم والإجراءات' : 'Actions & Access'}
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

                          {/* Access Mode & Lifecycle Action */}
                          <td className="py-3 px-4 text-end">
                            {(() => {
                              const isOwnerAccount = user.role === AdminRole.Owner;
                              const isProtectedAccount = isOwnerAccount || isCurrentSession;
                              const userRev = getAdminUserRevision(user);
                              const isSafeRevision = userRev !== undefined;

                              if (!isAuthorizedOwner) {
                                return (
                                  <span
                                    className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 inline-flex items-center gap-1"
                                    data-testid={`user-readonly-indicator-${user.id}`}
                                  >
                                    <Lock className="w-3 h-3" />
                                    <span>{isAr ? 'للقراءة فقط' : 'Read-Only'}</span>
                                  </span>
                                );
                              }

                              if (isProtectedAccount) {
                                return (
                                  <span
                                    className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 inline-flex items-center gap-1 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700"
                                    data-testid={`user-protected-badge-${user.id}`}
                                  >
                                    <Lock className="w-3 h-3" />
                                    <span>
                                      {isCurrentSession
                                        ? isAr ? 'الجلسة الحالية' : 'Current Session'
                                        : isAr ? 'حساب مالك محمي' : 'Protected Owner'}
                                    </span>
                                  </span>
                                );
                              }

                              if (isSafeRevision) {
                                return (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenLifecycleModal(user)}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 border border-emerald-200 dark:border-emerald-800 transition-colors cursor-pointer"
                                    data-testid={`admin-lifecycle-trigger-${user.id}`}
                                    aria-label={isAr ? `إدارة حساب: ${user.name}` : `Manage account: ${user.name}`}
                                  >
                                    <Shield className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                    <span>{isAr ? 'إدارة الحساب' : 'Manage Account'}</span>
                                    <span
                                      className="text-[10px] px-1 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200 font-mono font-bold"
                                      data-testid={`user-revision-badge-${user.id}`}
                                    >
                                      v{userRev}
                                    </span>
                                  </button>
                                );
                              }

                              return (
                                <button
                                  type="button"
                                  onClick={() => handleOpenLifecycleModal(user)}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 border border-amber-200 dark:border-amber-800 transition-colors cursor-pointer"
                                  data-testid={`admin-lifecycle-init-trigger-${user.id}`}
                                  aria-label={isAr ? `${ADMIN_LIFECYCLE_INITIALIZE_ACTION_LABEL_AR}: ${user.name}` : `${ADMIN_LIFECYCLE_INITIALIZE_ACTION_LABEL_EN}: ${user.name}`}
                                >
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                                  <span>{isAr ? ADMIN_LIFECYCLE_INITIALIZE_ACTION_LABEL_AR : ADMIN_LIFECYCLE_INITIALIZE_ACTION_LABEL_EN}</span>
                                </button>
                              );
                            })()}
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

      {/* 4. Guarded Admin Lifecycle Confirmation Modal (Portaled to document.body outside ViewTransition) */}
      {activeLifecycleTarget &&
        isAuthorizedOwner &&
        (() => {
          const targetRevision = getAdminUserRevision(activeLifecycleTarget);
          const isLegacyTarget = targetRevision === undefined;
          const effectiveOperation: AdminLifecycleOperation = isLegacyTarget
            ? 'InitializeRevision'
            : selectedOperation === 'InitializeRevision'
            ? activeLifecycleTarget.isActive
              ? 'ChangeRole'
              : 'Reactivate'
            : selectedOperation;

          const eligibilityCheck = validateLifecycleOperationEligibility(
            currentUser,
            activeTabId,
            activeLifecycleTarget,
            directorySnapshot,
            effectiveOperation,
            effectiveOperation === 'ChangeRole' ? selectedTargetRole : undefined
          );

          const isSubmittingLifecycle =
            initSubmissionSnapshot.status === 'submitting';

          const isBoundContextMatching =
            initSubmissionSnapshot.isConfirmed &&
            initSubmissionSnapshot.boundCallerUid === currentUser.id &&
            initSubmissionSnapshot.boundTargetUid === activeLifecycleTarget.id &&
            (initSubmissionSnapshot.boundOperation === null ||
              initSubmissionSnapshot.boundOperation === undefined ||
              initSubmissionSnapshot.boundOperation === effectiveOperation) &&
            (effectiveOperation !== 'ChangeRole' ||
              initSubmissionSnapshot.boundProposedRole === null ||
              initSubmissionSnapshot.boundProposedRole === undefined ||
              initSubmissionSnapshot.boundProposedRole === selectedTargetRole);

          const canSubmitLifecycle =
            isAuthorizedOwner &&
            eligibilityCheck.eligible &&
            isBoundContextMatching &&
            !isSubmittingLifecycle &&
            !initSubmissionSnapshot.requiresRefreshBeforeRetry;

          const activeErrorCategory: AdminRevisionInitErrorCategory | null =
            initSubmissionSnapshot.status === 'error'
              ? initSubmissionSnapshot.errorCategory ?? 'unavailable'
              : !eligibilityCheck.eligible
              ? eligibilityCheck.reason ?? 'target-ineligible'
              : null;

          const activeErrorMessage = activeErrorCategory
            ? isAr
              ? initSubmissionSnapshot.errorMessageAr ??
                INIT_REVISION_ERROR_MESSAGES[activeErrorCategory].ar
              : initSubmissionSnapshot.errorMessageEn ??
                INIT_REVISION_ERROR_MESSAGES[activeErrorCategory].en
            : null;

          const showRefreshPrompt =
            initSubmissionSnapshot.requiresRefreshBeforeRetry ||
            (!eligibilityCheck.eligible &&
              activeErrorCategory === 'stale-directory');

          const confirmationCheckboxLabel =
            effectiveOperation === 'InitializeRevision'
              ? isAr
                ? ADMIN_LIFECYCLE_INITIALIZE_CONFIRM_CHECKBOX_AR
                : ADMIN_LIFECYCLE_INITIALIZE_CONFIRM_CHECKBOX_EN
              : effectiveOperation === 'ChangeRole'
              ? isAr
                ? ADMIN_LIFECYCLE_CHANGE_ROLE_CONFIRM_CHECKBOX_AR
                : ADMIN_LIFECYCLE_CHANGE_ROLE_CONFIRM_CHECKBOX_EN
              : effectiveOperation === 'Deactivate'
              ? isAr
                ? ADMIN_LIFECYCLE_DEACTIVATE_CONFIRM_CHECKBOX_AR
                : ADMIN_LIFECYCLE_DEACTIVATE_CONFIRM_CHECKBOX_EN
              : isAr
              ? ADMIN_LIFECYCLE_REACTIVATE_CONFIRM_CHECKBOX_AR
              : ADMIN_LIFECYCLE_REACTIVATE_CONFIRM_CHECKBOX_EN;

          const lifecycleModalNode = (
            <div
              dir={isAr ? 'rtl' : 'ltr'}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-2.5 sm:p-4 md:p-6 overflow-x-hidden"
              data-testid="admin-lifecycle-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="lifecycle-modal-title"
              onClick={(e) => {
                if (e.target === e.currentTarget && !isSubmittingLifecycle) {
                  handleCloseLifecycleModal();
                }
              }}
            >
              <div
                ref={lifecycleModalDialogRef}
                tabIndex={-1}
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl max-w-lg w-full max-h-[90vh] max-h-[90dvh] shadow-2xl flex flex-col overflow-hidden text-start min-w-0 my-auto focus:outline-hidden"
                data-testid="admin-lifecycle-modal-dialog"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Pinned Header */}
                <div
                  className="flex items-start justify-between gap-3 border-b border-gray-100 dark:border-gray-800 px-4 py-3.5 sm:px-6 sm:py-4 shrink-0 bg-white dark:bg-gray-900 min-w-0"
                  data-testid="admin-lifecycle-modal-header"
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-8 w-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                        <Shield className="w-4 h-4" />
                      </div>
                      <h3
                        id="lifecycle-modal-title"
                        className="text-sm sm:text-base font-bold text-gray-900 dark:text-gray-100 break-words min-w-0"
                        data-testid="admin-lifecycle-modal-title"
                      >
                        {isAr
                          ? 'إدارة دورة حياة الحساب الإداري'
                          : 'Administrative Lifecycle Management'}
                      </h3>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 break-words">
                      {isAr
                        ? 'مراجعة وتأكيد الإجراءات الإدارية للحساب المحدد'
                        : 'Review and confirm administrative action for the selected account'}
                    </p>
                  </div>
                  <button
                    ref={lifecycleModalCloseBtnRef}
                    type="button"
                    onClick={handleCloseLifecycleModal}
                    disabled={isSubmittingLifecycle}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                    data-testid="lifecycle-modal-close-btn"
                    aria-label={isAr ? 'إغلاق' : 'Close'}
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Single Scrollable Dialog Body */}
                <div
                  className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-4 sm:px-6 sm:py-5 space-y-4 min-w-0"
                  data-testid="admin-lifecycle-modal-body"
                >
                  {/* Target Account Summary Card */}
                  <div
                    className="bg-gray-50 dark:bg-gray-850 rounded-xl p-3.5 sm:p-4 border border-gray-200/80 dark:border-gray-800/80 space-y-2.5 min-w-0"
                    data-testid="lifecycle-target-identity-card"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap min-w-0">
                      <span
                        className="text-xs font-bold text-gray-900 dark:text-gray-100 break-words min-w-0"
                        data-testid="lifecycle-target-name"
                      >
                        {activeLifecycleTarget.name}
                      </span>
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                          activeLifecycleTarget.isActive
                            ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400'
                            : 'bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                        }`}
                        data-testid="lifecycle-current-status"
                      >
                        {getStatusLabel(activeLifecycleTarget.isActive, isAr)}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs min-w-0">
                      <div className="min-w-0">
                        <span className="text-gray-400 text-[11px] block">
                          {isAr ? 'البريد الإلكتروني' : 'Email'}:
                        </span>
                        <span
                          className="font-mono text-gray-700 dark:text-gray-300 truncate block"
                          data-testid="lifecycle-target-email"
                        >
                          {activeLifecycleTarget.email}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <span className="text-gray-400 text-[11px] block">
                          {isAr ? 'المعرّف الفريد' : 'UID'}:
                        </span>
                        <span
                          className="font-mono text-gray-700 dark:text-gray-300 truncate block"
                          data-testid="lifecycle-target-uid"
                        >
                          {activeLifecycleTarget.id}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <span className="text-gray-400 text-[11px] block">
                          {isAr ? 'الدور الحالي' : 'Current Role'}:
                        </span>
                        <span
                          className="font-bold text-gray-800 dark:text-gray-200 break-words block"
                          data-testid="lifecycle-current-role"
                        >
                          {getRoleLabel(activeLifecycleTarget.role, isAr)}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <span className="text-gray-400 text-[11px] block">
                          {isAr ? 'المراجعة المعتمدة' : 'Authoritative Revision'}:
                        </span>
                        <span
                          className="font-mono font-bold text-emerald-700 dark:text-emerald-400"
                          data-testid="lifecycle-target-revision"
                        >
                          {targetRevision !== undefined
                            ? `v${targetRevision}`
                            : isAr
                            ? 'غير مهيأ'
                            : 'Not initialized'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Operation Selection */}
                  <div className="space-y-2 min-w-0">
                    <label className="text-xs font-bold text-gray-700 dark:text-gray-300 block">
                      {isAr
                        ? 'الإجراء الإداري المطلوب:'
                        : 'Select Lifecycle Action:'}
                    </label>
                    {isLegacyTarget ? (
                      <select
                        value="InitializeRevision"
                        disabled={true}
                        className="w-full min-w-0 px-3 py-2 bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl text-xs font-semibold text-amber-900 dark:text-amber-200"
                        data-testid="lifecycle-operation-select"
                      >
                        <option value="InitializeRevision">
                          {isAr
                            ? ADMIN_LIFECYCLE_INITIALIZE_ACTION_LABEL_AR
                            : ADMIN_LIFECYCLE_INITIALIZE_ACTION_LABEL_EN}
                        </option>
                      </select>
                    ) : (
                      <select
                        value={effectiveOperation}
                        onChange={(e) =>
                          handleSelectLifecycleOperation(
                            e.target.value as AdminLifecycleOperation
                          )
                        }
                        disabled={isSubmittingLifecycle}
                        className="w-full min-w-0 px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-semibold text-gray-900 dark:text-gray-100 focus:outline-hidden focus:border-emerald-500 cursor-pointer disabled:opacity-60"
                        data-testid="lifecycle-operation-select"
                      >
                        <option value="ChangeRole">
                          {isAr
                            ? ADMIN_LIFECYCLE_CHANGE_ROLE_LABEL_AR
                            : ADMIN_LIFECYCLE_CHANGE_ROLE_LABEL_EN}
                        </option>
                        {activeLifecycleTarget.isActive ? (
                          <option value="Deactivate">
                            {isAr
                              ? ADMIN_LIFECYCLE_DEACTIVATE_LABEL_AR
                              : ADMIN_LIFECYCLE_DEACTIVATE_LABEL_EN}
                          </option>
                        ) : (
                          <option value="Reactivate">
                            {isAr
                              ? ADMIN_LIFECYCLE_REACTIVATE_LABEL_AR
                              : ADMIN_LIFECYCLE_REACTIVATE_LABEL_EN}
                          </option>
                        )}
                      </select>
                    )}
                  </div>

                  {/* Role selection if ChangeRole on versioned account */}
                  {!isLegacyTarget && effectiveOperation === 'ChangeRole' && (
                    <div className="space-y-2 bg-gray-50/50 dark:bg-gray-850/50 p-3.5 rounded-xl border border-gray-200/60 dark:border-gray-800/60 min-w-0">
                      <label className="text-xs font-bold text-gray-700 dark:text-gray-300 block">
                        {isAr
                          ? 'الدور الإداري الجديد المقترح:'
                          : 'Proposed Target Role:'}
                      </label>
                      <select
                        value={selectedTargetRole}
                        onChange={(e) =>
                          handleSelectTargetRole(e.target.value as AdminRole)
                        }
                        disabled={isSubmittingLifecycle}
                        className="w-full min-w-0 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-semibold text-gray-900 dark:text-gray-100 focus:outline-hidden focus:border-emerald-500 cursor-pointer disabled:opacity-60"
                        data-testid="lifecycle-target-role-select"
                      >
                        {NON_OWNER_LIFECYCLE_ROLES.map((r) => (
                          <option
                            key={r}
                            value={r}
                            disabled={r === activeLifecycleTarget.role}
                          >
                            {getRoleLabel(r, isAr)}{' '}
                            {r === activeLifecycleTarget.role
                              ? isAr
                                ? '(الدور الحالي)'
                                : '(Current)'
                              : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Proposed Summary Box */}
                  <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200/60 dark:border-blue-900/40 rounded-xl text-xs space-y-1.5 min-w-0">
                    <span className="font-bold text-blue-900 dark:text-blue-200 block">
                      {isAr
                        ? 'ملخص الإجراء المقترح:'
                        : 'Proposed Action Summary:'}
                    </span>
                    <div
                      className="text-blue-800 dark:text-blue-300 space-y-1 break-words"
                      data-testid="lifecycle-proposed-summary"
                    >
                      {effectiveOperation === 'InitializeRevision' ? (
                        <div
                          className="space-y-1"
                          data-testid="lifecycle-initialize-explanation"
                        >
                          <p
                            className="font-semibold"
                            data-testid="lifecycle-proposed-operation"
                          >
                            {isAr
                              ? `الإجراء المقترح: تهيئة المراجعة الأولية للحساب [${activeLifecycleTarget.name}]`
                              : `Proposed Operation: ${ADMIN_LIFECYCLE_INITIALIZE_ACTION_LABEL_EN} for account [${activeLifecycleTarget.name}]`}
                          </p>
                          <p>
                            {isAr
                              ? ADMIN_LIFECYCLE_INITIALIZE_EXPLANATION_AR
                              : ADMIN_LIFECYCLE_INITIALIZE_EXPLANATION_EN}
                          </p>
                        </div>
                      ) : effectiveOperation === 'ChangeRole' ? (
                        <p>
                          {isAr
                            ? `تغيير الدور من [${getRoleLabel(activeLifecycleTarget.role, isAr)}] إلى [${getRoleLabel(selectedTargetRole, isAr)}] (المراجعة المتوقعة: ${targetRevision ?? 1})`
                            : `Change role from [${getRoleLabel(activeLifecycleTarget.role, isAr)}] to [${getRoleLabel(selectedTargetRole, isAr)}] (Expected revision: ${targetRevision ?? 1})`}
                        </p>
                      ) : effectiveOperation === 'Deactivate' ? (
                        <p>
                          {isAr
                            ? `تعطيل حساب [${activeLifecycleTarget.name}] وإيقاف صلاحياته الفعالة (المراجعة المتوقعة: ${targetRevision ?? 1})`
                            : `Deactivate account [${activeLifecycleTarget.name}] and revoke active permissions (Expected revision: ${targetRevision ?? 1})`}
                        </p>
                      ) : (
                        <p>
                          {isAr
                            ? `إعادة تفعيل حساب [${activeLifecycleTarget.name}] واستعادة صلاحيات دور [${getRoleLabel(activeLifecycleTarget.role, isAr)}] (المراجعة المتوقعة: ${targetRevision ?? 1})`
                            : `Reactivate account [${activeLifecycleTarget.name}] and restore permissions for role [${getRoleLabel(activeLifecycleTarget.role, isAr)}] (Expected revision: ${targetRevision ?? 1})`}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Unified Guarded Lifecycle Confirmation & Submission Controls */}
                  <div className="space-y-3 min-w-0">
                    {/* Dedicated Explicit Confirmation Checkbox */}
                    <label
                      className={`flex items-start gap-2.5 p-3.5 rounded-xl border text-xs transition-colors min-w-0 ${
                        !eligibilityCheck.eligible ||
                        isSubmittingLifecycle ||
                        initSubmissionSnapshot.requiresRefreshBeforeRetry
                          ? 'bg-gray-50 dark:bg-gray-850 border-gray-200 dark:border-gray-800 opacity-75 cursor-not-allowed'
                          : 'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200/80 dark:border-emerald-800/60 cursor-pointer'
                      }`}
                      data-testid="lifecycle-init-confirmation-box"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(isBoundContextMatching)}
                        disabled={
                          !eligibilityCheck.eligible ||
                          isSubmittingLifecycle ||
                          initSubmissionSnapshot.requiresRefreshBeforeRetry
                        }
                        onChange={(e) =>
                          handleToggleLifecycleConfirmation(
                            e.target.checked,
                            effectiveOperation,
                            effectiveOperation === 'ChangeRole'
                              ? selectedTargetRole
                              : undefined
                          )
                        }
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 shrink-0"
                        data-testid="lifecycle-init-confirm-checkbox"
                      />
                      <span
                        className="text-gray-800 dark:text-gray-200 font-medium leading-relaxed break-words min-w-0"
                        data-testid="lifecycle-init-confirm-label"
                      >
                        {confirmationCheckboxLabel}
                      </span>
                    </label>

                    {/* Compact Progress Indicator while Submitting */}
                    {isSubmittingLifecycle && (
                      <div
                        className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 flex items-center gap-2.5 text-xs text-emerald-800 dark:text-emerald-200 min-w-0"
                        role="status"
                        data-testid="lifecycle-submitting-indicator"
                      >
                        <Loader2 className="w-4 h-4 animate-spin text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <span className="font-semibold break-words min-w-0">
                          {isAr
                            ? 'جاري تنفيذ الإجراء الإداري على الخادم...'
                            : 'Executing administrative lifecycle operation on server...'}
                        </span>
                      </div>
                    )}

                    {/* Sanitized Failure / Ineligibility Notice */}
                    {activeErrorMessage && !isSubmittingLifecycle && (
                      <div
                        className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/80 space-y-2.5 text-xs text-rose-900 dark:text-rose-200 min-w-0"
                        role="alert"
                        data-testid="lifecycle-submission-error"
                      >
                        <div className="flex items-start gap-2 min-w-0">
                          <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                          <p
                            className="font-semibold leading-relaxed break-words min-w-0"
                            data-testid="lifecycle-submission-error-message"
                          >
                            {activeErrorMessage}
                          </p>
                        </div>
                        {showRefreshPrompt && (
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() =>
                                void handleRefreshAfterInitFailure()
                              }
                              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                              data-testid="lifecycle-refresh-directory-btn"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span>
                                {isAr
                                  ? 'تحديث الدليل الآن'
                                  : 'Refresh Directory Now'}
                              </span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Pinned Actions Footer */}
                <div
                  className="flex items-center justify-end gap-2.5 px-4 py-3.5 sm:px-6 sm:py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-850/50 shrink-0 flex-wrap"
                  data-testid="admin-lifecycle-modal-footer"
                >
                  <button
                    type="button"
                    onClick={handleCloseLifecycleModal}
                    disabled={isSubmittingLifecycle}
                    className="px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-bold rounded-xl transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    data-testid="lifecycle-cancel-btn"
                  >
                    {isAr ? 'إلغاء' : 'Cancel'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void handleExecuteLifecycleOperation(
                        effectiveOperation,
                        effectiveOperation === 'ChangeRole'
                          ? selectedTargetRole
                          : undefined
                      )
                    }
                    disabled={!canSubmitLifecycle}
                    aria-disabled={canSubmitLifecycle ? 'false' : 'true'}
                    className={`px-4 py-2 text-xs font-bold rounded-xl inline-flex items-center gap-1.5 transition-colors ${
                      canSubmitLifecycle
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer'
                        : 'bg-gray-300 dark:bg-gray-800 text-gray-500 dark:text-gray-500 cursor-not-allowed opacity-75'
                    }`}
                    data-testid="lifecycle-confirm-btn"
                  >
                    {isSubmittingLifecycle ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Shield className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {isSubmittingLifecycle
                        ? isAr
                          ? 'جاري التنفيذ...'
                          : 'Processing...'
                        : isAr
                        ? ADMIN_LIFECYCLE_CONFIRM_OPERATION_LABEL_AR
                        : ADMIN_LIFECYCLE_CONFIRM_OPERATION_LABEL_EN}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          );

          if (typeof document !== 'undefined' && document.body) {
            return createPortal(lifecycleModalNode, document.body);
          }

          return lifecycleModalNode;
        })()}

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

