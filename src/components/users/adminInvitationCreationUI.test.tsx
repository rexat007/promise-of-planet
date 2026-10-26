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

import {
  AdminRole,
  AdminPermission,
  AdminDomain,
  type AdminUser,
} from '../../types/admin';
import {
  AdminInvitationStatus,
  DEFAULT_ADMIN_INVITATION_TTL_MS,
  createAdminInvitation,
  listAdminUsers,
  type AdminIdentityClientDependencies,
  type CreateAdminInvitationClientResponse,
  type ManageAdminInvitationsClientPayload,
} from '../../services/adminIdentityManagementClient';
import {
  ADMIN_DIRECTORY_MUTATION_DISABLED_NOTICE_AR,
  ADMIN_DIRECTORY_MUTATION_DISABLED_NOTICE_EN,
  AdminDirectoryLoadController,
  AdminUsersManagement,
  filterAdminDirectoryEntries,
} from './AdminUsersManagement';
import {
  INVITABLE_ADMIN_ROLES,
  INVITATION_NO_EMAIL_SENT_NOTICE_AR,
  INVITATION_NO_EMAIL_SENT_NOTICE_EN,
  INVITATION_LOCATOR_NOTICE_AR,
  INVITATION_LOCATOR_NOTICE_EN,
  AdminInvitationCreationController,
  AdminInvitationCreationPanel,
  classifyInvitationCreationFailure,
  isAuthorizedToCreateAdminInvitation,
  isInvitableAdminRole,
  normalizeAndValidateInviteEmail,
} from './AdminInvitationCreationPanel';

const ACTIVE_OWNER: AdminUser = Object.freeze({
  id: 'owner-uid-900',
  name: 'Nadia Al-Mansoor',
  email: 'nadia.owner@promiseofplanet.org',
  role: AdminRole.Owner,
  isActive: true,
});

const INACTIVE_OWNER: AdminUser = Object.freeze({
  id: 'owner-uid-901',
  name: 'Inactive Owner',
  email: 'inactive.owner@promiseofplanet.org',
  role: AdminRole.Owner,
  isActive: false,
});

const NON_OWNER_ADMINS: ReadonlyArray<AdminUser> = Object.freeze([
  {
    id: 'ce-101',
    name: 'Content Editor',
    email: 'ce@promiseofplanet.org',
    role: AdminRole.ContentEditor,
    isActive: true,
  },
  {
    id: 'lc-102',
    name: 'Library Curator',
    email: 'lc@promiseofplanet.org',
    role: AdminRole.LibraryCurator,
    isActive: true,
  },
  {
    id: 'rr-103',
    name: 'Rights Reviewer',
    email: 'rr@promiseofplanet.org',
    role: AdminRole.RightsReviewer,
    isActive: true,
  },
  {
    id: 'tm-104',
    name: 'Training Manager',
    email: 'tm@promiseofplanet.org',
    role: AdminRole.TrainingManager,
    isActive: true,
  },
  {
    id: 'tr-105',
    name: 'Trainer',
    email: 'tr@promiseofplanet.org',
    role: AdminRole.Trainer,
    isActive: true,
  },
  {
    id: 'cm-106',
    name: 'Citizen Moderator',
    email: 'cm@promiseofplanet.org',
    role: AdminRole.CitizenModerator,
    isActive: true,
  },
  {
    id: 'ai-107',
    name: 'AI Assistant',
    email: 'ai@promiseofplanet.org',
    role: AdminRole.AIAssistant,
    isActive: true,
  },
  {
    id: 'vw-108',
    name: 'Viewer',
    email: 'vw@promiseofplanet.org',
    role: AdminRole.Viewer,
    isActive: true,
  },
]);

const SERVER_DIRECTORY_ADMINS: ReadonlyArray<AdminUser> = Object.freeze([
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
]);

function buildPendingInvitationResponse(
  overrides?: Partial<{
    invitationId: string;
    normalizedTargetEmail: string;
    intendedRole: AdminRole;
    invitingOwnerUid: string;
    createdAtIso: string;
    expiresAtIso: string;
    auditEventId: string;
  }>
): CreateAdminInvitationClientResponse {
  return Object.freeze({
    invitation: Object.freeze({
      invitationId: overrides?.invitationId ?? 'inv_20261026_alpha99',
      targetUid: null,
      normalizedTargetEmail:
        overrides?.normalizedTargetEmail ?? 'candidate.editor@promiseofplanet.org',
      intendedRole: overrides?.intendedRole ?? AdminRole.ContentEditor,
      invitingOwnerUid: overrides?.invitingOwnerUid ?? ACTIVE_OWNER.id,
      createdAtIso: overrides?.createdAtIso ?? '2026-10-26T09:00:00.000Z',
      expiresAtIso: overrides?.expiresAtIso ?? '2026-11-02T09:00:00.000Z',
      status: AdminInvitationStatus.Pending,
      acceptedAtIso: null,
      acceptedByUid: null,
      revokedAtIso: null,
      revokedByOwnerUid: null,
      expiredAtIso: null,
      revision: 1,
    }),
    auditEventId: overrides?.auditEventId ?? 'audit_inv_20261026_001',
  });
}

