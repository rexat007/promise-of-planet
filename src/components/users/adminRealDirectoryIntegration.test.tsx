import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';

let currentMockLanguage: 'ar' | 'en' = 'ar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      get language() {
        return currentMockLanguage;
      },
      changeLanguage: vi.fn(async (nextLang: string) => {
        currentMockLanguage = nextLang === 'en' ? 'en' : 'ar';
      }),
    },
  }),
}));

const i18n = {
  changeLanguage: async (nextLang: 'ar' | 'en') => {
    currentMockLanguage = nextLang;
  },
};

import { AdminRole, AdminPermission, AdminDomain, type AdminUser } from '../../types/admin';
import { AdminAccessService } from '../../services/adminAccess';
import {
  AdminIdentityClientError,
  changeAdminRole,
  deactivateAdmin,
  initializeAdminRevision,
  listAdminUsers,
  reactivateAdmin,
  type AdminIdentityClientDependencies,
  type AdminLifecycleClientResponse,
  type ListAdminUsersClientResponse,
} from '../../services/adminIdentityManagementClient';
import {
  AdminLayout,
  CANONICAL_NAVIGATION_ITEMS,
  attemptTabNavigation,
  resolveAuthorizedTab,
} from '../layout/AdminLayout';
import {
  ADMIN_DIRECTORY_MUTATION_DISABLED_NOTICE_AR,
  ADMIN_DIRECTORY_MUTATION_DISABLED_NOTICE_EN,
  ADMIN_LIFECYCLE_LEGACY_UNVERSIONED_NOTICE_AR,
  ADMIN_LIFECYCLE_LEGACY_UNVERSIONED_NOTICE_EN,
  ADMIN_LIFECYCLE_INITIALIZE_ACTION_LABEL_AR,
  ADMIN_LIFECYCLE_INITIALIZE_ACTION_LABEL_EN,
  ADMIN_LIFECYCLE_CHANGE_ROLE_LABEL_AR,
  ADMIN_LIFECYCLE_CHANGE_ROLE_LABEL_EN,
  ADMIN_LIFECYCLE_DEACTIVATE_LABEL_AR,
  ADMIN_LIFECYCLE_DEACTIVATE_LABEL_EN,
  ADMIN_LIFECYCLE_REACTIVATE_LABEL_AR,
  ADMIN_LIFECYCLE_REACTIVATE_LABEL_EN,
  ADMIN_LIFECYCLE_CONFIRM_OPERATION_LABEL_AR,
  ADMIN_LIFECYCLE_CONFIRM_OPERATION_LABEL_EN,
  ADMIN_LIFECYCLE_OPERATION_COMPLETED_LABEL_AR,
  ADMIN_LIFECYCLE_OPERATION_COMPLETED_LABEL_EN,
  ADMIN_LIFECYCLE_REVISION_CONFLICT_LABEL_AR,
  ADMIN_LIFECYCLE_REVISION_CONFLICT_LABEL_EN,
  ADMIN_LIFECYCLE_REFRESH_REQUIRED_LABEL_AR,
  ADMIN_LIFECYCLE_REFRESH_REQUIRED_LABEL_EN,
  ADMIN_LIFECYCLE_PERMISSION_DENIED_LABEL_AR,
  ADMIN_LIFECYCLE_PERMISSION_DENIED_LABEL_EN,
  ADMIN_LIFECYCLE_INITIALIZE_EXPLANATION_AR,
  ADMIN_LIFECYCLE_INITIALIZE_EXPLANATION_EN,
  ADMIN_LIFECYCLE_INITIALIZE_CONFIRM_CHECKBOX_AR,
  ADMIN_LIFECYCLE_INITIALIZE_CONFIRM_CHECKBOX_EN,
  ADMIN_LIFECYCLE_CHANGE_ROLE_CONFIRM_CHECKBOX_AR,
  ADMIN_LIFECYCLE_CHANGE_ROLE_CONFIRM_CHECKBOX_EN,
  ADMIN_LIFECYCLE_DEACTIVATE_CONFIRM_CHECKBOX_AR,
  ADMIN_LIFECYCLE_DEACTIVATE_CONFIRM_CHECKBOX_EN,
  ADMIN_LIFECYCLE_REACTIVATE_CONFIRM_CHECKBOX_AR,
  ADMIN_LIFECYCLE_REACTIVATE_CONFIRM_CHECKBOX_EN,
  INIT_REVISION_ERROR_MESSAGES,
  NON_OWNER_LIFECYCLE_ROLES,
  AdminDirectoryLoadController,
  AdminRevisionInitializationController,
  AdminUsersManagement,
  classifyDirectoryLoadFailure,
  filterAdminDirectoryEntries,
  isAuthorizedOwnerForUsersDirectory,
  isTargetEligibleForRevisionInitialization,
  validateCanonicalDirectoryUsersList,
  validateLifecycleOperationEligibility,
  validateLifecycleSuccessResponse,
} from './AdminUsersManagement';

const ACTIVE_OWNER: AdminUser = Object.freeze({
  id: 'owner-session-900',
  name: 'Nadia Al-Mansoor',
  email: 'nadia.owner@promiseofplanet.org',
  role: AdminRole.Owner,
  isActive: true,
});

const INACTIVE_OWNER: AdminUser = Object.freeze({
  id: 'owner-inactive-901',
  name: 'Inactive Owner',
  email: 'inactive.owner@promiseofplanet.org',
  role: AdminRole.Owner,
  isActive: false,
});

const NON_OWNER_USERS: ReadonlyArray<AdminUser> = Object.freeze([
  {
    id: 'ce-101',
    name: 'Content Editor User',
    email: 'ce@promiseofplanet.org',
    role: AdminRole.ContentEditor,
    isActive: true,
  },
  {
    id: 'lc-102',
    name: 'Library Curator User',
    email: 'lc@promiseofplanet.org',
    role: AdminRole.LibraryCurator,
    isActive: true,
  },
  {
    id: 'rr-103',
    name: 'Rights Reviewer User',
    email: 'rr@promiseofplanet.org',
    role: AdminRole.RightsReviewer,
    isActive: true,
  },
  {
    id: 'tm-104',
    name: 'Training Manager User',
    email: 'tm@promiseofplanet.org',
    role: AdminRole.TrainingManager,
    isActive: true,
  },
  {
    id: 'tr-105',
    name: 'Trainer User',
    email: 'tr@promiseofplanet.org',
    role: AdminRole.Trainer,
    isActive: true,
  },
  {
    id: 'cm-106',
    name: 'Citizen Moderator User',
    email: 'cm@promiseofplanet.org',
    role: AdminRole.CitizenModerator,
    isActive: true,
  },
  {
    id: 'ai-107',
    name: 'AI Assistant User',
    email: 'ai@promiseofplanet.org',
    role: AdminRole.AIAssistant,
    isActive: true,
  },
  {
    id: 'vw-108',
    name: 'Viewer User',
    email: 'vw@promiseofplanet.org',
    role: AdminRole.Viewer,
    isActive: true,
  },
]);

const SERVER_DIRECTORY_FIXTURE: ReadonlyArray<AdminUser> = Object.freeze([
  Object.freeze({
    id: 'srv-admin-001',
    name: 'Dr. Layla Al-Harbi',
    email: 'layla.harbi@promiseofplanet.org',
    role: AdminRole.Owner,
    isActive: true,
  }),
  Object.freeze({
    id: 'srv-admin-002',
    name: 'Tariq Al-Zahrani',
    email: 'tariq.zahrani@promiseofplanet.org',
    role: AdminRole.RightsReviewer,
    isActive: true,
  }),
  Object.freeze({
    id: 'srv-admin-003',
    name: 'Mona Al-Qahtani',
    email: 'mona.qahtani@promiseofplanet.org',
    role: AdminRole.TrainingManager,
    isActive: false,
  }),
]);

function createClientDepsWithDirectory(
  callableImpl: (payload: Record<string, never>) => Promise<{ data: unknown }>,
  currentUid: string | null = ACTIVE_OWNER.id
): AdminIdentityClientDependencies {
  return {
    isBackendConfigured: () => true,
    getAuthenticatedUid: () => currentUid,
    listAdminUsersCallable: callableImpl,
  };
}

