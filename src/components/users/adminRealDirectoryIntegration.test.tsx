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
  listAdminUsers,
  type AdminIdentityClientDependencies,
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
  AdminDirectoryLoadController,
  AdminUsersManagement,
  classifyDirectoryLoadFailure,
  filterAdminDirectoryEntries,
  isAuthorizedOwnerForUsersDirectory,
  validateCanonicalDirectoryUsersList,
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
});