describe('AUTH-03C3 — Owner Administrative Invitation Creation UI', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('ar');
  });

  it('1. Active Owner can open and view the invitation creation UI inside Users Management', () => {
    expect(isAuthorizedToCreateAdminInvitation(ACTIVE_OWNER, 'users')).toBe(
      true
    );

    const closedHtml = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: SERVER_DIRECTORY_ADMINS,
        }}
      />
    );
    expect(closedHtml).toContain('data-testid="open-admin-invitation-panel-btn"');
    expect(closedHtml).not.toContain(
      'data-testid="admin-invitation-creation-panel"'
    );

    const openHtml = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialInvitationPanelOpen={true}
        initialDirectoryState={{
          status: 'loaded',
          users: SERVER_DIRECTORY_ADMINS,
        }}
      />
    );
    expect(openHtml).toContain('data-testid="admin-invitation-creation-panel"');
    expect(openHtml).toContain('data-testid="admin-invitation-creation-form"');
    expect(openHtml).toContain('data-testid="invitation-target-email-input"');
    expect(openHtml).toContain('data-testid="invitation-intended-role-select"');
    expect(openHtml).toContain('data-testid="invitation-ttl-select"');
    expect(openHtml).toContain('data-testid="submit-admin-invitation-btn"');
  });

  it('2. Non-Owner roles cannot render or submit the invitation creation UI', async () => {
    const createSpy = vi.fn();

    for (const nonOwner of NON_OWNER_ADMINS) {
      expect(isAuthorizedToCreateAdminInvitation(nonOwner, 'users')).toBe(false);

      const panelHtml = renderToStaticMarkup(
        <AdminInvitationCreationPanel
          currentUser={nonOwner}
          activeTabId="users"
        />
      );
      expect(panelHtml).toBe('');

      const managementHtml = renderToStaticMarkup(
        <AdminUsersManagement
          currentUser={nonOwner}
          activeTabId="users"
          initialInvitationPanelOpen={true}
        />
      );
      expect(managementHtml).toContain(
        'data-testid="admin-directory-unauthorized-state"'
      );
      expect(managementHtml).not.toContain(
        'data-testid="open-admin-invitation-panel-btn"'
      );
      expect(managementHtml).not.toContain(
        'data-testid="admin-invitation-creation-panel"'
      );

      const controller = new AdminInvitationCreationController();
      const snap = await controller.submit({
        currentUser: nonOwner,
        activeTabId: 'users',
        targetEmail: 'new.curator@promiseofplanet.org',
        intendedRole: AdminRole.LibraryCurator,
        invokeCreateInvitation: createSpy,
      });
      expect(snap.status).toBe('error');
      expect(snap.error?.category).toBe('unauthorized');
      expect(snap.receipt).toBeNull();
    }

    expect(createSpy).not.toHaveBeenCalled();
  });

  it('3. Inactive Owner cannot render or submit the invitation creation UI', async () => {
    expect(isAuthorizedToCreateAdminInvitation(INACTIVE_OWNER, 'users')).toBe(
      false
    );

    const panelHtml = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={INACTIVE_OWNER}
        activeTabId="users"
      />
    );
    expect(panelHtml).toBe('');

    const managementHtml = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={INACTIVE_OWNER}
        activeTabId="users"
        initialInvitationPanelOpen={true}
      />
    );
    expect(managementHtml).toContain(
      'data-testid="admin-directory-unauthorized-state"'
    );
    expect(managementHtml).not.toContain(
      'data-testid="open-admin-invitation-panel-btn"'
    );

    const createSpy = vi.fn();
    const controller = new AdminInvitationCreationController();
    const snap = await controller.submit({
      currentUser: INACTIVE_OWNER,
      activeTabId: 'users',
      targetEmail: 'new.curator@promiseofplanet.org',
      intendedRole: AdminRole.LibraryCurator,
      invokeCreateInvitation: createSpy,
    });
    expect(snap.status).toBe('error');
    expect(snap.error?.category).toBe('unauthorized');
    expect(snap.receipt).toBeNull();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('4. Invalid target email is rejected before invoking the server callable', async () => {
    const invalidEmails: unknown[] = [
      '',
      '   ',
      'plain-string',
      'missing-domain@',
      '@missing-local.org',
      'double..dots@promiseofplanet.org',
      'spaces in@promiseofplanet.org',
      null,
      undefined,
      12345,
    ];

    const createSpy = vi.fn();
    const controller = new AdminInvitationCreationController();

    for (const badEmail of invalidEmails) {
      expect(normalizeAndValidateInviteEmail(badEmail)).toBeNull();

      const snap = await controller.submit({
        currentUser: ACTIVE_OWNER,
        activeTabId: 'users',
        targetEmail: badEmail,
        intendedRole: AdminRole.ContentEditor,
        invokeCreateInvitation: createSpy,
      });

      expect(snap.status).toBe('error');
      expect(snap.error?.category).toBe('invalid-email');
      expect(snap.receipt).toBeNull();
    }

    expect(createSpy).not.toHaveBeenCalled();
  });

  it('5. Invalid non-canonical role is rejected before invoking the server callable', async () => {
    const invalidRoles: unknown[] = [
      '',
      'SuperAdmin',
      'GeneralManager',
      'Admin',
      null,
      undefined,
      {},
    ];

    const createSpy = vi.fn();
    const controller = new AdminInvitationCreationController();

    for (const badRole of invalidRoles) {
      expect(isInvitableAdminRole(badRole)).toBe(false);

      const snap = await controller.submit({
        currentUser: ACTIVE_OWNER,
        activeTabId: 'users',
        targetEmail: 'valid.candidate@promiseofplanet.org',
        intendedRole: badRole,
        invokeCreateInvitation: createSpy,
      });

      expect(snap.status).toBe('error');
      expect(snap.error?.category).toBe('invalid-role');
      expect(snap.receipt).toBeNull();
    }

    expect(createSpy).not.toHaveBeenCalled();
  });

  it('6. Owner target role is excluded from selectable roles and rejected on submission', async () => {
    expect(INVITABLE_ADMIN_ROLES).not.toContain(AdminRole.Owner);
    expect(INVITABLE_ADMIN_ROLES).toHaveLength(8);
    expect(isInvitableAdminRole(AdminRole.Owner)).toBe(false);

    const panelHtml = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
      />
    );
    expect(panelHtml).not.toContain(`<option value="${AdminRole.Owner}">`);

    const createSpy = vi.fn();
    const controller = new AdminInvitationCreationController();
    const snap = await controller.submit({
      currentUser: ACTIVE_OWNER,
      activeTabId: 'users',
      targetEmail: 'owner.attempt@promiseofplanet.org',
      intendedRole: AdminRole.Owner,
      invokeCreateInvitation: createSpy,
    });

    expect(snap.status).toBe('error');
    expect(snap.error?.category).toBe('invalid-role');
    expect(snap.receipt).toBeNull();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('7. Valid submission invokes createAdminInvitation client with exact canonical payload', async () => {
    const callableSpy = vi.fn(
      async (payload: ManageAdminInvitationsClientPayload) => {
        expect(payload).toEqual({
          action: 'createInvitation',
          targetEmail: 'candidate.editor@promiseofplanet.org',
          intendedRole: AdminRole.ContentEditor,
          ttlMs: DEFAULT_ADMIN_INVITATION_TTL_MS,
        });
        return {
          data: buildPendingInvitationResponse({
            normalizedTargetEmail: 'candidate.editor@promiseofplanet.org',
            intendedRole: AdminRole.ContentEditor,
          }),
        };
      }
    );

    const clientDeps: AdminIdentityClientDependencies = {
      isBackendConfigured: () => true,
      getAuthenticatedUid: () => ACTIVE_OWNER.id,
      manageAdminInvitationsCallable: callableSpy,
    };

    const controller = new AdminInvitationCreationController();
    const snap = await controller.submit({
      currentUser: ACTIVE_OWNER,
      activeTabId: 'users',
      targetEmail: '  Candidate.Editor@PromiseOfPlanet.org ',
      intendedRole: AdminRole.ContentEditor,
      ttlMs: DEFAULT_ADMIN_INVITATION_TTL_MS,
      clientDeps,
    });

    expect(callableSpy).toHaveBeenCalledTimes(1);
    expect(snap.status).toBe('succeeded');
    expect(snap.error).toBeNull();
    expect(snap.receipt?.invitation.invitationId).toBe('inv_20261026_alpha99');
    expect(snap.receipt?.invitation.status).toBe(AdminInvitationStatus.Pending);
  });

  it('8. Duplicate submission is prevented while a request is pending', async () => {
    let resolveInFlight!: (
      value: CreateAdminInvitationClientResponse
    ) => void;
    const inFlightPromise = new Promise<CreateAdminInvitationClientResponse>(
      (resolve) => {
        resolveInFlight = resolve;
      }
    );

    const invokeSpy = vi.fn(() => inFlightPromise);
    const controller = new AdminInvitationCreationController();

    const firstTask = controller.submit({
      currentUser: ACTIVE_OWNER,
      activeTabId: 'users',
      targetEmail: 'first.candidate@promiseofplanet.org',
      intendedRole: AdminRole.RightsReviewer,
      invokeCreateInvitation: invokeSpy,
    });

    expect(controller.getSnapshot().status).toBe('submitting');

    // Attempt second submission while first is still submitting
    const duplicateSnap = await controller.submit({
      currentUser: ACTIVE_OWNER,
      activeTabId: 'users',
      targetEmail: 'second.candidate@promiseofplanet.org',
      intendedRole: AdminRole.LibraryCurator,
      invokeCreateInvitation: invokeSpy,
    });

    expect(duplicateSnap.status).toBe('submitting');
    expect(invokeSpy).toHaveBeenCalledTimes(1);

    resolveInFlight(
      buildPendingInvitationResponse({
        normalizedTargetEmail: 'first.candidate@promiseofplanet.org',
        intendedRole: AdminRole.RightsReviewer,
      })
    );

    const finalSnap = await firstTask;
    expect(finalSnap.status).toBe('succeeded');
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });

  it('9. Server failures (unauthorized, conflict, unavailable, internal) do not show success and render bilingual feedback without leaking internals', async () => {
    const errorCases: Array<{
      readonly code: string;
      readonly message: string;
      readonly expectedCategory: string;
    }> = [
      {
        code: 'functions/permission-denied',
        message: 'Caller is not authorized at /workspace/functions/src/index.ts:99',
        expectedCategory: 'unauthorized',
      },
      {
        code: 'functions/failed-precondition',
        message: 'EXISTING_ADMIN_CONFLICT: admins/srv-admin-001',
        expectedCategory: 'existing-admin-conflict',
      },
      {
        code: 'functions/unavailable',
        message: 'ECONNREFUSED 127.0.0.1:8080',
        expectedCategory: 'unavailable',
      },
      {
        code: 'functions/internal',
        message: 'Error: Firestore transaction failed at Object.runTransaction',
        expectedCategory: 'server-failure',
      },
    ];

    for (const testCase of errorCases) {
      const clientDeps: AdminIdentityClientDependencies = {
        isBackendConfigured: () => true,
        getAuthenticatedUid: () => ACTIVE_OWNER.id,
        manageAdminInvitationsCallable: async () => {
          throw { code: testCase.code, message: testCase.message };
        },
      };

      const controller = new AdminInvitationCreationController();
      const snap = await controller.submit({
        currentUser: ACTIVE_OWNER,
        activeTabId: 'users',
        targetEmail: 'candidate@promiseofplanet.org',
        intendedRole: AdminRole.Trainer,
        clientDeps,
      });

      expect(snap.status).toBe('error');
      expect(snap.receipt).toBeNull();
      expect(snap.error?.category).toBe(testCase.expectedCategory);

      const html = renderToStaticMarkup(
        <AdminInvitationCreationPanel
          currentUser={ACTIVE_OWNER}
          activeTabId="users"
          initialSubmissionState={snap}
        />
      );

      expect(html).toContain('data-testid="admin-invitation-error-banner"');
      expect(html).toContain(
        `data-error-category="${testCase.expectedCategory}"`
      );
      expect(html).not.toContain('data-testid="admin-invitation-pending-receipt"');
      expect(html).not.toContain('/workspace/functions');
      expect(html).not.toContain('ECONNREFUSED');
      expect(html).not.toContain('runTransaction');
    }

    // Also verify local conflict detection against loaded directory users
    const conflictController = new AdminInvitationCreationController();
    const conflictSnap = await conflictController.submit({
      currentUser: ACTIVE_OWNER,
      activeTabId: 'users',
      targetEmail: SERVER_DIRECTORY_ADMINS[0].email,
      intendedRole: AdminRole.Viewer,
      existingDirectoryUsers: SERVER_DIRECTORY_ADMINS,
    });
    expect(conflictSnap.status).toBe('error');
    expect(conflictSnap.error?.category).toBe('existing-admin-conflict');
    expect(conflictSnap.receipt).toBeNull();
  });

  it('10. Successful response displays the canonical Pending receipt with all server-returned fields', async () => {
    const pendingResponse = buildPendingInvitationResponse({
      invitationId: 'inv_pending_778899',
      normalizedTargetEmail: 'curator.new@promiseofplanet.org',
      intendedRole: AdminRole.LibraryCurator,
      invitingOwnerUid: ACTIVE_OWNER.id,
      createdAtIso: '2026-10-26T10:15:00.000Z',
      expiresAtIso: '2026-11-02T10:15:00.000Z',
      auditEventId: 'audit_evt_778899',
    });

    const htmlAr = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialSubmissionState={{
          status: 'succeeded',
          receipt: pendingResponse,
          error: null,
          submissionCount: 1,
        }}
      />
    );

    expect(htmlAr).toContain('data-testid="admin-invitation-pending-receipt"');
    expect(htmlAr).toContain('inv_pending_778899');
    expect(htmlAr).toContain('curator.new@promiseofplanet.org');
    expect(htmlAr).toContain(AdminRole.LibraryCurator);
    expect(htmlAr).toContain('Pending');
    expect(htmlAr).toContain('2026-10-26T10:15:00.000Z');
    expect(htmlAr).toContain('2026-11-02T10:15:00.000Z');
    expect(htmlAr).toContain(ACTIVE_OWNER.id);
    expect(htmlAr).toContain('audit_evt_778899');

    await i18n.changeLanguage('en');
    const htmlEn = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialSubmissionState={{
          status: 'succeeded',
          receipt: pendingResponse,
          error: null,
          submissionCount: 1,
        }}
      />
    );

    expect(htmlEn).toContain('data-testid="admin-invitation-pending-receipt"');
    expect(htmlEn).toContain('Status: Pending');
    expect(htmlEn).toContain('inv_pending_778899');
  });

  it('11. Creating an invitation does NOT append an active admin to the directory', async () => {
    const pendingResponse = buildPendingInvitationResponse({
      normalizedTargetEmail: 'pending.moderator@promiseofplanet.org',
      intendedRole: AdminRole.CitizenModerator,
    });

    const html = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialInvitationPanelOpen={true}
        initialDirectoryState={{
          status: 'loaded',
          users: SERVER_DIRECTORY_ADMINS,
        }}
        initialInvitationSubmissionState={{
          status: 'succeeded',
          receipt: pendingResponse,
          error: null,
          submissionCount: 1,
        }}
      />
    );

    // Receipt shows the pending invitee
    expect(html).toContain('data-testid="admin-invitation-pending-receipt"');
    expect(html).toContain('pending.moderator@promiseofplanet.org');

    // Directory rows and cards contain ONLY the 2 existing server directory records
    expect(html).toContain('data-testid="admin-directory-row-srv-admin-001"');
    expect(html).toContain('data-testid="admin-directory-row-srv-admin-002"');
    expect(html).not.toContain(
      `data-testid="admin-directory-row-${pendingResponse.invitation.invitationId}"`
    );
    expect(html).toContain('عرض 2 من إجمالي 2 هوية');
  });

  it('12. No email delivery, automatic activation, or acceptance URL is claimed', async () => {
    const pendingResponse = buildPendingInvitationResponse();

    const htmlAr = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialSubmissionState={{
          status: 'succeeded',
          receipt: pendingResponse,
          error: null,
          submissionCount: 1,
        }}
      />
    );

    expect(htmlAr).toContain(INVITATION_NO_EMAIL_SENT_NOTICE_AR);
    expect(htmlAr).toContain(INVITATION_LOCATOR_NOTICE_AR);
    expect(htmlAr).toContain('data-testid="receipt-non-activation-confirmation"');
    expect(htmlAr).not.toContain('https://');
    expect(htmlAr).not.toContain('href=');
    expect(htmlAr).not.toContain('?invitationId=');
    expect(htmlAr).not.toContain('accept-invitation');
    expect(htmlAr).not.toContain('تم إرسال البريد');

    await i18n.changeLanguage('en');
    const htmlEn = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialSubmissionState={{
          status: 'succeeded',
          receipt: pendingResponse,
          error: null,
          submissionCount: 1,
        }}
      />
    );

    expect(htmlEn).toContain(INVITATION_NO_EMAIL_SENT_NOTICE_EN);
    expect(htmlEn).toContain(INVITATION_LOCATOR_NOTICE_EN);
    expect(htmlEn).toContain(
      'No email has been sent, and the invitee has NOT been activated'
    );
    expect(htmlEn).not.toContain('https://');
    expect(htmlEn).not.toContain('href=');
    expect(htmlEn).not.toContain('?invitationId=');
    expect(htmlEn).not.toContain('accept-invitation');
  });

  it('13. No password fields exist in the invitation creation UI', () => {
    const html = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
      />
    );

    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('name="password"');
    expect(html).not.toContain('id="password"');
  });

  it('14. No direct Firestore writes or getMockUsers exist in AdminInvitationCreationPanel or AdminUsersManagement', () => {
    const panelSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'src/components/users/AdminInvitationCreationPanel.tsx'
      ),
      'utf8'
    );
    const managementSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'src/components/users/AdminUsersManagement.tsx'
      ),
      'utf8'
    );

    const forbiddenPatterns = [
      'getMockUsers',
      'createDemoUser',
      'setDoc',
      'updateDoc',
      'deleteDoc',
      'addDoc',
      'writeBatch',
      'runTransaction',
      'createUserWithEmailAndPassword',
    ];

    for (const pattern of forbiddenPatterns) {
      expect(panelSource).not.toContain(pattern);
      expect(managementSource).not.toContain(pattern);
    }

    expect(classifyInvitationCreationFailure(new Error('unexpected')).category).toBe(
      'server-failure'
    );
  });

  it('15. Existing real directory loading, filtering, and AUTH-03C2 read-only notices remain functional', async () => {
    const directoryController = new AdminDirectoryLoadController();
    const clientDeps: AdminIdentityClientDependencies = {
      isBackendConfigured: () => true,
      getAuthenticatedUid: () => ACTIVE_OWNER.id,
      listAdminUsersCallable: async () => ({
        data: { admins: SERVER_DIRECTORY_ADMINS },
      }),
    };

    const dirSnap = await directoryController.loadDirectory(
      ACTIVE_OWNER,
      'users',
      () => listAdminUsers(clientDeps)
    );
    expect(dirSnap.status).toBe('loaded');
    expect(dirSnap.users).toEqual(SERVER_DIRECTORY_ADMINS);

    const filtered = filterAdminDirectoryEntries(dirSnap.users, {
      searchQuery: 'tariq',
      selectedRoleFilter: AdminRole.RightsReviewer,
      selectedStatusFilter: 'ACTIVE',
      isAr: true,
    });
    expect(filtered.map((u) => u.id)).toEqual(['srv-admin-002']);

    const htmlAr = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: dirSnap.users,
        }}
      />
    );
    expect(htmlAr).toContain(ADMIN_DIRECTORY_MUTATION_DISABLED_NOTICE_AR);

    await i18n.changeLanguage('en');
    const htmlEn = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialDirectoryState={{
          status: 'loaded',
          users: dirSnap.users,
        }}
      />
    );
    expect(htmlEn).toContain(
      ADMIN_DIRECTORY_MUTATION_DISABLED_NOTICE_EN.replace(/'/g, '&#x27;')
    );
    expect(typeof createAdminInvitation).toBe('function');
  });

  it('16. RTL/LTR and mobile responsive layout classes remain intact', async () => {
    await i18n.changeLanguage('ar');
    const htmlAr = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialInvitationPanelOpen={true}
        initialDirectoryState={{
          status: 'loaded',
          users: SERVER_DIRECTORY_ADMINS,
        }}
      />
    );
    expect(htmlAr).toContain('dir="rtl"');
    expect(htmlAr).toContain('grid-cols-1 md:grid-cols-3');
    expect(htmlAr).toContain('w-full sm:w-auto');

    await i18n.changeLanguage('en');
    const htmlEn = renderToStaticMarkup(
      <AdminUsersManagement
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialInvitationPanelOpen={true}
        initialDirectoryState={{
          status: 'loaded',
          users: SERVER_DIRECTORY_ADMINS,
        }}
      />
    );
    expect(htmlEn).toContain('dir="ltr"');
    expect(htmlEn).toContain('grid-cols-1 md:grid-cols-3');
    expect(htmlEn).toContain('w-full sm:w-auto');
  });
});