describe('AUTH-03C2 — Real Administrative Directory Read-Only UI Integration', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('ar');
  });

  it('1. Active Owner loads actual server directory via listAdminUsers', async () => {
    const callableSpy = vi.fn(async (payload: unknown) => {
      expect(payload).toEqual({});
      return {
        data: {
          admins: SERVER_DIRECTORY_FIXTURE,
        },
      };
    });

    const clientDeps = createClientDepsWithDirectory(callableSpy, ACTIVE_OWNER.id);
    const controller = new AdminDirectoryLoadController();

    const snapshot = await controller.loadDirectory(ACTIVE_OWNER, 'users', () =>
      listAdminUsers(clientDeps)
    );

    expect(callableSpy).toHaveBeenCalledTimes(1);
    expect(snapshot.status).toBe('loaded');
    expect(snapshot.users).toEqual(SERVER_DIRECTORY_FIXTURE);

    const html = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: snapshot.users,
        }}
      />
    );

    expect(html).toContain('data-testid="admin-directory-loaded-state"');
    expect(html).toContain('Dr. Layla Al-Harbi');
    expect(html).toContain('layla.harbi@promiseofplanet.org');
    expect(html).toContain('Tariq Al-Zahrani');
    expect(html).toContain('Mona Al-Qahtani');
  });

  it('2. Directory contains only returned canonical records and never includes AdminAccessService.getMockUsers() entries', async () => {
    const mockUsers = AdminAccessService.getMockUsers();
    const callableSpy = vi.fn(async () => ({
      data: {
        admins: SERVER_DIRECTORY_FIXTURE,
      },
    }));

    const clientDeps = createClientDepsWithDirectory(callableSpy, ACTIVE_OWNER.id);
    const controller = new AdminDirectoryLoadController();
    const snapshot = await controller.loadDirectory(ACTIVE_OWNER, 'users', () =>
      listAdminUsers(clientDeps)
    );

    expect(snapshot.users.map((u) => u.id)).toEqual([
      'srv-admin-001',
      'srv-admin-002',
      'srv-admin-003',
    ]);

    const html = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: snapshot.users,
        }}
      />
    );

    for (const mockUser of mockUsers) {
      expect(snapshot.users.some((u) => u.id === mockUser.id)).toBe(false);
      expect(html).not.toContain(mockUser.email);
      expect(html).not.toContain(mockUser.name);
    }
  });

  it('3. Inactive users returned by server remain visible as inactive', async () => {
    const htmlAr = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: SERVER_DIRECTORY_FIXTURE,
        }}
      />
    );

    expect(htmlAr).toContain('Mona Al-Qahtani');
    expect(htmlAr).toContain('mona.qahtani@promiseofplanet.org');
    expect(htmlAr).toContain('معطل');
    expect(htmlAr).toContain('0 صلاحيات (معطل)');

    await i18n.changeLanguage('en');
    const htmlEn = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: SERVER_DIRECTORY_FIXTURE,
        }}
      />
    );

    expect(htmlEn).toContain('Mona Al-Qahtani');
    expect(htmlEn).toContain('Inactive');
    expect(htmlEn).toContain('0 permissions (inactive)');
  });

  it('4. Empty directory shows zero genuine records and explicit empty state without fallback rows', async () => {
    const callableSpy = vi.fn(async () => ({
      data: {
        admins: [],
      },
    }));
    const clientDeps = createClientDepsWithDirectory(callableSpy, ACTIVE_OWNER.id);
    const controller = new AdminDirectoryLoadController();
    const snapshot = await controller.loadDirectory(ACTIVE_OWNER, 'users', () =>
      listAdminUsers(clientDeps)
    );

    expect(snapshot.status).toBe('empty');
    expect(snapshot.users).toEqual([]);

    const html = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'empty',
          users: [],
        }}
      />
    );

    expect(html).toContain('data-testid="admin-directory-empty-state"');
    expect(html).not.toContain('data-testid="admin-directory-loaded-state"');
    expect(html).not.toContain(ACTIVE_OWNER.email);
  });

  it('5. Non-Owner and inactive Owner cannot access the directory or invoke listAdminUsers', async () => {
    const callableSpy = vi.fn(async () => ({
      data: { admins: SERVER_DIRECTORY_FIXTURE },
    }));
    const controller = new AdminDirectoryLoadController();

    for (const nonOwner of [...NON_OWNER_USERS, INACTIVE_OWNER]) {
      expect(isAuthorizedOwnerForUsersDirectory(nonOwner, 'users')).toBe(false);

      const clientDeps = createClientDepsWithDirectory(callableSpy, nonOwner.id);
      const snapshot = await controller.loadDirectory(nonOwner, 'users', () =>
        listAdminUsers(clientDeps)
      );

      expect(snapshot.status).toBe('unauthorized');
      expect(snapshot.users).toEqual([]);

      const html = renderToStaticMarkup(
        <AdminUsersManagement currentUser={nonOwner} activeTabId="users" />
      );
      expect(html).toContain('data-testid="admin-directory-unauthorized-state"');
      expect(html).not.toContain('data-testid="admin-directory-loaded-state"');
    }

    expect(callableSpy).not.toHaveBeenCalled();
  });

  it('6. Unauthorized response clears any prior records immediately', async () => {
    const controller = new AdminDirectoryLoadController({
      status: 'loaded',
      users: SERVER_DIRECTORY_FIXTURE,
      boundUserUid: ACTIVE_OWNER.id,
      boundTabId: 'users',
    });

    expect(controller.getSnapshot().users).toHaveLength(3);

    const permissionDeniedClient = createClientDepsWithDirectory(async () => {
      throw { code: 'functions/permission-denied', message: 'Denied' };
    }, ACTIVE_OWNER.id);

    const nextSnapshot = await controller.loadDirectory(ACTIVE_OWNER, 'users', () =>
      listAdminUsers(permissionDeniedClient)
    );

    expect(nextSnapshot.status).toBe('unauthorized');
    expect(nextSnapshot.users).toEqual([]);

    const html = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: nextSnapshot.status,
          users: nextSnapshot.users,
        }}
      />
    );
    expect(html).toContain('data-testid="admin-directory-unauthorized-state"');
    expect(html).not.toContain('Dr. Layla Al-Harbi');
  });

  it('7. Network/callable failure does not trigger mock fallback and clears prior records', async () => {
    const controller = new AdminDirectoryLoadController({
      status: 'loaded',
      users: SERVER_DIRECTORY_FIXTURE,
      boundUserUid: ACTIVE_OWNER.id,
      boundTabId: 'users',
    });

    const unavailableClient = createClientDepsWithDirectory(async () => {
      throw { code: 'functions/unavailable', message: 'Service unreachable' };
    }, ACTIVE_OWNER.id);

    const snapshot = await controller.loadDirectory(ACTIVE_OWNER, 'users', () =>
      listAdminUsers(unavailableClient)
    );

    expect(snapshot.status).toBe('unavailable');
    expect(snapshot.users).toEqual([]);

    const html = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: snapshot.status,
          users: snapshot.users,
        }}
      />
    );

    expect(html).toContain('data-testid="admin-directory-unavailable-state"');
    expect(html).not.toContain('Dr. Layla Al-Harbi');
    for (const mockUser of AdminAccessService.getMockUsers()) {
      expect(html).not.toContain(mockUser.email);
    }
  });

  it('8. Malformed response fails closed across all invalid server shapes', async () => {
    const malformedPayloads: unknown[] = [
      null,
      {},
      { admins: 'not-an-array' },
      { admins: [], extraKey: true },
      {
        admins: [
          {
            id: 'srv-1',
            name: 'Valid Name',
            email: 'valid@promiseofplanet.org',
            role: 'SuperAdminInvalid',
            isActive: true,
          },
        ],
      },
      {
        admins: [
          {
            id: 'srv-1',
            name: 'Valid Name',
            email: 'not-an-email',
            role: AdminRole.Owner,
            isActive: true,
          },
        ],
      },
      {
        admins: [
          {
            id: 'dup-1',
            name: 'Admin One',
            email: 'one@promiseofplanet.org',
            role: AdminRole.Owner,
            isActive: true,
          },
          {
            id: 'dup-1',
            name: 'Admin Two',
            email: 'two@promiseofplanet.org',
            role: AdminRole.Viewer,
            isActive: true,
          },
        ],
      },
      {
        admins: [
          {
            id: 'srv-1',
            name: 'Valid Name',
            email: 'valid@promiseofplanet.org',
            role: AdminRole.Owner,
            isActive: 'yes',
          },
        ],
      },
      {
        admins: [
          {
            id: 'srv-1',
            name: 'Valid Name',
            email: 'valid@promiseofplanet.org',
            role: AdminRole.Owner,
            isActive: true,
            extraField: 'unexpected',
          },
        ],
      },
    ];

    for (const badPayload of malformedPayloads) {
      expect(() => validateCanonicalDirectoryUsersList(badPayload)).toThrow(
        AdminIdentityClientError
      );

      const controller = new AdminDirectoryLoadController({
        status: 'loaded',
        users: SERVER_DIRECTORY_FIXTURE,
        boundUserUid: ACTIVE_OWNER.id,
        boundTabId: 'users',
      });

      const snapshot = await controller.loadDirectory(ACTIVE_OWNER, 'users', async () => {
        return badPayload as ListAdminUsersClientResponse;
      });

      expect(snapshot.status).toBe('malformed');
      expect(snapshot.users).toEqual([]);
    }

    const html = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'malformed',
          users: [],
        }}
      />
    );
    expect(html).toContain('data-testid="admin-directory-malformed-state"');
    expect(html).not.toContain('data-testid="admin-directory-loaded-state"');
  });

  it('9. Search, role filter, and status filter remain operational over server records', () => {
    // Search by name
    const byName = filterAdminDirectoryEntries(SERVER_DIRECTORY_FIXTURE, {
      searchQuery: 'layla',
      selectedRoleFilter: 'ALL',
      selectedStatusFilter: 'ALL',
      isAr: true,
    });
    expect(byName.map((u) => u.id)).toEqual(['srv-admin-001']);

    // Search by email
    const byEmail = filterAdminDirectoryEntries(SERVER_DIRECTORY_FIXTURE, {
      searchQuery: 'tariq.zahrani@promiseofplanet.org',
      selectedRoleFilter: 'ALL',
      selectedStatusFilter: 'ALL',
      isAr: false,
    });
    expect(byEmail.map((u) => u.id)).toEqual(['srv-admin-002']);

    // Search by Arabic role label
    const byArRoleLabel = filterAdminDirectoryEntries(SERVER_DIRECTORY_FIXTURE, {
      searchQuery: 'مراجع حقوق الملكية والرخص',
      selectedRoleFilter: 'ALL',
      selectedStatusFilter: 'ALL',
      isAr: true,
    });
    expect(byArRoleLabel.map((u) => u.id)).toEqual(['srv-admin-002']);

    // Filter by canonical role
    const byRole = filterAdminDirectoryEntries(SERVER_DIRECTORY_FIXTURE, {
      searchQuery: '',
      selectedRoleFilter: AdminRole.TrainingManager,
      selectedStatusFilter: 'ALL',
      isAr: true,
    });
    expect(byRole.map((u) => u.id)).toEqual(['srv-admin-003']);

    // Filter by ACTIVE status
    const byActive = filterAdminDirectoryEntries(SERVER_DIRECTORY_FIXTURE, {
      searchQuery: '',
      selectedRoleFilter: 'ALL',
      selectedStatusFilter: 'ACTIVE',
      isAr: true,
    });
    expect(byActive.map((u) => u.id)).toEqual(['srv-admin-001', 'srv-admin-002']);

    // Filter by INACTIVE status
    const byInactive = filterAdminDirectoryEntries(SERVER_DIRECTORY_FIXTURE, {
      searchQuery: '',
      selectedRoleFilter: 'ALL',
      selectedStatusFilter: 'INACTIVE',
      isAr: true,
    });
    expect(byInactive.map((u) => u.id)).toEqual(['srv-admin-003']);
  });

  it('10. Local demo creation action is inaccessible and renders exact bilingual notice', async () => {
    const htmlAr = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: SERVER_DIRECTORY_FIXTURE,
        }}
      />
    );

    expect(htmlAr).toContain('data-testid="admin-directory-mutation-disabled-notice"');
    expect(htmlAr).toContain(ADMIN_DIRECTORY_MUTATION_DISABLED_NOTICE_AR);
    expect(htmlAr).not.toContain('إضافة مستخدم جديد');

    await i18n.changeLanguage('en');
    const htmlEn = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: SERVER_DIRECTORY_FIXTURE,
        }}
      />
    );

    expect(htmlEn).toContain('data-testid="admin-directory-mutation-disabled-notice"');
    expect(htmlEn).toContain(
      ADMIN_DIRECTORY_MUTATION_DISABLED_NOTICE_EN.replace(/'/g, '&#x27;')
    );
    expect(htmlEn).not.toContain('Add New User');
  });

  it('11. Local role/status mutation actions are inaccessible in directory cards and table rows', async () => {
    const htmlAr = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: SERVER_DIRECTORY_FIXTURE,
        }}
      />
    );

    expect(htmlAr).not.toContain('تعديل الصلاحيات');
    expect(htmlAr).toContain('للقراءة فقط');

    await i18n.changeLanguage('en');
    const htmlEn = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: SERVER_DIRECTORY_FIXTURE,
        }}
      />
    );

    expect(htmlEn).not.toContain('Edit Access');
    expect(htmlEn).toContain('Read-Only');
  });

  it('12. No synthetic session user is injected when currentUser is absent from server directory', () => {
    // ACTIVE_OWNER has id 'owner-session-900', which is NOT in SERVER_DIRECTORY_FIXTURE
    const html = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: SERVER_DIRECTORY_FIXTURE,
        }}
      />
    );

    expect(html).not.toContain(ACTIVE_OWNER.email);
    expect(html).not.toContain(ACTIVE_OWNER.id);
    expect(html).toContain('srv-admin-001');
    expect(html).toContain('srv-admin-002');
    expect(html).toContain('srv-admin-003');
  });

  it('13. RTL/LTR and responsive display remain intact across AdminLayout and AdminUsersManagement', async () => {
    await i18n.changeLanguage('ar');
    const layoutAr = renderToStaticMarkup(
      <AdminLayout
        currentUser={ACTIVE_OWNER}
        onExitAdmin={() => {}}
        initialTab="users"
      />
    );
    expect(layoutAr).toContain('dir="rtl"');
    expect(layoutAr).toContain('data-testid="admin-users-management-root"');

    await i18n.changeLanguage('en');
    const layoutEn = renderToStaticMarkup(
      <AdminLayout
        currentUser={ACTIVE_OWNER}
        onExitAdmin={() => {}}
        initialTab="users"
      />
    );
    expect(layoutEn).toContain('dir="ltr"');
    expect(layoutEn).toContain('data-testid="admin-users-management-root"');
  });

  it('14. Stale responses cannot replace newer state after refresh, user switch, tab change, or unmount', async () => {
    const controller = new AdminDirectoryLoadController();

    let resolveStale!: (value: ListAdminUsersClientResponse) => void;
    const stalePromise = new Promise<ListAdminUsersClientResponse>((resolve) => {
      resolveStale = resolve;
    });

    const staleLoadTask = controller.loadDirectory(
      ACTIVE_OWNER,
      'users',
      () => stalePromise
    );

    // Trigger a newer refresh request before the stale request resolves
    const freshUsers: ReadonlyArray<AdminUser> = Object.freeze([
      Object.freeze({
        id: 'fresh-owner-777',
        name: 'Fresh Directory Owner',
        email: 'fresh.owner@promiseofplanet.org',
        role: AdminRole.Owner,
        isActive: true,
      }),
    ]);

    const freshSnapshot = await controller.loadDirectory(
      ACTIVE_OWNER,
      'users',
      async () => ({ admins: freshUsers })
    );

    expect(freshSnapshot.status).toBe('loaded');
    expect(freshSnapshot.users).toEqual(freshUsers);

    // Resolve stale response now; it must be ignored
    resolveStale({ admins: SERVER_DIRECTORY_FIXTURE });
    const afterStaleResolved = await staleLoadTask;
    expect(afterStaleResolved.status).toBe('loaded');
    expect(afterStaleResolved.users).toEqual(freshUsers);

    // Switching to a non-Owner user immediately invalidates and clears records
    const synced = controller.syncContext(NON_OWNER_USERS[0], 'users');
    expect(synced).toBe(false);
    expect(controller.getSnapshot().status).toBe('unauthorized');
    expect(controller.getSnapshot().users).toEqual([]);

    // Unmounting increments request generation and blocks any in-flight resolution
    let resolveUnmounted!: (value: ListAdminUsersClientResponse) => void;
    const unmountedPromise = new Promise<ListAdminUsersClientResponse>((resolve) => {
      resolveUnmounted = resolve;
    });
    const inFlightBeforeUnmount = controller.loadDirectory(
      ACTIVE_OWNER,
      'users',
      () => unmountedPromise
    );
    controller.unmount();
    resolveUnmounted({ admins: SERVER_DIRECTORY_FIXTURE });
    const postUnmountSnapshot = await inFlightBeforeUnmount;
    expect(postUnmountSnapshot.users).toEqual([]);
  });

  it('15. No direct Firestore administrative write or getMockUsers call exists in AdminLayout or AdminUsersManagement', () => {
    const layoutSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/layout/AdminLayout.tsx'),
      'utf8'
    );
    const managementSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/users/AdminUsersManagement.tsx'),
      'utf8'
    );

    expect(layoutSource).not.toContain('getMockUsers');
    expect(managementSource).not.toContain('getMockUsers');

    const forbiddenFirestoreMutations = [
      'setDoc',
      'updateDoc',
      'deleteDoc',
      'addDoc',
      'writeBatch',
      'runTransaction',
    ];
    for (const api of forbiddenFirestoreMutations) {
      expect(layoutSource).not.toContain(api);
      expect(managementSource).not.toContain(api);
    }

    expect(classifyDirectoryLoadFailure({ code: 'permission-denied' })).toBe(
      'unauthorized'
    );
    expect(classifyDirectoryLoadFailure({ code: 'unavailable' })).toBe(
      'unavailable'
    );
    expect(classifyDirectoryLoadFailure({ code: 'internal' })).toBe(
      'malformed'
    );
  });

  it('16. Existing navigation authorization remains intact for Owner and non-Owner roles', () => {
    expect(resolveAuthorizedTab(ACTIVE_OWNER, 'users', CANONICAL_NAVIGATION_ITEMS)).toBe(
      'users'
    );
    expect(
      attemptTabNavigation(ACTIVE_OWNER, 'users', CANONICAL_NAVIGATION_ITEMS)
    ).toEqual({
      success: true,
      targetTabId: 'users',
    });

    for (const nonOwner of NON_OWNER_USERS) {
      expect(
        attemptTabNavigation(nonOwner, 'users', CANONICAL_NAVIGATION_ITEMS)
      ).toEqual({
        success: false,
        targetTabId: null,
      });
      const resolved = resolveAuthorizedTab(
        nonOwner,
        'users',
        CANONICAL_NAVIGATION_ITEMS
      );
      expect(resolved).not.toBe('users');
    }

    expect(
      resolveAuthorizedTab(INACTIVE_OWNER, 'users', CANONICAL_NAVIGATION_ITEMS)
    ).toBeNull();
    expect(
      AdminAccessService.hasPermission(ACTIVE_OWNER, AdminPermission.ManageUsers)
    ).toBe(true);
    expect(
      isAuthorizedOwnerForUsersDirectory(ACTIVE_OWNER, AdminDomain.Users)
    ).toBe(true);
  });

  it('17. Directory snapshot preserves revision for versioned entries and omits revision for unversioned entries', () => {
    const mixedRawResponse = {
      admins: [
        {
          id: 'admin-ver-1',
          name: 'Versioned User',
          email: 'ver@promiseofplanet.org',
          role: AdminRole.Owner,
          isActive: true,
          revision: 5,
        },
        {
          id: 'admin-leg-2',
          name: 'Legacy User',
          email: 'leg@promiseofplanet.org',
          role: AdminRole.ContentEditor,
          isActive: true,
        },
      ],
    };

    const validated = validateCanonicalDirectoryUsersList(mixedRawResponse);
    expect(validated).toHaveLength(2);
    expect(validated[0].revision).toBe(5);
    expect('revision' in validated[0]).toBe(true);
    expect(validated[1].revision).toBeUndefined();
    expect('revision' in validated[1]).toBe(false);
    expect(Object.keys(validated[1])).toEqual([
      'id',
      'name',
      'email',
      'role',
      'isActive',
    ]);
  });

  it('18. Owner-only control visibility: Active Owner sees lifecycle triggers for eligible versioned identities', () => {
    const versionedDirectory: ReadonlyArray<AdminUser> = [
      {
        id: 'owner-session-900',
        name: 'Nadia Al-Mansoor',
        email: 'nadia.owner@promiseofplanet.org',
        role: AdminRole.Owner,
        isActive: true,
        revision: 1,
      },
      {
        id: 'editor-versioned-01',
        name: 'Zaid Editor',
        email: 'zaid@promiseofplanet.org',
        role: AdminRole.ContentEditor,
        isActive: true,
        revision: 3,
      },
    ];

    const html = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: versionedDirectory,
        }}
      />
    );

    expect(html).toContain('data-testid="admin-lifecycle-trigger-editor-versioned-01"');
    expect(html).toContain('data-testid="admin-lifecycle-trigger-card-editor-versioned-01"');
  });

  it('19. Non-Owner denial: Non-Owner users see zero lifecycle triggers', () => {
    const versionedDirectory: ReadonlyArray<AdminUser> = [
      {
        id: 'editor-versioned-01',
        name: 'Zaid Editor',
        email: 'zaid@promiseofplanet.org',
        role: AdminRole.ContentEditor,
        isActive: true,
        revision: 3,
      },
    ];

    for (const nonOwner of NON_OWNER_USERS) {
      const html = renderToStaticMarkup(
        <AdminUsersManagement
          currentUser={nonOwner}
          activeTabId="users"
          initialDirectoryState={{
            status: 'loaded',
            users: versionedDirectory,
          }}
        />
      );

      expect(html).not.toContain('data-testid="admin-lifecycle-trigger-editor-versioned-01"');
      expect(html).not.toContain('data-testid="admin-lifecycle-trigger-card-editor-versioned-01"');
    }
  });

  it('20. Self and Owner protection: Current Owner session and other Owners never show lifecycle triggers', () => {
    const directoryWithMultipleOwners: ReadonlyArray<AdminUser> = [
      {
        id: 'owner-session-900',
        name: 'Nadia Al-Mansoor (Current Session)',
        email: 'nadia.owner@promiseofplanet.org',
        role: AdminRole.Owner,
        isActive: true,
        revision: 1,
      },
      {
        id: 'other-owner-002',
        name: 'Dr. Layla Al-Harbi (Other Owner)',
        email: 'layla.owner@promiseofplanet.org',
        role: AdminRole.Owner,
        isActive: true,
        revision: 2,
      },
      {
        id: 'editor-versioned-01',
        name: 'Zaid Editor',
        email: 'zaid@promiseofplanet.org',
        role: AdminRole.ContentEditor,
        isActive: true,
        revision: 4,
      },
    ];

    const html = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: directoryWithMultipleOwners,
        }}
      />
    );

    // Self session: protected badge, NO lifecycle trigger
    expect(html).toContain('data-testid="user-protected-badge-owner-session-900"');
    expect(html).not.toContain('data-testid="admin-lifecycle-trigger-owner-session-900"');
    expect(html).not.toContain('data-testid="admin-lifecycle-trigger-card-owner-session-900"');

    // Other Owner: protected badge, NO lifecycle trigger
    expect(html).toContain('data-testid="user-protected-badge-other-owner-002"');
    expect(html).not.toContain('data-testid="admin-lifecycle-trigger-other-owner-002"');
    expect(html).not.toContain('data-testid="admin-lifecycle-trigger-card-other-owner-002"');

    // Eligible non-Owner: HAS lifecycle trigger
    expect(html).toContain('data-testid="admin-lifecycle-trigger-editor-versioned-01"');
  });

  it('21. Missing revision blocking & initialization entry point: Eligible legacy accounts show Initialize legacy account entry point and never show standard mutation triggers', () => {
    const mixedDirectory: ReadonlyArray<AdminUser> = [
      {
        id: 'legacy-curator-01',
        name: 'Legacy Curator',
        email: 'legacy.curator@promiseofplanet.org',
        role: AdminRole.LibraryCurator,
        isActive: true,
      },
      {
        id: 'versioned-curator-02',
        name: 'Versioned Curator',
        email: 'ver.curator@promiseofplanet.org',
        role: AdminRole.LibraryCurator,
        isActive: true,
        revision: 5,
      },
    ];

    const htmlAr = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: mixedDirectory,
        }}
      />
    );

    expect(htmlAr).toContain('data-testid="admin-lifecycle-init-trigger-legacy-curator-01"');
    expect(htmlAr).toContain('data-testid="admin-lifecycle-init-trigger-card-legacy-curator-01"');
    expect(htmlAr).toContain(ADMIN_LIFECYCLE_INITIALIZE_ACTION_LABEL_AR);
    expect(ADMIN_LIFECYCLE_LEGACY_UNVERSIONED_NOTICE_AR).toContain('للقراءة فقط');
    expect(htmlAr).not.toContain('data-testid="admin-lifecycle-trigger-legacy-curator-01"');
    expect(htmlAr).not.toContain('data-testid="admin-lifecycle-trigger-card-legacy-curator-01"');

    expect(htmlAr).toContain('data-testid="admin-lifecycle-trigger-versioned-curator-02"');
    expect(htmlAr).not.toContain('data-testid="admin-lifecycle-init-trigger-versioned-curator-02"');
  });

  it('22. Valid revision display: Authoritative revision number is displayed on badges and in cards', () => {
    const versionedUser: AdminUser = {
      id: 'versioned-reviewer-01',
      name: 'Salma Reviewer',
      email: 'salma@promiseofplanet.org',
      role: AdminRole.RightsReviewer,
      isActive: true,
      revision: 42,
    };

    const html = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: [versionedUser],
        }}
      />
    );

    expect(html).toContain('data-testid="user-revision-badge-versioned-reviewer-01"');
    expect(html).toContain('v42');
    expect(html).toContain('data-testid="user-revision-badge-card-versioned-reviewer-01"');
  });

  it('23. Confirmation content: Explicitly identifies target account, current role, revision, proposed action, and explicit confirmation checkbox in Arabic and English', async () => {
    const targetUser: AdminUser = {
      id: 'target-admin-777',
      name: 'Karim Training',
      email: 'karim@promiseofplanet.org',
      role: AdminRole.Trainer,
      isActive: true,
      revision: 8,
    };

    await i18n.changeLanguage('ar');
    const htmlAr = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: [targetUser],
        }}
        initialLifecycleTarget={targetUser}
        initialLifecycleOperation="ChangeRole"
        initialLifecycleTargetRole={AdminRole.TrainingManager}
      />
    );

    expect(htmlAr).toContain('data-testid="admin-lifecycle-modal"');
    expect(htmlAr).toContain('data-testid="admin-lifecycle-modal-title"');
    expect(htmlAr).toContain('data-testid="lifecycle-target-name"');
    expect(htmlAr).toContain('Karim Training');
    expect(htmlAr).toContain('data-testid="lifecycle-target-email"');
    expect(htmlAr).toContain('karim@promiseofplanet.org');
    expect(htmlAr).toContain('data-testid="lifecycle-target-uid"');
    expect(htmlAr).toContain('target-admin-777');
    expect(htmlAr).toContain('data-testid="lifecycle-target-revision"');
    expect(htmlAr).toContain('v8');
    expect(htmlAr).toContain('data-testid="lifecycle-operation-select"');
    expect(htmlAr).toContain('data-testid="lifecycle-proposed-summary"');
    expect(htmlAr).toContain('data-testid="lifecycle-init-confirm-checkbox"');
    expect(htmlAr).toContain(ADMIN_LIFECYCLE_CHANGE_ROLE_CONFIRM_CHECKBOX_AR);
    expect(NON_OWNER_LIFECYCLE_ROLES).not.toContain(AdminRole.Owner);
    expect(ADMIN_LIFECYCLE_LEGACY_UNVERSIONED_NOTICE_EN).toContain('read-only');

    await i18n.changeLanguage('en');
    const htmlEn = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: [targetUser],
        }}
        initialLifecycleTarget={targetUser}
        initialLifecycleOperation="Deactivate"
      />
    );

    expect(htmlEn).toContain('data-testid="admin-lifecycle-modal"');
    expect(htmlEn).toContain('data-testid="lifecycle-target-name"');
    expect(htmlEn).toContain('Karim Training');
    expect(htmlEn).toContain('data-testid="lifecycle-init-confirm-checkbox"');
    expect(htmlEn).toContain(ADMIN_LIFECYCLE_DEACTIVATE_CONFIRM_CHECKBOX_EN);
    expect(htmlEn).toContain('Deactivate account');

    await i18n.changeLanguage('ar');
  });

  it('24. No callable invocation & confirmation submission unconditionally disabled', () => {
    const targetUser: AdminUser = {
      id: 'target-admin-888',
      name: 'Farah Moderator',
      email: 'farah@promiseofplanet.org',
      role: AdminRole.CitizenModerator,
      isActive: true,
      revision: 3,
    };

    const callableSpy = vi.fn();
    const clientDeps = createClientDepsWithDirectory(callableSpy, ACTIVE_OWNER.id);

    const html = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        clientDeps={clientDeps}
        initialDirectoryState={{
          status: 'loaded',
          users: [targetUser],
        }}
        initialLifecycleTarget={targetUser}
        initialLifecycleOperation="ChangeRole"
        initialLifecycleTargetRole={AdminRole.RightsReviewer}
      />
    );

    expect(html).toContain('data-testid="lifecycle-confirm-btn"');
    const confirmBtnMatch = html.match(/<button[^>]*data-testid="lifecycle-confirm-btn"[^>]*>/) ||
      html.match(/<button[^>]*disabled=""[^>]*data-testid="lifecycle-confirm-btn"[^>]*>/);
    expect(confirmBtnMatch).not.toBeNull();
    expect(confirmBtnMatch![0]).toContain('disabled=""');
    expect(confirmBtnMatch![0]).toContain('aria-disabled="true"');

    expect(callableSpy).not.toHaveBeenCalled();
  });

  it('25. Desktop and mobile consistency: Entry points and indicators are present across both view modes', () => {
    const mixedUsers: ReadonlyArray<AdminUser> = [
      {
        id: 'owner-session-900',
        name: 'Nadia Al-Mansoor',
        email: 'nadia@promiseofplanet.org',
        role: AdminRole.Owner,
        isActive: true,
        revision: 1,
      },
      {
        id: 'versioned-user-01',
        name: 'Versioned Assistant',
        email: 'assistant@promiseofplanet.org',
        role: AdminRole.AIAssistant,
        isActive: true,
        revision: 2,
      },
      {
        id: 'legacy-user-02',
        name: 'Legacy Viewer',
        email: 'viewer@promiseofplanet.org',
        role: AdminRole.Viewer,
        isActive: true,
      },
    ];

    const html = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: mixedUsers,
        }}
      />
    );

    expect(html).toContain('data-testid="user-protected-badge-owner-session-900"');
    expect(html).toContain('data-testid="admin-lifecycle-trigger-versioned-user-01"');
    expect(html).toContain('data-testid="admin-lifecycle-init-trigger-legacy-user-02"');

    expect(html).toContain('data-testid="admin-lifecycle-trigger-card-versioned-user-01"');
    expect(html).toContain('data-testid="admin-lifecycle-init-trigger-card-legacy-user-02"');
  });

  it('26. No regressions in directory reading, search filtering, and invitations integration', () => {
    const multiUsers: ReadonlyArray<AdminUser> = [
      {
        id: 'admin-1',
        name: 'Alice Curator',
        email: 'alice@planet.org',
        role: AdminRole.LibraryCurator,
        isActive: true,
        revision: 1,
      },
      {
        id: 'admin-2',
        name: 'Bob Editor',
        email: 'bob@planet.org',
        role: AdminRole.ContentEditor,
        isActive: false,
        revision: 2,
      },
    ];

    const filtered = filterAdminDirectoryEntries(multiUsers, {
      searchQuery: 'Alice',
      selectedRoleFilter: 'ALL',
      selectedStatusFilter: 'ALL',
      isAr: true,
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('Alice Curator');

    const htmlWithInvites = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: multiUsers,
        }}
        initialInvitationPanelOpen={true}
      />
    );

    expect(htmlWithInvites).toContain('data-testid="admin-invitation-creation-panel"');
  });

  it('27. S4 Owner-only visibility: Only active Owners with ManageUsers see legacy initialization controls; non-Owners and inactive Owners never see them', () => {
    const legacyAccount: AdminUser = {
      id: 'legacy-editor-401',
      name: 'Legacy Editor',
      email: 'legacy.editor@promiseofplanet.org',
      role: AdminRole.ContentEditor,
      isActive: true,
    };

    const ownerHtml = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: [legacyAccount],
        }}
      />
    );
    expect(ownerHtml).toContain('data-testid="admin-lifecycle-init-trigger-legacy-editor-401"');
    expect(ownerHtml).toContain('data-testid="admin-lifecycle-init-trigger-card-legacy-editor-401"');

    const inactiveOwnerHtml = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={INACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: [legacyAccount],
        }}
      />
    );
    expect(inactiveOwnerHtml).not.toContain('data-testid="admin-lifecycle-init-trigger-legacy-editor-401"');
    expect(inactiveOwnerHtml).not.toContain('data-testid="admin-lifecycle-init-trigger-card-legacy-editor-401"');

    for (const nonOwner of NON_OWNER_USERS) {
      const nonOwnerHtml = renderToStaticMarkup(
        <AdminUsersManagement
          currentUser={nonOwner}
          activeTabId="users"
          initialDirectoryState={{
            status: 'loaded',
            users: [legacyAccount],
          }}
        />
      );
      expect(nonOwnerHtml).not.toContain('data-testid="admin-lifecycle-init-trigger-legacy-editor-401"');
      expect(nonOwnerHtml).not.toContain('data-testid="admin-lifecycle-init-trigger-card-legacy-editor-401"');
    }
  });

  it('28. S4 Protected Owner exclusion & Versioned account exclusion: Initialization controls never appear for Owners, current session, or versioned accounts', () => {
    const directoryEntries: ReadonlyArray<AdminUser> = [
      {
        id: 'owner-session-900',
        name: 'Nadia Al-Mansoor (Unversioned Session Owner)',
        email: 'nadia.owner@promiseofplanet.org',
        role: AdminRole.Owner,
        isActive: true,
      },
      {
        id: 'legacy-other-owner-902',
        name: 'Legacy Co-Owner',
        email: 'co.owner@promiseofplanet.org',
        role: AdminRole.Owner,
        isActive: true,
      },
      {
        id: 'versioned-reviewer-903',
        name: 'Versioned Reviewer',
        email: 'ver.reviewer@promiseofplanet.org',
        role: AdminRole.RightsReviewer,
        isActive: true,
        revision: 1,
      },
      {
        id: 'eligible-legacy-trainer-904',
        name: 'Eligible Legacy Trainer',
        email: 'legacy.trainer@promiseofplanet.org',
        role: AdminRole.Trainer,
        isActive: false,
      },
    ];

    const html = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: directoryEntries,
        }}
      />
    );

    // Current session Owner & other Owner: protected badge only, NO init trigger
    expect(html).toContain('data-testid="user-protected-badge-owner-session-900"');
    expect(html).not.toContain('data-testid="admin-lifecycle-init-trigger-owner-session-900"');
    expect(html).toContain('data-testid="user-protected-badge-legacy-other-owner-902"');
    expect(html).not.toContain('data-testid="admin-lifecycle-init-trigger-legacy-other-owner-902"');

    // Versioned non-Owner: standard lifecycle trigger only, NO init trigger
    expect(html).toContain('data-testid="admin-lifecycle-trigger-versioned-reviewer-903"');
    expect(html).not.toContain('data-testid="admin-lifecycle-init-trigger-versioned-reviewer-903"');

    // Eligible unversioned non-Owner: init trigger only, NO standard lifecycle trigger
    expect(html).toContain('data-testid="admin-lifecycle-init-trigger-eligible-legacy-trainer-904"');
    expect(html).toContain('data-testid="admin-lifecycle-init-trigger-card-eligible-legacy-trainer-904"');
    expect(html).not.toContain('data-testid="admin-lifecycle-trigger-eligible-legacy-trainer-904"');
  });

  it('29. S4/S5 InitializeRevision confirmation preview: Shows target identity, Not initialized revision, human-readable Arabic operation labels (no technical InitializeRevision in Arabic text), and role/status preservation explanation in Arabic and English', async () => {
    const legacyTarget: AdminUser = {
      id: 'legacy-tm-505',
      name: 'Huda Training Manager',
      email: 'huda.tm@promiseofplanet.org',
      role: AdminRole.TrainingManager,
      isActive: false,
    };

    await i18n.changeLanguage('ar');
    const htmlAr = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: [legacyTarget],
        }}
        initialLifecycleTarget={legacyTarget}
        initialLifecycleOperation="InitializeRevision"
      />
    );

    expect(htmlAr).toContain('data-testid="admin-lifecycle-modal"');
    expect(htmlAr).toContain('data-testid="lifecycle-target-name"');
    expect(htmlAr).toContain('Huda Training Manager');
    expect(htmlAr).toContain('data-testid="lifecycle-target-email"');
    expect(htmlAr).toContain('huda.tm@promiseofplanet.org');
    expect(htmlAr).toContain('data-testid="lifecycle-target-uid"');
    expect(htmlAr).toContain('legacy-tm-505');
    expect(htmlAr).toContain('data-testid="lifecycle-current-role"');
    expect(htmlAr).toContain('مدير البرامج والتدريب');
    expect(htmlAr).toContain('data-testid="lifecycle-current-status"');
    expect(htmlAr).toContain('معطل');
    expect(htmlAr).toContain('data-testid="lifecycle-target-revision"');
    expect(htmlAr).toContain('غير مهيأ');
    expect(htmlAr).toContain('data-testid="lifecycle-proposed-operation"');
    expect(htmlAr).toContain('الإجراء المقترح: تهيئة المراجعة الأولية للحساب [Huda Training Manager]');
    // Requirement 14: Do not expose technical operation name InitializeRevision in visible Arabic UI text
    const proposedOpArMatch = htmlAr.match(
      /<p[^>]*data-testid="lifecycle-proposed-operation"[^>]*>([^<]+)<\/p>/
    );
    expect(proposedOpArMatch).not.toBeNull();
    expect(proposedOpArMatch![1]).not.toContain('InitializeRevision');
    expect(htmlAr).toContain('data-testid="lifecycle-initialize-explanation"');
    expect(htmlAr).toContain(ADMIN_LIFECYCLE_INITIALIZE_EXPLANATION_AR);
    expect(htmlAr).toContain('data-testid="lifecycle-init-confirm-checkbox"');
    expect(htmlAr).toContain(ADMIN_LIFECYCLE_INITIALIZE_CONFIRM_CHECKBOX_AR);
    expect(htmlAr).not.toContain('data-testid="lifecycle-target-role-select"');

    await i18n.changeLanguage('en');
    const htmlEn = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: [legacyTarget],
        }}
        initialLifecycleTarget={legacyTarget}
        initialLifecycleOperation="InitializeRevision"
      />
    );

    expect(htmlEn).toContain('data-testid="admin-lifecycle-modal"');
    expect(htmlEn).toContain('Huda Training Manager');
    expect(htmlEn).toContain('huda.tm@promiseofplanet.org');
    expect(htmlEn).toContain('legacy-tm-505');
    expect(htmlEn).toContain('Not initialized');
    expect(htmlEn).toContain('InitializeRevision');
    expect(htmlEn).toContain(ADMIN_LIFECYCLE_INITIALIZE_EXPLANATION_EN);
    expect(htmlEn).toContain(ADMIN_LIFECYCLE_INITIALIZE_ACTION_LABEL_EN);
    expect(htmlEn).toContain(ADMIN_LIFECYCLE_INITIALIZE_CONFIRM_CHECKBOX_EN);

    await i18n.changeLanguage('ar');
  });

  it('30. S4/S5 Unconfirmed InitializeRevision submission remains disabled & zero callable invocation before confirmation', () => {
    const legacyTarget: AdminUser = {
      id: 'legacy-mod-606',
      name: 'Omar Moderator',
      email: 'omar.mod@promiseofplanet.org',
      role: AdminRole.CitizenModerator,
      isActive: true,
    };

    const listCallableSpy = vi.fn();
    const invokeCallableSpy = vi.fn();
    const clientDeps: AdminIdentityClientDependencies = {
      isBackendConfigured: () => true,
      getAuthenticatedUid: () => ACTIVE_OWNER.id,
      listAdminUsersCallable: listCallableSpy,
      invokeCallable: invokeCallableSpy,
    };

    const html = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        clientDeps={clientDeps}
        initialDirectoryState={{
          status: 'loaded',
          users: [legacyTarget],
        }}
        initialLifecycleTarget={legacyTarget}
        initialLifecycleOperation="InitializeRevision"
      />
    );

    // Checkbox is not preselected
    const checkboxMatch = html.match(
      /<input[^>]*data-testid="lifecycle-init-confirm-checkbox"[^>]*>/
    );
    expect(checkboxMatch).not.toBeNull();
    expect(checkboxMatch![0]).not.toContain('checked=""');

    const confirmBtnMatch =
      html.match(/<button[^>]*data-testid="lifecycle-confirm-btn"[^>]*>/) ||
      html.match(/<button[^>]*disabled=""[^>]*data-testid="lifecycle-confirm-btn"[^>]*>/);
    expect(confirmBtnMatch).not.toBeNull();
    expect(confirmBtnMatch![0]).toContain('disabled=""');
    expect(confirmBtnMatch![0]).toContain('aria-disabled="true"');

    expect(listCallableSpy).not.toHaveBeenCalled();
    expect(invokeCallableSpy).not.toHaveBeenCalled();
  });

  it('31. S4 No automatic initialization on page load, directory refresh, modal open, or error states', async () => {
    const legacyUsers: ReadonlyArray<AdminUser> = [
      {
        id: 'legacy-auto-check-01',
        name: 'Unversioned Editor',
        email: 'unver@promiseofplanet.org',
        role: AdminRole.ContentEditor,
        isActive: true,
      },
    ];

    const invokeCallableSpy = vi.fn();
    const listCallableSpy = vi.fn(async () => ({
      data: {
        admins: legacyUsers,
      },
    }));

    const clientDeps: AdminIdentityClientDependencies = {
      isBackendConfigured: () => true,
      getAuthenticatedUid: () => ACTIVE_OWNER.id,
      listAdminUsersCallable: listCallableSpy,
      invokeCallable: invokeCallableSpy,
    };

    const controller = new AdminDirectoryLoadController();
    const snap = await controller.loadDirectory(ACTIVE_OWNER, 'users', () =>
      listAdminUsers(clientDeps)
    );

    expect(snap.status).toBe('loaded');
    expect(snap.users[0].revision).toBeUndefined();
    expect(invokeCallableSpy).not.toHaveBeenCalled();

    // Render loaded state, modal open state, and error state: never invokes lifecycle callable
    renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        clientDeps={clientDeps}
        initialDirectoryState={{
          status: 'loaded',
          users: snap.users,
        }}
        initialLifecycleTarget={snap.users[0]}
      />
    );

    renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        clientDeps={clientDeps}
        initialDirectoryState={{
          status: 'unavailable',
        }}
      />
    );

    expect(invokeCallableSpy).not.toHaveBeenCalled();
  });

  it('32. S4 Desktop and mobile parity for Initialize legacy account in Arabic and English and preservation of existing ChangeRole/Deactivate/Reactivate previews', async () => {
    const legacyUser: AdminUser = {
      id: 'legacy-parity-01',
      name: 'Legacy Parity User',
      email: 'parity@promiseofplanet.org',
      role: AdminRole.LibraryCurator,
      isActive: true,
    };
    const inactiveVersionedUser: AdminUser = {
      id: 'inactive-ver-02',
      name: 'Inactive Versioned User',
      email: 'inactive.ver@promiseofplanet.org',
      role: AdminRole.RightsReviewer,
      isActive: false,
      revision: 6,
    };

    await i18n.changeLanguage('ar');
    const htmlAr = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: [legacyUser, inactiveVersionedUser],
        }}
        initialLifecycleTarget={inactiveVersionedUser}
        initialLifecycleOperation="Reactivate"
      />
    );

    expect(htmlAr).toContain('data-testid="admin-lifecycle-init-trigger-legacy-parity-01"');
    expect(htmlAr).toContain('data-testid="admin-lifecycle-init-trigger-card-legacy-parity-01"');
    expect(htmlAr).toContain(ADMIN_LIFECYCLE_INITIALIZE_ACTION_LABEL_AR);
    expect(htmlAr).toContain('إعادة تفعيل حساب [Inactive Versioned User]');

    await i18n.changeLanguage('en');
    const htmlEn = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: [legacyUser, inactiveVersionedUser],
        }}
        initialLifecycleTarget={inactiveVersionedUser}
        initialLifecycleOperation="Reactivate"
      />
    );

    expect(htmlEn).toContain('data-testid="admin-lifecycle-init-trigger-legacy-parity-01"');
    expect(htmlEn).toContain('data-testid="admin-lifecycle-init-trigger-card-legacy-parity-01"');
    expect(htmlEn).toContain(ADMIN_LIFECYCLE_INITIALIZE_ACTION_LABEL_EN);
    expect(htmlEn).toContain('Reactivate account [Inactive Versioned User]');

    await i18n.changeLanguage('ar');
  });

  it('33. S5 Explicit confirmation required & no initialization before confirmation: Submitting without confirmation is rejected and never invokes callable', async () => {
    const legacyTarget: AdminUser = {
      id: 'legacy-curator-701',
      name: 'Nour Curator',
      email: 'nour.curator@promiseofplanet.org',
      role: AdminRole.LibraryCurator,
      isActive: true,
    };

    const directorySnapshot = {
      status: 'loaded' as const,
      users: [legacyTarget],
      requestGeneration: 1,
      boundUserUid: ACTIVE_OWNER.id,
      boundTabId: 'users',
    };

    const invokeInitSpy = vi.fn();
    const refreshSpy = vi.fn();
    const closeSpy = vi.fn();

    const initController = new AdminRevisionInitializationController({
      boundCallerUid: ACTIVE_OWNER.id,
      boundTargetUid: legacyTarget.id,
      boundDirectoryGeneration: 1,
    });

    // Attempt submit before setting confirmation
    const unconfirmedResult = await initController.submitInitializeRevision({
      caller: ACTIVE_OWNER,
      activeTabId: 'users',
      target: legacyTarget,
      operation: 'InitializeRevision',
      directorySnapshot,
      invokeInit: invokeInitSpy,
      refreshDirectory: refreshSpy,
      onModalClose: closeSpy,
    });

    expect(unconfirmedResult.status).toBe('error');
    expect(unconfirmedResult.errorCategory).toBe('unconfirmed');
    expect(unconfirmedResult.isConfirmed).toBe(false);
    expect(invokeInitSpy).not.toHaveBeenCalled();
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();

    // When explicitly confirmed in UI, confirm button becomes enabled for eligible legacy non-Owner
    const confirmedHtml = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: [legacyTarget],
        }}
        initialLifecycleTarget={legacyTarget}
        initialLifecycleOperation="InitializeRevision"
        initialLifecycleConfirmed={true}
      />
    );

    const confirmBtnMatch = confirmedHtml.match(
      /<button[^>]*data-testid="lifecycle-confirm-btn"[^>]*>/
    );
    expect(confirmBtnMatch).not.toBeNull();
    expect(confirmBtnMatch![0]).not.toContain('disabled=""');
    expect(confirmBtnMatch![0]).toContain('aria-disabled="false"');
  });

  it('34. S5 Eligible legacy non-Owner submission sends exact { targetUid } payload, validates response, closes modal, and refreshes directory to versioned state', async () => {
    const legacyTarget: AdminUser = {
      id: 'legacy-editor-702',
      name: 'Rami Legacy Editor',
      email: 'rami.editor@promiseofplanet.org',
      role: AdminRole.ContentEditor,
      isActive: true,
    };

    let serverUsers: ReadonlyArray<AdminUser> = [legacyTarget];

    const invokeCallableSpy = vi.fn(async (functionName: string, payload: unknown) => {
      expect(functionName).toBe('manageAdminLifecycle');
      expect(payload).toEqual({
        operation: 'InitializeRevision',
        targetUid: 'legacy-editor-702',
      });
      // Verify no extra authority claims or expectedRevision are ever sent
      expect(Object.keys(payload as Record<string, unknown>).sort()).toEqual([
        'operation',
        'targetUid',
      ]);

      serverUsers = [
        {
          ...legacyTarget,
          revision: 1,
        },
      ];

      return {
        data: {
          operation: 'InitializeRevision',
          targetUid: 'legacy-editor-702',
          previousRevision: null,
          currentRevision: 1,
          committedAtIso: '2026-03-01T12:00:00.000Z',
          admin: {
            id: 'legacy-editor-702',
            role: AdminRole.ContentEditor,
            isActive: true,
            revision: 1,
          },
          auditReceipt: {
            auditEventId: 'audit-init-702-001',
            action: 'ADMIN_REVISION_INITIALIZED',
            targetType: 'admin_identity',
            targetId: 'legacy-editor-702',
            timestamp: '2026-03-01T12:00:00.000Z',
          },
        },
      };
    });

    const listCallableSpy = vi.fn(async () => ({
      data: {
        admins: serverUsers,
      },
    }));

    const clientDeps: AdminIdentityClientDependencies = {
      isBackendConfigured: () => true,
      getAuthenticatedUid: () => ACTIVE_OWNER.id,
      listAdminUsersCallable: listCallableSpy,
      invokeCallable: invokeCallableSpy,
    };

    const dirController = new AdminDirectoryLoadController();
    const initialDirSnap = await dirController.loadDirectory(
      ACTIVE_OWNER,
      'users',
      () => listAdminUsers(clientDeps)
    );
    expect(initialDirSnap.users[0].revision).toBeUndefined();

    const initController = new AdminRevisionInitializationController();
    initController.resetForTarget(
      ACTIVE_OWNER,
      legacyTarget,
      initialDirSnap.requestGeneration,
      false
    );
    initController.setConfirmed(
      true,
      ACTIVE_OWNER,
      'users',
      legacyTarget,
      initialDirSnap
    );

    let modalClosed = false;
    const finalInitSnap = await initController.submitInitializeRevision({
      caller: ACTIVE_OWNER,
      activeTabId: 'users',
      target: legacyTarget,
      operation: 'InitializeRevision',
      directorySnapshot: initialDirSnap,
      invokeInit: (input) => {
        expect(Object.keys(input)).toEqual(['targetUid']);
        expect(input.targetUid).toBe('legacy-editor-702');
        return initializeAdminRevision(input, clientDeps);
      },
      refreshDirectory: () =>
        dirController.loadDirectory(ACTIVE_OWNER, 'users', () =>
          listAdminUsers(clientDeps)
        ),
      onModalClose: () => {
        modalClosed = true;
      },
    });

    expect(finalInitSnap.status).toBe('succeeded');
    expect(finalInitSnap.isConfirmed).toBe(false);
    expect(modalClosed).toBe(true);
    expect(invokeCallableSpy).toHaveBeenCalledTimes(1);
    expect(listCallableSpy).toHaveBeenCalledTimes(2);

    const refreshedDirSnap = dirController.getSnapshot();
    expect(refreshedDirSnap.status).toBe('loaded');
    expect(refreshedDirSnap.users[0].revision).toBe(1);

    // After directory refresh, the account renders normal versioned lifecycle controls instead of legacy init trigger
    const refreshedHtml = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: refreshedDirSnap.users,
        }}
      />
    );
    expect(refreshedHtml).toContain('data-testid="admin-lifecycle-trigger-legacy-editor-702"');
    expect(refreshedHtml).toContain('v1');
    expect(refreshedHtml).not.toContain(
      'data-testid="admin-lifecycle-init-trigger-legacy-editor-702"'
    );
  });

  it('35. S5 Owner, self, and versioned account rejection: Refuses initialization for any Owner account, current session, or account that already has a revision', async () => {
    const coOwnerLegacy: AdminUser = {
      id: 'co-owner-703',
      name: 'Co-Owner Legacy',
      email: 'coowner@promiseofplanet.org',
      role: AdminRole.Owner,
      isActive: true,
    };
    const versionedTrainer: AdminUser = {
      id: 'versioned-trainer-704',
      name: 'Versioned Trainer',
      email: 'ver.trainer@promiseofplanet.org',
      role: AdminRole.Trainer,
      isActive: true,
      revision: 2,
    };

    const directorySnapshot = {
      status: 'loaded' as const,
      users: [ACTIVE_OWNER, coOwnerLegacy, versionedTrainer],
      requestGeneration: 1,
      boundUserUid: ACTIVE_OWNER.id,
      boundTabId: 'users',
    };

    const invokeInitSpy = vi.fn();
    const refreshSpy = vi.fn();

    for (const ineligibleTarget of [ACTIVE_OWNER, coOwnerLegacy, versionedTrainer]) {
      const check = isTargetEligibleForRevisionInitialization(
        ACTIVE_OWNER,
        'users',
        ineligibleTarget,
        directorySnapshot
      );
      expect(check.eligible).toBe(false);
      expect(check.reason).toBe('target-ineligible');

      const controller = new AdminRevisionInitializationController({
        isConfirmed: true,
        boundCallerUid: ACTIVE_OWNER.id,
        boundTargetUid: ineligibleTarget.id,
        boundDirectoryGeneration: 1,
      });

      const res = await controller.submitInitializeRevision({
        caller: ACTIVE_OWNER,
        activeTabId: 'users',
        target: ineligibleTarget,
        operation: 'InitializeRevision',
        directorySnapshot,
        invokeInit: invokeInitSpy,
        refreshDirectory: refreshSpy,
      });

      expect(res.status).toBe('error');
      expect(res.errorCategory).toBe('target-ineligible');
    }

    expect(invokeInitSpy).not.toHaveBeenCalled();
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it('36. S5 Stale directory state or target change before submit: Revalidates against authoritative directory snapshot and refuses submission when target role, active status, email, or revision changed', async () => {
    const selectedTargetAtModalOpen: AdminUser = {
      id: 'legacy-target-705',
      name: 'Salma Reviewer',
      email: 'salma@promiseofplanet.org',
      role: AdminRole.RightsReviewer,
      isActive: true,
    };

    // Scenario A: Target in directory snapshot was already initialized to revision 1 before submit
    const snapshotNowVersioned = {
      status: 'loaded' as const,
      users: [{ ...selectedTargetAtModalOpen, revision: 1 }],
      requestGeneration: 2,
      boundUserUid: ACTIVE_OWNER.id,
      boundTabId: 'users',
    };

    // Scenario B: Target in directory snapshot changed role or active status before submit
    const snapshotRoleChanged = {
      status: 'loaded' as const,
      users: [{ ...selectedTargetAtModalOpen, role: AdminRole.Viewer }],
      requestGeneration: 2,
      boundUserUid: ACTIVE_OWNER.id,
      boundTabId: 'users',
    };

    // Scenario C: Target disappeared from directory snapshot
    const snapshotMissingTarget = {
      status: 'loaded' as const,
      users: [],
      requestGeneration: 2,
      boundUserUid: ACTIVE_OWNER.id,
      boundTabId: 'users',
    };

    const invokeInitSpy = vi.fn();
    const refreshSpy = vi.fn();

    for (const staleSnap of [
      snapshotNowVersioned,
      snapshotRoleChanged,
      snapshotMissingTarget,
    ]) {
      const controller = new AdminRevisionInitializationController({
        isConfirmed: true,
        boundCallerUid: ACTIVE_OWNER.id,
        boundTargetUid: selectedTargetAtModalOpen.id,
        boundDirectoryGeneration: staleSnap.requestGeneration,
      });

      const res = await controller.submitInitializeRevision({
        caller: ACTIVE_OWNER,
        activeTabId: 'users',
        target: selectedTargetAtModalOpen,
        operation: 'InitializeRevision',
        directorySnapshot: staleSnap,
        invokeInit: invokeInitSpy,
        refreshDirectory: refreshSpy,
      });

      expect(res.status).toBe('error');
      expect(res.requiresRefreshBeforeRetry).toBe(true);
      expect(['target-ineligible', 'stale-directory']).toContain(res.errorCategory);
    }

    expect(invokeInitSpy).not.toHaveBeenCalled();
  });

  it('37. S5 Caller permission loss or account switching: Invalidates confirmation state and prevents submission', async () => {
    const legacyTarget: AdminUser = {
      id: 'legacy-target-706',
      name: 'Tariq Trainer',
      email: 'tariq@promiseofplanet.org',
      role: AdminRole.Trainer,
      isActive: true,
    };

    const secondOwner: AdminUser = {
      id: 'owner-session-999',
      name: 'Second Active Owner',
      email: 'second.owner@promiseofplanet.org',
      role: AdminRole.Owner,
      isActive: true,
    };

    const directorySnapshot = {
      status: 'loaded' as const,
      users: [legacyTarget],
      requestGeneration: 1,
      boundUserUid: ACTIVE_OWNER.id,
      boundTabId: 'users',
    };

    const controller = new AdminRevisionInitializationController();
    controller.resetForTarget(ACTIVE_OWNER, legacyTarget, 1, false);
    controller.setConfirmed(true, ACTIVE_OWNER, 'users', legacyTarget, directorySnapshot);
    expect(controller.getSnapshot().isConfirmed).toBe(true);

    // 1. Account switches to a different Owner -> confirmation is cleared
    const switchedOwnerSnap = controller.syncContext(
      secondOwner,
      'users',
      legacyTarget,
      { ...directorySnapshot, boundUserUid: secondOwner.id }
    );
    expect(switchedOwnerSnap.isConfirmed).toBe(false);
    expect(switchedOwnerSnap.boundCallerUid).toBe(secondOwner.id);

    // 2. Caller loses Owner/ManageUsers authority -> invalidated with unauthorized error
    const unauthorizedSnap = controller.syncContext(
      NON_OWNER_USERS[0],
      'users',
      legacyTarget,
      directorySnapshot
    );
    expect(unauthorizedSnap.status).toBe('error');
    expect(unauthorizedSnap.errorCategory).toBe('unauthorized');
    expect(unauthorizedSnap.isConfirmed).toBe(false);

    const invokeInitSpy = vi.fn();
    const rejectedSubmit = await controller.submitInitializeRevision({
      caller: NON_OWNER_USERS[0],
      activeTabId: 'users',
      target: legacyTarget,
      operation: 'InitializeRevision',
      directorySnapshot,
      invokeInit: invokeInitSpy,
      refreshDirectory: vi.fn(),
    });
    expect(rejectedSubmit.status).toBe('error');
    expect(rejectedSubmit.errorCategory).toBe('unauthorized');
    expect(invokeInitSpy).not.toHaveBeenCalled();
  });

  it('38. S5 Double-click / in-flight duplicate submission protection and compact progress indicator', async () => {
    const legacyTarget: AdminUser = {
      id: 'legacy-target-707',
      name: 'Layla Moderator',
      email: 'layla@promiseofplanet.org',
      role: AdminRole.CitizenModerator,
      isActive: true,
    };

    const directorySnapshot = {
      status: 'loaded' as const,
      users: [legacyTarget],
      requestGeneration: 1,
      boundUserUid: ACTIVE_OWNER.id,
      boundTabId: 'users',
    };

    let resolvePendingCall!: (value: AdminLifecycleClientResponse) => void;
    const invokeInitSpy = vi.fn(
      () =>
        new Promise<AdminLifecycleClientResponse>((resolve) => {
          resolvePendingCall = resolve;
        })
    );

    const controller = new AdminRevisionInitializationController();
    controller.resetForTarget(ACTIVE_OWNER, legacyTarget, 1, false);
    controller.setConfirmed(true, ACTIVE_OWNER, 'users', legacyTarget, directorySnapshot);

    const firstSubmissionPromise = controller.submitInitializeRevision({
      caller: ACTIVE_OWNER,
      activeTabId: 'users',
      target: legacyTarget,
      operation: 'InitializeRevision',
      directorySnapshot,
      invokeInit: invokeInitSpy,
      refreshDirectory: vi.fn(async () => {}),
    });

    expect(controller.getSnapshot().status).toBe('submitting');

    // Second rapid click while in-flight is ignored
    const secondSubmissionPromise = controller.submitInitializeRevision({
      caller: ACTIVE_OWNER,
      activeTabId: 'users',
      target: legacyTarget,
      operation: 'InitializeRevision',
      directorySnapshot,
      invokeInit: invokeInitSpy,
      refreshDirectory: vi.fn(async () => {}),
    });

    expect(invokeInitSpy).toHaveBeenCalledTimes(1);

    // UI while submitting renders compact progress indicator and disables confirm/cancel buttons
    const submittingHtml = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: [legacyTarget],
        }}
        initialLifecycleTarget={legacyTarget}
        initialLifecycleOperation="InitializeRevision"
        initialLifecycleSubmissionState={{
          status: 'submitting',
          isConfirmed: true,
          boundCallerUid: ACTIVE_OWNER.id,
          boundTargetUid: legacyTarget.id,
          boundDirectoryGeneration: 1,
        }}
      />
    );
    expect(submittingHtml).toContain('data-testid="lifecycle-submitting-indicator"');
    const confirmBtnMatch = submittingHtml.match(
      /<button[^>]*data-testid="lifecycle-confirm-btn"[^>]*>/
    );
    expect(confirmBtnMatch).not.toBeNull();
    expect(confirmBtnMatch![0]).toContain('disabled=""');

    resolvePendingCall({
      operation: 'InitializeRevision',
      targetUid: legacyTarget.id,
      previousRevision: null,
      currentRevision: 1,
      committedAtIso: '2026-03-01T12:00:01.000Z',
      admin: {
        id: legacyTarget.id,
        role: legacyTarget.role,
        isActive: legacyTarget.isActive,
        revision: 1,
      },
      auditReceipt: {
        auditEventId: 'audit-init-707-001',
        action: 'ADMIN_REVISION_INITIALIZED',
        targetType: 'admin_identity',
        targetId: legacyTarget.id,
        timestamp: '2026-03-01T12:00:01.000Z',
      },
    });

    await firstSubmissionPromise;
    await secondSubmissionPromise;
    expect(invokeInitSpy).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().status).toBe('succeeded');
  });

  it('39. S5 Conflict rejection without automatic retry: Displays bilingual conflict notice and requires explicit directory refresh before retrying', async () => {
    const legacyTarget: AdminUser = {
      id: 'legacy-target-708',
      name: 'Ziad Assistant',
      email: 'ziad@promiseofplanet.org',
      role: AdminRole.AIAssistant,
      isActive: true,
    };

    const directorySnapshot = {
      status: 'loaded' as const,
      users: [legacyTarget],
      requestGeneration: 1,
      boundUserUid: ACTIVE_OWNER.id,
      boundTabId: 'users',
    };

    const invokeInitSpy = vi.fn(async () => {
      throw new AdminIdentityClientError(
        'failed-precondition',
        'REVISION_ALREADY_INITIALIZED'
      );
    });
    const refreshSpy = vi.fn();

    const controller = new AdminRevisionInitializationController();
    controller.resetForTarget(ACTIVE_OWNER, legacyTarget, 1, false);
    controller.setConfirmed(true, ACTIVE_OWNER, 'users', legacyTarget, directorySnapshot);

    const conflictSnap = await controller.submitInitializeRevision({
      caller: ACTIVE_OWNER,
      activeTabId: 'users',
      target: legacyTarget,
      operation: 'InitializeRevision',
      directorySnapshot,
      invokeInit: invokeInitSpy,
      refreshDirectory: refreshSpy,
    });

    // No automatic retry or automatic directory refresh on conflict
    expect(invokeInitSpy).toHaveBeenCalledTimes(1);
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(conflictSnap.status).toBe('error');
    expect(conflictSnap.errorCategory).toBe('conflict');
    expect(conflictSnap.requiresRefreshBeforeRetry).toBe(true);
    expect(conflictSnap.isConfirmed).toBe(false);

    // Attempting to re-confirm or resubmit before refreshing is blocked
    controller.setConfirmed(true, ACTIVE_OWNER, 'users', legacyTarget, directorySnapshot);
    expect(controller.getSnapshot().isConfirmed).toBe(false);

    await controller.submitInitializeRevision({
      caller: ACTIVE_OWNER,
      activeTabId: 'users',
      target: legacyTarget,
      operation: 'InitializeRevision',
      directorySnapshot,
      invokeInit: invokeInitSpy,
      refreshDirectory: refreshSpy,
    });
    expect(invokeInitSpy).toHaveBeenCalledTimes(1);

    // UI renders conflict error message and explicit refresh button in Arabic & English
    await i18n.changeLanguage('ar');
    const errorHtmlAr = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: [legacyTarget],
        }}
        initialLifecycleTarget={legacyTarget}
        initialLifecycleOperation="InitializeRevision"
        initialLifecycleSubmissionState={conflictSnap}
      />
    );
    expect(errorHtmlAr).toContain('data-testid="lifecycle-submission-error"');
    expect(errorHtmlAr).toContain(INIT_REVISION_ERROR_MESSAGES.conflict.ar);
    expect(errorHtmlAr).toContain('data-testid="lifecycle-refresh-directory-btn"');

    await i18n.changeLanguage('en');
    const errorHtmlEn = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: [legacyTarget],
        }}
        initialLifecycleTarget={legacyTarget}
        initialLifecycleOperation="InitializeRevision"
        initialLifecycleSubmissionState={conflictSnap}
      />
    );
    expect(errorHtmlEn).toContain('data-testid="lifecycle-submission-error"');
    expect(errorHtmlEn).toContain(INIT_REVISION_ERROR_MESSAGES.conflict.en);
    expect(errorHtmlEn).toContain('data-testid="lifecycle-refresh-directory-btn"');

    await i18n.changeLanguage('ar');
  });

  it('40. S5 Network error and malformed response handling: Fails closed without mutating local state', async () => {
    const legacyTarget: AdminUser = {
      id: 'legacy-target-709',
      name: 'Mona Viewer',
      email: 'mona@promiseofplanet.org',
      role: AdminRole.Viewer,
      isActive: false,
    };

    const directorySnapshot = {
      status: 'loaded' as const,
      users: [legacyTarget],
      requestGeneration: 1,
      boundUserUid: ACTIVE_OWNER.id,
      boundTabId: 'users',
    };

    // 1. Network / callable unavailability
    const netController = new AdminRevisionInitializationController();
    netController.resetForTarget(ACTIVE_OWNER, legacyTarget, 1, false);
    netController.setConfirmed(true, ACTIVE_OWNER, 'users', legacyTarget, directorySnapshot);

    const netSnap = await netController.submitInitializeRevision({
      caller: ACTIVE_OWNER,
      activeTabId: 'users',
      target: legacyTarget,
      operation: 'InitializeRevision',
      directorySnapshot,
      invokeInit: async () => {
        throw new AdminIdentityClientError('unavailable', 'Callable offline');
      },
      refreshDirectory: vi.fn(),
    });
    expect(netSnap.status).toBe('error');
    expect(netSnap.errorCategory).toBe('unavailable');
    expect(netSnap.errorMessageAr).toBe(INIT_REVISION_ERROR_MESSAGES.unavailable.ar);
    expect(netSnap.errorMessageEn).toBe(INIT_REVISION_ERROR_MESSAGES.unavailable.en);

    // 2. Malformed response (e.g., mismatched targetUid, wrong operation, or unexpected role mutation in response)
    const malformedController = new AdminRevisionInitializationController();
    malformedController.resetForTarget(ACTIVE_OWNER, legacyTarget, 1, false);
    malformedController.setConfirmed(
      true,
      ACTIVE_OWNER,
      'users',
      legacyTarget,
      directorySnapshot
    );

    const malformedSnap = await malformedController.submitInitializeRevision({
      caller: ACTIVE_OWNER,
      activeTabId: 'users',
      target: legacyTarget,
      operation: 'InitializeRevision',
      directorySnapshot,
      invokeInit: async () =>
        ({
          operation: 'InitializeRevision',
          targetUid: 'wrong-uid-999',
          previousRevision: null,
          currentRevision: 1,
          changed: true,
          admin: {
            ...legacyTarget,
            id: 'wrong-uid-999',
            revision: 1,
          },
          auditReceipt: {
            auditEventId: 'audit-wrong',
            action: 'ADMIN_REVISION_INITIALIZED',
            actorUid: ACTIVE_OWNER.id,
            targetId: 'wrong-uid-999',
            executedAtMillis: 1710000002000,
          },
        }) as AdminLifecycleClientResponse,
      refreshDirectory: vi.fn(),
    });

    expect(malformedSnap.status).toBe('error');
    expect(malformedSnap.errorCategory).toBe('malformed-response');
    expect(malformedSnap.errorMessageAr).toBe(
      INIT_REVISION_ERROR_MESSAGES['malformed-response'].ar
    );
    expect(malformedSnap.errorMessageEn).toBe(
      INIT_REVISION_ERROR_MESSAGES['malformed-response'].en
    );
    // Original local directory record remains untouched (no revision added locally)
    expect(directorySnapshot.users[0].revision).toBeUndefined();
  });

  it('41. FINAL Unified Confirmation Gating: ChangeRole, Deactivate, Reactivate, and InitializeRevision remain disabled until explicitly confirmed and become enabled when eligible and confirmed', () => {
    const activeVersionedUser: AdminUser = {
      id: 'ver-active-710',
      name: 'Active Versioned Editor',
      email: 'ver.active@promiseofplanet.org',
      role: AdminRole.ContentEditor,
      isActive: true,
      revision: 3,
    };
    const inactiveVersionedUser: AdminUser = {
      id: 'ver-inactive-711',
      name: 'Inactive Versioned Reviewer',
      email: 'ver.inactive@promiseofplanet.org',
      role: AdminRole.RightsReviewer,
      isActive: false,
      revision: 4,
    };
    const legacyUser: AdminUser = {
      id: 'legacy-unver-712',
      name: 'Legacy Unversioned User',
      email: 'legacy.unver@promiseofplanet.org',
      role: AdminRole.Viewer,
      isActive: true,
    };

    const operationsToVerify = [
      {
        target: activeVersionedUser,
        op: 'ChangeRole' as const,
        targetRole: AdminRole.RightsReviewer,
      },
      {
        target: activeVersionedUser,
        op: 'Deactivate' as const,
        targetRole: AdminRole.RightsReviewer,
      },
      {
        target: inactiveVersionedUser,
        op: 'Reactivate' as const,
        targetRole: AdminRole.ContentEditor,
      },
      {
        target: legacyUser,
        op: 'InitializeRevision' as const,
        targetRole: AdminRole.ContentEditor,
      },
    ];

    for (const { target, op, targetRole } of operationsToVerify) {
      // 1. Unconfirmed by default -> confirm button disabled
      const unconfirmedHtml = renderToStaticMarkup(
        <AdminUsersManagement
          currentUser={ACTIVE_OWNER}
          activeTabId="users"
          initialDirectoryState={{
            status: 'loaded',
            users: [activeVersionedUser, inactiveVersionedUser, legacyUser],
          }}
          initialLifecycleTarget={target}
          initialLifecycleOperation={op}
          initialLifecycleTargetRole={targetRole}
          initialLifecycleConfirmed={false}
        />
      );

      expect(unconfirmedHtml).toContain('data-testid="lifecycle-init-confirm-checkbox"');
      const disabledBtnMatch =
        unconfirmedHtml.match(/<button[^>]*data-testid="lifecycle-confirm-btn"[^>]*>/) ||
        unconfirmedHtml.match(
          /<button[^>]*disabled=""[^>]*data-testid="lifecycle-confirm-btn"[^>]*>/
        );
      expect(disabledBtnMatch).not.toBeNull();
      expect(disabledBtnMatch![0]).toContain('disabled=""');
      expect(disabledBtnMatch![0]).toContain('aria-disabled="true"');

      // 2. Explicitly confirmed -> confirm button enabled
      const confirmedHtml = renderToStaticMarkup(
        <AdminUsersManagement
          currentUser={ACTIVE_OWNER}
          activeTabId="users"
          initialDirectoryState={{
            status: 'loaded',
            users: [activeVersionedUser, inactiveVersionedUser, legacyUser],
          }}
          initialLifecycleTarget={target}
          initialLifecycleOperation={op}
          initialLifecycleTargetRole={targetRole}
          initialLifecycleConfirmed={true}
        />
      );

      const enabledBtnMatch = confirmedHtml.match(
        /<button[^>]*data-testid="lifecycle-confirm-btn"[^>]*>/
      );
      expect(enabledBtnMatch).not.toBeNull();
      expect(enabledBtnMatch![0]).not.toContain('disabled=""');
      expect(enabledBtnMatch![0]).toContain('aria-disabled="false"');
    }
  });

  it('42. FINAL ChangeRole execution: Dispatches exact { targetUid, expectedRevision, targetRole } via changeAdminRole, validates response & auditReceipt, closes modal, and refreshes directory', async () => {
    const targetAdmin: AdminUser = {
      id: 'ver-editor-801',
      name: 'Yara Content Editor',
      email: 'yara.editor@promiseofplanet.org',
      role: AdminRole.ContentEditor,
      isActive: true,
      revision: 3,
    };

    let serverUsers: ReadonlyArray<AdminUser> = [targetAdmin];

    const invokeCallableSpy = vi.fn(async (functionName: string, payload: unknown) => {
      expect(functionName).toBe('manageAdminLifecycle');
      expect(payload).toEqual({
        operation: 'ChangeRole',
        targetUid: 'ver-editor-801',
        expectedRevision: 3,
        targetRole: AdminRole.LibraryCurator,
      });
      expect(Object.keys(payload as Record<string, unknown>).sort()).toEqual([
        'expectedRevision',
        'operation',
        'targetRole',
        'targetUid',
      ]);

      serverUsers = [
        {
          ...targetAdmin,
          role: AdminRole.LibraryCurator,
          revision: 4,
        },
      ];

      return {
        data: {
          operation: 'ChangeRole',
          targetUid: 'ver-editor-801',
          previousRevision: 3,
          currentRevision: 4,
          committedAtIso: '2026-03-01T14:00:00.000Z',
          admin: {
            id: 'ver-editor-801',
            role: AdminRole.LibraryCurator,
            isActive: true,
            revision: 4,
          },
          auditReceipt: {
            auditEventId: 'audit-changerole-801-004',
            action: 'ADMIN_ROLE_CHANGED',
            targetType: 'admin_identity',
            targetId: 'ver-editor-801',
            timestamp: '2026-03-01T14:00:00.000Z',
          },
        },
      };
    });

    const listCallableSpy = vi.fn(async () => ({
      data: {
        admins: serverUsers,
      },
    }));

    const clientDeps: AdminIdentityClientDependencies = {
      isBackendConfigured: () => true,
      getAuthenticatedUid: () => ACTIVE_OWNER.id,
      listAdminUsersCallable: listCallableSpy,
      invokeCallable: invokeCallableSpy,
    };

    const dirController = new AdminDirectoryLoadController();
    const initialDirSnap = await dirController.loadDirectory(
      ACTIVE_OWNER,
      'users',
      () => listAdminUsers(clientDeps)
    );
    expect(initialDirSnap.users[0].role).toBe(AdminRole.ContentEditor);
    expect(initialDirSnap.users[0].revision).toBe(3);

    const lifecycleController = new AdminRevisionInitializationController();
    lifecycleController.resetForTarget(
      ACTIVE_OWNER,
      targetAdmin,
      initialDirSnap.requestGeneration,
      false,
      'ChangeRole',
      AdminRole.LibraryCurator
    );
    lifecycleController.setConfirmed(
      true,
      ACTIVE_OWNER,
      'users',
      targetAdmin,
      initialDirSnap,
      'ChangeRole',
      AdminRole.LibraryCurator
    );

    let modalClosed = false;
    const finalSnap = await lifecycleController.submitLifecycleOperation({
      caller: ACTIVE_OWNER,
      activeTabId: 'users',
      target: targetAdmin,
      operation: 'ChangeRole',
      proposedRole: AdminRole.LibraryCurator,
      directorySnapshot: initialDirSnap,
      invokeChangeRole: (input) => {
        expect(Object.keys(input).sort()).toEqual([
          'expectedRevision',
          'targetRole',
          'targetUid',
        ]);
        expect(input).toEqual({
          targetUid: 'ver-editor-801',
          expectedRevision: 3,
          targetRole: AdminRole.LibraryCurator,
        });
        return changeAdminRole(input, clientDeps);
      },
      refreshDirectory: () =>
        dirController.loadDirectory(ACTIVE_OWNER, 'users', () =>
          listAdminUsers(clientDeps)
        ),
      onModalClose: () => {
        modalClosed = true;
      },
    });

    expect(finalSnap.status).toBe('succeeded');
    expect(finalSnap.isConfirmed).toBe(false);
    expect(finalSnap.lastCompletedOperation).toBe('ChangeRole');
    expect(finalSnap.lastCompletedTargetUid).toBe('ver-editor-801');
    expect(finalSnap.lastAuditEventId).toBe('audit-changerole-801-004');
    expect(modalClosed).toBe(true);
    expect(invokeCallableSpy).toHaveBeenCalledTimes(1);
    expect(listCallableSpy).toHaveBeenCalledTimes(2);

    const refreshedDirSnap = dirController.getSnapshot();
    expect(refreshedDirSnap.users[0].role).toBe(AdminRole.LibraryCurator);
    expect(refreshedDirSnap.users[0].revision).toBe(4);
  });

  it('43. FINAL Deactivate execution: Dispatches exact { targetUid, expectedRevision } via deactivateAdmin, validates response & auditReceipt, closes modal, and refreshes directory', async () => {
    const activeTarget: AdminUser = {
      id: 'ver-trainer-802',
      name: 'Mazen Trainer',
      email: 'mazen.trainer@promiseofplanet.org',
      role: AdminRole.Trainer,
      isActive: true,
      revision: 5,
    };

    let serverUsers: ReadonlyArray<AdminUser> = [activeTarget];

    const invokeCallableSpy = vi.fn(async (functionName: string, payload: unknown) => {
      expect(functionName).toBe('manageAdminLifecycle');
      expect(payload).toEqual({
        operation: 'Deactivate',
        targetUid: 'ver-trainer-802',
        expectedRevision: 5,
      });
      expect(Object.keys(payload as Record<string, unknown>).sort()).toEqual([
        'expectedRevision',
        'operation',
        'targetUid',
      ]);

      serverUsers = [
        {
          ...activeTarget,
          isActive: false,
          revision: 6,
        },
      ];

      return {
        data: {
          operation: 'Deactivate',
          targetUid: 'ver-trainer-802',
          previousRevision: 5,
          currentRevision: 6,
          committedAtIso: '2026-03-01T15:00:00.000Z',
          admin: {
            id: 'ver-trainer-802',
            role: AdminRole.Trainer,
            isActive: false,
            revision: 6,
          },
          auditReceipt: {
            auditEventId: 'audit-deactivate-802-006',
            action: 'ADMIN_DEACTIVATED',
            targetType: 'admin_identity',
            targetId: 'ver-trainer-802',
            timestamp: '2026-03-01T15:00:00.000Z',
          },
        },
      };
    });

    const listCallableSpy = vi.fn(async () => ({
      data: {
        admins: serverUsers,
      },
    }));

    const clientDeps: AdminIdentityClientDependencies = {
      isBackendConfigured: () => true,
      getAuthenticatedUid: () => ACTIVE_OWNER.id,
      listAdminUsersCallable: listCallableSpy,
      invokeCallable: invokeCallableSpy,
    };

    const dirController = new AdminDirectoryLoadController();
    const initialDirSnap = await dirController.loadDirectory(
      ACTIVE_OWNER,
      'users',
      () => listAdminUsers(clientDeps)
    );
    expect(initialDirSnap.users[0].isActive).toBe(true);

    const lifecycleController = new AdminRevisionInitializationController();
    lifecycleController.resetForTarget(
      ACTIVE_OWNER,
      activeTarget,
      initialDirSnap.requestGeneration,
      false,
      'Deactivate'
    );
    lifecycleController.setConfirmed(
      true,
      ACTIVE_OWNER,
      'users',
      activeTarget,
      initialDirSnap,
      'Deactivate'
    );

    let modalClosed = false;
    const finalSnap = await lifecycleController.submitLifecycleOperation({
      caller: ACTIVE_OWNER,
      activeTabId: 'users',
      target: activeTarget,
      operation: 'Deactivate',
      directorySnapshot: initialDirSnap,
      invokeDeactivate: (input) => {
        expect(Object.keys(input).sort()).toEqual([
          'expectedRevision',
          'targetUid',
        ]);
        expect(input).toEqual({
          targetUid: 'ver-trainer-802',
          expectedRevision: 5,
        });
        return deactivateAdmin(input, clientDeps);
      },
      refreshDirectory: () =>
        dirController.loadDirectory(ACTIVE_OWNER, 'users', () =>
          listAdminUsers(clientDeps)
        ),
      onModalClose: () => {
        modalClosed = true;
      },
    });

    expect(finalSnap.status).toBe('succeeded');
    expect(finalSnap.lastCompletedOperation).toBe('Deactivate');
    expect(finalSnap.lastAuditEventId).toBe('audit-deactivate-802-006');
    expect(modalClosed).toBe(true);
    expect(invokeCallableSpy).toHaveBeenCalledTimes(1);

    const refreshedDirSnap = dirController.getSnapshot();
    expect(refreshedDirSnap.users[0].isActive).toBe(false);
    expect(refreshedDirSnap.users[0].revision).toBe(6);
  });

  it('44. FINAL Reactivate execution: Dispatches exact { targetUid, expectedRevision } via reactivateAdmin, validates response & auditReceipt, closes modal, and refreshes directory', async () => {
    const inactiveTarget: AdminUser = {
      id: 'ver-reviewer-803',
      name: 'Dina Reviewer',
      email: 'dina.reviewer@promiseofplanet.org',
      role: AdminRole.RightsReviewer,
      isActive: false,
      revision: 9,
    };

    let serverUsers: ReadonlyArray<AdminUser> = [inactiveTarget];

    const invokeCallableSpy = vi.fn(async (functionName: string, payload: unknown) => {
      expect(functionName).toBe('manageAdminLifecycle');
      expect(payload).toEqual({
        operation: 'Reactivate',
        targetUid: 'ver-reviewer-803',
        expectedRevision: 9,
      });
      expect(Object.keys(payload as Record<string, unknown>).sort()).toEqual([
        'expectedRevision',
        'operation',
        'targetUid',
      ]);

      serverUsers = [
        {
          ...inactiveTarget,
          isActive: true,
          revision: 10,
        },
      ];

      return {
        data: {
          operation: 'Reactivate',
          targetUid: 'ver-reviewer-803',
          previousRevision: 9,
          currentRevision: 10,
          committedAtIso: '2026-03-01T16:00:00.000Z',
          admin: {
            id: 'ver-reviewer-803',
            role: AdminRole.RightsReviewer,
            isActive: true,
            revision: 10,
          },
          auditReceipt: {
            auditEventId: 'audit-reactivate-803-010',
            action: 'ADMIN_REACTIVATED',
            targetType: 'admin_identity',
            targetId: 'ver-reviewer-803',
            timestamp: '2026-03-01T16:00:00.000Z',
          },
        },
      };
    });

    const listCallableSpy = vi.fn(async () => ({
      data: {
        admins: serverUsers,
      },
    }));

    const clientDeps: AdminIdentityClientDependencies = {
      isBackendConfigured: () => true,
      getAuthenticatedUid: () => ACTIVE_OWNER.id,
      listAdminUsersCallable: listCallableSpy,
      invokeCallable: invokeCallableSpy,
    };

    const dirController = new AdminDirectoryLoadController();
    const initialDirSnap = await dirController.loadDirectory(
      ACTIVE_OWNER,
      'users',
      () => listAdminUsers(clientDeps)
    );
    expect(initialDirSnap.users[0].isActive).toBe(false);

    const lifecycleController = new AdminRevisionInitializationController();
    lifecycleController.resetForTarget(
      ACTIVE_OWNER,
      inactiveTarget,
      initialDirSnap.requestGeneration,
      false,
      'Reactivate'
    );
    lifecycleController.setConfirmed(
      true,
      ACTIVE_OWNER,
      'users',
      inactiveTarget,
      initialDirSnap,
      'Reactivate'
    );

    let modalClosed = false;
    const finalSnap = await lifecycleController.submitLifecycleOperation({
      caller: ACTIVE_OWNER,
      activeTabId: 'users',
      target: inactiveTarget,
      operation: 'Reactivate',
      directorySnapshot: initialDirSnap,
      invokeReactivate: (input) => {
        expect(Object.keys(input).sort()).toEqual([
          'expectedRevision',
          'targetUid',
        ]);
        expect(input).toEqual({
          targetUid: 'ver-reviewer-803',
          expectedRevision: 9,
        });
        return reactivateAdmin(input, clientDeps);
      },
      refreshDirectory: () =>
        dirController.loadDirectory(ACTIVE_OWNER, 'users', () =>
          listAdminUsers(clientDeps)
        ),
      onModalClose: () => {
        modalClosed = true;
      },
    });

    expect(finalSnap.status).toBe('succeeded');
    expect(finalSnap.lastCompletedOperation).toBe('Reactivate');
    expect(finalSnap.lastAuditEventId).toBe('audit-reactivate-803-010');
    expect(modalClosed).toBe(true);
    expect(invokeCallableSpy).toHaveBeenCalledTimes(1);

    const refreshedDirSnap = dirController.getSnapshot();
    expect(refreshedDirSnap.users[0].isActive).toBe(true);
    expect(refreshedDirSnap.users[0].revision).toBe(10);
  });

  it('45. FINAL Owner promotion rejection, no-op operation rejection, and missing/invalid revision rejection across ChangeRole, Deactivate, and Reactivate', async () => {
    const activeEditor: AdminUser = {
      id: 'ver-editor-804',
      name: 'Sami Editor',
      email: 'sami@promiseofplanet.org',
      role: AdminRole.ContentEditor,
      isActive: true,
      revision: 2,
    };
    const inactiveEditor: AdminUser = {
      id: 'ver-inactive-805',
      name: 'Hana Inactive',
      email: 'hana@promiseofplanet.org',
      role: AdminRole.ContentEditor,
      isActive: false,
      revision: 3,
    };
    const unversionedEditor: AdminUser = {
      id: 'unver-editor-806',
      name: 'Unversioned Editor',
      email: 'unver806@promiseofplanet.org',
      role: AdminRole.ContentEditor,
      isActive: true,
    };

    const directorySnapshot = {
      status: 'loaded' as const,
      users: [activeEditor, inactiveEditor, unversionedEditor],
      requestGeneration: 1,
      boundUserUid: ACTIVE_OWNER.id,
      boundTabId: 'users',
    };

    const invokeChangeRoleSpy = vi.fn();
    const invokeDeactivateSpy = vi.fn();
    const invokeReactivateSpy = vi.fn();

    // 1. Owner promotion is forbidden
    const ownerPromoCheck = validateLifecycleOperationEligibility(
      ACTIVE_OWNER,
      'users',
      activeEditor,
      directorySnapshot,
      'ChangeRole',
      AdminRole.Owner
    );
    expect(ownerPromoCheck.eligible).toBe(false);
    expect(ownerPromoCheck.reason).toBe('owner-promotion');

    const promoController = new AdminRevisionInitializationController({
      isConfirmed: true,
      boundCallerUid: ACTIVE_OWNER.id,
      boundTargetUid: activeEditor.id,
      boundDirectoryGeneration: 1,
    });
    const promoRes = await promoController.submitLifecycleOperation({
      caller: ACTIVE_OWNER,
      activeTabId: 'users',
      target: activeEditor,
      operation: 'ChangeRole',
      proposedRole: AdminRole.Owner,
      directorySnapshot,
      invokeChangeRole: invokeChangeRoleSpy,
      refreshDirectory: vi.fn(),
    });
    expect(promoRes.status).toBe('error');
    expect(promoRes.errorCategory).toBe('owner-promotion');

    // 2. No-op ChangeRole (same role) is rejected
    const sameRoleCheck = validateLifecycleOperationEligibility(
      ACTIVE_OWNER,
      'users',
      activeEditor,
      directorySnapshot,
      'ChangeRole',
      AdminRole.ContentEditor
    );
    expect(sameRoleCheck.eligible).toBe(false);
    expect(sameRoleCheck.reason).toBe('noop-operation');

    // 3. No-op Deactivate on already inactive account is rejected
    const noopDeactivateCheck = validateLifecycleOperationEligibility(
      ACTIVE_OWNER,
      'users',
      inactiveEditor,
      directorySnapshot,
      'Deactivate'
    );
    expect(noopDeactivateCheck.eligible).toBe(false);
    expect(noopDeactivateCheck.reason).toBe('noop-operation');

    // 4. No-op Reactivate on already active account is rejected
    const noopReactivateCheck = validateLifecycleOperationEligibility(
      ACTIVE_OWNER,
      'users',
      activeEditor,
      directorySnapshot,
      'Reactivate'
    );
    expect(noopReactivateCheck.eligible).toBe(false);
    expect(noopReactivateCheck.reason).toBe('noop-operation');

    // 5. Missing revision on ChangeRole / Deactivate / Reactivate is rejected
    for (const op of ['ChangeRole', 'Deactivate', 'Reactivate'] as const) {
      const missingRevCheck = validateLifecycleOperationEligibility(
        ACTIVE_OWNER,
        'users',
        unversionedEditor,
        directorySnapshot,
        op,
        AdminRole.Trainer
      );
      expect(missingRevCheck.eligible).toBe(false);
      expect(missingRevCheck.reason).toBe('target-ineligible');
    }

    expect(invokeChangeRoleSpy).not.toHaveBeenCalled();
    expect(invokeDeactivateSpy).not.toHaveBeenCalled();
    expect(invokeReactivateSpy).not.toHaveBeenCalled();
  });

  it('46. FINAL Operation switching, target switching, and stale revision protection: Changing operation or proposed role resets confirmation and blocks stale submissions', async () => {
    const versionedTarget: AdminUser = {
      id: 'ver-target-807',
      name: 'Adel Moderator',
      email: 'adel@promiseofplanet.org',
      role: AdminRole.CitizenModerator,
      isActive: true,
      revision: 4,
    };

    const directorySnapshot = {
      status: 'loaded' as const,
      users: [versionedTarget],
      requestGeneration: 1,
      boundUserUid: ACTIVE_OWNER.id,
      boundTabId: 'users',
    };

    const controller = new AdminRevisionInitializationController();
    controller.resetForTarget(
      ACTIVE_OWNER,
      versionedTarget,
      1,
      false,
      'ChangeRole',
      AdminRole.Trainer
    );
    controller.setConfirmed(
      true,
      ACTIVE_OWNER,
      'users',
      versionedTarget,
      directorySnapshot,
      'ChangeRole',
      AdminRole.Trainer
    );
    expect(controller.getSnapshot().isConfirmed).toBe(true);

    // Switching proposed role or operation clears confirmation
    controller.resetConfirmationForOperationChange('Deactivate');
    expect(controller.getSnapshot().isConfirmed).toBe(false);
    expect(controller.getSnapshot().boundOperation).toBe('Deactivate');

    // Attempting to submit Deactivate when confirmation was bound to ChangeRole or cleared is rejected
    const invokeDeactivateSpy = vi.fn();
    const unconfirmedDeactivate = await controller.submitLifecycleOperation({
      caller: ACTIVE_OWNER,
      activeTabId: 'users',
      target: versionedTarget,
      operation: 'Deactivate',
      directorySnapshot,
      invokeDeactivate: invokeDeactivateSpy,
      refreshDirectory: vi.fn(),
    });
    expect(unconfirmedDeactivate.status).toBe('error');
    expect(unconfirmedDeactivate.errorCategory).toBe('unconfirmed');
    expect(invokeDeactivateSpy).not.toHaveBeenCalled();

    // If directory revision changes on server before submit (stale expectedRevision), submission is blocked
    controller.setConfirmed(
      true,
      ACTIVE_OWNER,
      'users',
      versionedTarget,
      directorySnapshot,
      'Deactivate'
    );
    const newerDirectorySnapshot = {
      ...directorySnapshot,
      users: [{ ...versionedTarget, revision: 5 }],
    };
    const staleRevisionRes = await controller.submitLifecycleOperation({
      caller: ACTIVE_OWNER,
      activeTabId: 'users',
      target: versionedTarget,
      operation: 'Deactivate',
      directorySnapshot: newerDirectorySnapshot,
      invokeDeactivate: invokeDeactivateSpy,
      refreshDirectory: vi.fn(),
    });
    expect(staleRevisionRes.status).toBe('error');
    expect(staleRevisionRes.errorCategory).toBe('stale-directory');
    expect(staleRevisionRes.requiresRefreshBeforeRetry).toBe(true);
    expect(invokeDeactivateSpy).not.toHaveBeenCalled();
  });

  it('47. FINAL No optimistic updates & response/auditReceipt validation across ChangeRole, Deactivate, and Reactivate', async () => {
    const versionedTarget: AdminUser = {
      id: 'ver-target-808',
      name: 'Kareem Curator',
      email: 'kareem@promiseofplanet.org',
      role: AdminRole.LibraryCurator,
      isActive: true,
      revision: 7,
    };

    const directorySnapshot = {
      status: 'loaded' as const,
      users: [versionedTarget],
      requestGeneration: 1,
      boundUserUid: ACTIVE_OWNER.id,
      boundTabId: 'users',
    };

    // 1. Rejects response where currentRevision does not increment previousRevision + 1
    expect(() =>
      validateLifecycleSuccessResponse(
        {
          operation: 'ChangeRole',
          targetUid: versionedTarget.id,
          previousRevision: 7,
          currentRevision: 7, // invalid non-incremented revision
          committedAtIso: '2026-03-01T17:00:00.000Z',
          admin: {
            id: versionedTarget.id,
            role: AdminRole.Trainer,
            isActive: true,
            revision: 7,
          },
          auditReceipt: {
            auditEventId: 'audit-808-bad',
            action: 'ADMIN_ROLE_CHANGED',
            targetType: 'admin_identity',
            targetId: versionedTarget.id,
            timestamp: '2026-03-01T17:00:00.000Z',
          },
        },
        'ChangeRole',
        versionedTarget,
        AdminRole.Trainer
      )
    ).toThrow(AdminIdentityClientError);

    // 2. Rejects response missing auditReceipt.auditEventId
    expect(() =>
      validateLifecycleSuccessResponse(
        {
          operation: 'Deactivate',
          targetUid: versionedTarget.id,
          previousRevision: 7,
          currentRevision: 8,
          committedAtIso: '2026-03-01T17:00:00.000Z',
          admin: {
            id: versionedTarget.id,
            role: AdminRole.LibraryCurator,
            isActive: false,
            revision: 8,
          },
          auditReceipt: {
            auditEventId: '   ',
            action: 'ADMIN_DEACTIVATED',
            targetType: 'admin_identity',
            targetId: versionedTarget.id,
            timestamp: '2026-03-01T17:00:00.000Z',
          },
        },
        'Deactivate',
        versionedTarget
      )
    ).toThrow(AdminIdentityClientError);

    // 3. When callable fails with REVISION_CONFLICT on ChangeRole, local directory snapshot is NOT optimistically mutated
    const controller = new AdminRevisionInitializationController();
    controller.resetForTarget(
      ACTIVE_OWNER,
      versionedTarget,
      1,
      false,
      'ChangeRole',
      AdminRole.Trainer
    );
    controller.setConfirmed(
      true,
      ACTIVE_OWNER,
      'users',
      versionedTarget,
      directorySnapshot,
      'ChangeRole',
      AdminRole.Trainer
    );

    const conflictSnap = await controller.submitLifecycleOperation({
      caller: ACTIVE_OWNER,
      activeTabId: 'users',
      target: versionedTarget,
      operation: 'ChangeRole',
      proposedRole: AdminRole.Trainer,
      directorySnapshot,
      invokeChangeRole: async () => {
        throw new AdminIdentityClientError('aborted', 'REVISION_CONFLICT');
      },
      refreshDirectory: vi.fn(),
    });

    expect(conflictSnap.status).toBe('error');
    expect(conflictSnap.errorCategory).toBe('conflict');
    expect(conflictSnap.requiresRefreshBeforeRetry).toBe(true);
    expect(directorySnapshot.users[0].role).toBe(AdminRole.LibraryCurator);
    expect(directorySnapshot.users[0].revision).toBe(7);
  });

  it('48. FINAL Bilingual Arabic & English human-readable labels for all 4 operations and completion status', async () => {
    expect(ADMIN_LIFECYCLE_INITIALIZE_ACTION_LABEL_AR).toBe('تهيئة الحساب القديم');
    expect(ADMIN_LIFECYCLE_CHANGE_ROLE_LABEL_AR).toBe('تغيير الدور الإداري');
    expect(ADMIN_LIFECYCLE_DEACTIVATE_LABEL_AR).toBe('تعطيل الحساب الإداري');
    expect(ADMIN_LIFECYCLE_REACTIVATE_LABEL_AR).toBe('إعادة تفعيل الحساب الإداري');
    expect(ADMIN_LIFECYCLE_CONFIRM_OPERATION_LABEL_AR).toBe('تأكيد العملية');
    expect(ADMIN_LIFECYCLE_OPERATION_COMPLETED_LABEL_AR).toBe('تم تنفيذ العملية بنجاح');
    expect(ADMIN_LIFECYCLE_REVISION_CONFLICT_LABEL_AR).toBe('تعارض في رقم المراجعة');
    expect(ADMIN_LIFECYCLE_REFRESH_REQUIRED_LABEL_AR).toBe('يلزم تحديث الدليل');
    expect(ADMIN_LIFECYCLE_PERMISSION_DENIED_LABEL_AR).toBe('تم رفض الصلاحية');

    expect(ADMIN_LIFECYCLE_INITIALIZE_ACTION_LABEL_EN).toBe('Initialize legacy account');
    expect(ADMIN_LIFECYCLE_CHANGE_ROLE_LABEL_EN).toBe('Change administrative role');
    expect(ADMIN_LIFECYCLE_DEACTIVATE_LABEL_EN).toBe('Deactivate administrative account');
    expect(ADMIN_LIFECYCLE_REACTIVATE_LABEL_EN).toBe('Reactivate administrative account');
    expect(ADMIN_LIFECYCLE_CONFIRM_OPERATION_LABEL_EN).toBe('Confirm operation');
    expect(ADMIN_LIFECYCLE_OPERATION_COMPLETED_LABEL_EN).toBe('Operation completed');
    expect(ADMIN_LIFECYCLE_REVISION_CONFLICT_LABEL_EN).toBe('Revision conflict');
    expect(ADMIN_LIFECYCLE_REFRESH_REQUIRED_LABEL_EN).toBe('Refresh required');
    expect(ADMIN_LIFECYCLE_PERMISSION_DENIED_LABEL_EN).toBe('Permission denied');

    expect(ADMIN_LIFECYCLE_CHANGE_ROLE_CONFIRM_CHECKBOX_AR.length).toBeGreaterThan(10);
    expect(ADMIN_LIFECYCLE_CHANGE_ROLE_CONFIRM_CHECKBOX_EN.length).toBeGreaterThan(10);
    expect(ADMIN_LIFECYCLE_DEACTIVATE_CONFIRM_CHECKBOX_AR.length).toBeGreaterThan(10);
    expect(ADMIN_LIFECYCLE_DEACTIVATE_CONFIRM_CHECKBOX_EN.length).toBeGreaterThan(10);
    expect(ADMIN_LIFECYCLE_REACTIVATE_CONFIRM_CHECKBOX_AR.length).toBeGreaterThan(10);
    expect(ADMIN_LIFECYCLE_REACTIVATE_CONFIRM_CHECKBOX_EN.length).toBeGreaterThan(10);

    const versionedTarget: AdminUser = {
      id: 'ver-target-809',
      name: 'Bilingual Test Target',
      email: 'bilingual@promiseofplanet.org',
      role: AdminRole.ContentEditor,
      isActive: true,
      revision: 2,
    };

    await i18n.changeLanguage('ar');
    const completedHtmlAr = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: [versionedTarget],
        }}
        initialLifecycleSubmissionState={{
          status: 'succeeded',
          isConfirmed: false,
          boundCallerUid: ACTIVE_OWNER.id,
          boundTargetUid: versionedTarget.id,
          boundDirectoryGeneration: 1,
          lastCompletedOperation: 'ChangeRole',
          lastCompletedTargetUid: versionedTarget.id,
          lastAuditEventId: 'audit-bilingual-001',
        }}
      />
    );
    expect(completedHtmlAr).toContain('data-testid="admin-lifecycle-completed-banner"');
    expect(completedHtmlAr).toContain(ADMIN_LIFECYCLE_OPERATION_COMPLETED_LABEL_AR);
    expect(completedHtmlAr).toContain('audit-bilingual-001');

    await i18n.changeLanguage('en');
    const completedHtmlEn = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: [versionedTarget],
        }}
        initialLifecycleSubmissionState={{
          status: 'succeeded',
          isConfirmed: false,
          boundCallerUid: ACTIVE_OWNER.id,
          boundTargetUid: versionedTarget.id,
          boundDirectoryGeneration: 1,
          lastCompletedOperation: 'ChangeRole',
          lastCompletedTargetUid: versionedTarget.id,
          lastAuditEventId: 'audit-bilingual-001',
        }}
      />
    );
    expect(completedHtmlEn).toContain('data-testid="admin-lifecycle-completed-banner"');
    expect(completedHtmlEn).toContain(ADMIN_LIFECYCLE_OPERATION_COMPLETED_LABEL_EN);
    expect(completedHtmlEn).toContain('audit-bilingual-001');

    await i18n.changeLanguage('ar');
  });
});

