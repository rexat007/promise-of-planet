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

import { AdminRole, type AdminUser } from '../../types/admin';
import {
  AdminInvitationStatus,
  DEFAULT_ADMIN_INVITATION_TTL_MS,
  revokeAdminInvitation,
  type AdminIdentityClientDependencies,
  type CreateAdminInvitationClientResponse,
  type ManageAdminInvitationsClientPayload,
  type RevokeAdminInvitationClientResponse,
} from '../../services/adminIdentityManagementClient';
import {
  REVOKE_INVITATION_ACTION_AR,
  REVOKE_INVITATION_ACTION_EN,
  CONFIRM_REVOKE_INVITATION_ACTION_AR,
  CONFIRM_REVOKE_INVITATION_ACTION_EN,
  CANCEL_REVOKE_INVITATION_ACTION_AR,
  CANCEL_REVOKE_INVITATION_ACTION_EN,
  INVITATION_REVOKED_NO_EMAIL_NOTICE_AR,
  INVITATION_REVOKED_NO_EMAIL_NOTICE_EN,
  AdminInvitationCreationController,
  AdminInvitationCreationPanel,
  classifyInvitationRevocationFailure,
  isAuthorizedToRevokeAdminInvitation,
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

function buildPendingInvitationReceipt(
  overrides?: Partial<{
    invitationId: string;
    normalizedTargetEmail: string;
    intendedRole: AdminRole;
    invitingOwnerUid: string;
    createdAtIso: string;
    expiresAtIso: string;
    revision: number;
    auditEventId: string;
  }>
): CreateAdminInvitationClientResponse {
  return Object.freeze({
    invitation: Object.freeze({
      invitationId: overrides?.invitationId ?? 'inv_revoke_20261026_01',
      targetUid: null,
      normalizedTargetEmail:
        overrides?.normalizedTargetEmail ?? 'pending.editor@promiseofplanet.org',
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
      revision: overrides?.revision ?? 1,
    }),
    auditEventId: overrides?.auditEventId ?? 'audit_create_20261026_01',
  });
}

function buildRevokedInvitationResponse(
  overrides?: Partial<{
    invitationId: string;
    normalizedTargetEmail: string;
    intendedRole: AdminRole;
    invitingOwnerUid: string;
    createdAtIso: string;
    expiresAtIso: string;
    revokedAtIso: string;
    revokedByOwnerUid: string;
    revision: number;
    auditEventId: string;
  }>
): RevokeAdminInvitationClientResponse {
  return Object.freeze({
    invitation: Object.freeze({
      invitationId: overrides?.invitationId ?? 'inv_revoke_20261026_01',
      targetUid: null,
      normalizedTargetEmail:
        overrides?.normalizedTargetEmail ?? 'pending.editor@promiseofplanet.org',
      intendedRole: overrides?.intendedRole ?? AdminRole.ContentEditor,
      invitingOwnerUid: overrides?.invitingOwnerUid ?? ACTIVE_OWNER.id,
      createdAtIso: overrides?.createdAtIso ?? '2026-10-26T09:00:00.000Z',
      expiresAtIso: overrides?.expiresAtIso ?? '2026-11-02T09:00:00.000Z',
      status: AdminInvitationStatus.Revoked,
      acceptedAtIso: null,
      acceptedByUid: null,
      revokedAtIso: overrides?.revokedAtIso ?? '2026-10-26T09:30:00.000Z',
      revokedByOwnerUid: overrides?.revokedByOwnerUid ?? ACTIVE_OWNER.id,
      expiredAtIso: null,
      revision: overrides?.revision ?? 2,
    }),
    auditEventId: overrides?.auditEventId ?? 'audit_revoke_20261026_02',
  });
}

describe('AUTH-03C5 — Owner Invitation Revocation from Pending Receipt', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('ar');
  });

  it('1. Active Owner sees the Revoke Invitation action inside a server-confirmed Pending receipt', async () => {
    expect(isAuthorizedToRevokeAdminInvitation(ACTIVE_OWNER, 'users')).toBe(
      true
    );

    const pendingReceipt = buildPendingInvitationReceipt();

    const htmlAr = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialSubmissionState={{
          status: 'succeeded',
          receipt: pendingReceipt,
          error: null,
          submissionCount: 1,
        }}
      />
    );

    expect(htmlAr).toContain('data-testid="admin-invitation-pending-receipt"');
    expect(htmlAr).toContain('data-invitation-status="Pending"');
    expect(htmlAr).toContain('data-testid="request-revoke-invitation-btn"');
    expect(htmlAr).toContain(REVOKE_INVITATION_ACTION_AR);

    await i18n.changeLanguage('en');
    const htmlEn = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialSubmissionState={{
          status: 'succeeded',
          receipt: pendingReceipt,
          error: null,
          submissionCount: 1,
        }}
      />
    );

    expect(htmlEn).toContain('data-testid="request-revoke-invitation-btn"');
    expect(htmlEn).toContain(REVOKE_INVITATION_ACTION_EN);
  });

  it('2. No revocation action is rendered or allowed before a Pending receipt exists', async () => {
    const idleHtml = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
      />
    );

    expect(idleHtml).not.toContain('data-testid="request-revoke-invitation-btn"');
    expect(idleHtml).not.toContain('data-testid="confirm-revoke-invitation-btn"');
    expect(idleHtml).not.toContain(
      'data-testid="revoke-invitation-confirmation-box"'
    );

    const revokeSpy = vi.fn();
    const controller = new AdminInvitationCreationController();
    const snap = await controller.revoke({
      currentUser: ACTIVE_OWNER,
      activeTabId: 'users',
      confirmed: true,
      invokeRevokeInvitation: revokeSpy,
    });

    expect(snap.revocationStatus).toBe('error');
    expect(snap.revocationError?.category).toBe('non-pending-receipt');
    expect(snap.receipt).toBeNull();
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it('3. Non-Owner roles and inactive Owner are denied from revoking invitations', async () => {
    const pendingReceipt = buildPendingInvitationReceipt();
    const revokeSpy = vi.fn();

    for (const nonOwner of [...NON_OWNER_ADMINS, INACTIVE_OWNER]) {
      expect(isAuthorizedToRevokeAdminInvitation(nonOwner, 'users')).toBe(false);

      const html = renderToStaticMarkup(
        <AdminInvitationCreationPanel
          currentUser={nonOwner}
          activeTabId="users"
          initialSubmissionState={{
            status: 'succeeded',
            receipt: pendingReceipt,
            error: null,
            submissionCount: 1,
          }}
        />
      );
      expect(html).toBe('');

      const controller = new AdminInvitationCreationController({
        status: 'succeeded',
        receipt: pendingReceipt,
        error: null,
        submissionCount: 1,
      });

      const snap = await controller.revoke({
        currentUser: nonOwner,
        activeTabId: 'users',
        confirmed: true,
        invokeRevokeInvitation: revokeSpy,
      });

      expect(snap.revocationStatus).toBe('error');
      expect(snap.revocationError?.category).toBe('unauthorized');
      expect(snap.receipt?.invitation.status).toBe(AdminInvitationStatus.Pending);
    }

    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it('4. Explicit confirmation is required before invoking the server revocation request', async () => {
    const pendingReceipt = buildPendingInvitationReceipt();

    // Without initialConfirmingRevocation, confirmation box is not open yet
    const beforeConfirmHtml = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialSubmissionState={{
          status: 'succeeded',
          receipt: pendingReceipt,
          error: null,
          submissionCount: 1,
        }}
      />
    );
    expect(beforeConfirmHtml).toContain(
      'data-testid="request-revoke-invitation-btn"'
    );
    expect(beforeConfirmHtml).not.toContain(
      'data-testid="revoke-invitation-confirmation-box"'
    );

    // When confirmation is opened, both Confirm and Cancel controls are rendered
    const confirmBoxArHtml = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialConfirmingRevocation={true}
        initialSubmissionState={{
          status: 'succeeded',
          receipt: pendingReceipt,
          error: null,
          submissionCount: 1,
        }}
      />
    );
    expect(confirmBoxArHtml).toContain(
      'data-testid="revoke-invitation-confirmation-box"'
    );
    expect(confirmBoxArHtml).toContain(
      'data-testid="confirm-revoke-invitation-btn"'
    );
    expect(confirmBoxArHtml).toContain(
      'data-testid="cancel-revoke-invitation-btn"'
    );
    expect(confirmBoxArHtml).toContain(CONFIRM_REVOKE_INVITATION_ACTION_AR);
    expect(confirmBoxArHtml).toContain(CANCEL_REVOKE_INVITATION_ACTION_AR);

    // Calling controller.revoke with confirmed: false fails closed without calling server
    const revokeSpy = vi.fn();
    const controller = new AdminInvitationCreationController({
      status: 'succeeded',
      receipt: pendingReceipt,
      error: null,
      submissionCount: 1,
    });

    const unconfirmedSnap = await controller.revoke({
      currentUser: ACTIVE_OWNER,
      activeTabId: 'users',
      confirmed: false,
      invokeRevokeInvitation: revokeSpy,
    });

    expect(unconfirmedSnap.revocationStatus).toBe('error');
    expect(unconfirmedSnap.revocationError?.category).toBe(
      'confirmation-required'
    );
    expect(unconfirmedSnap.receipt).toEqual(pendingReceipt);
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it('5. Canonical revocation request sends only action, invitationId, and expectedRevision via revokeAdminInvitation', async () => {
    const pendingReceipt = buildPendingInvitationReceipt({
      invitationId: 'inv_canonical_revoke_55',
      revision: 1,
    });

    let capturedPayload: Record<string, unknown> | null = null;

    const clientDeps: AdminIdentityClientDependencies = {
      isBackendConfigured: () => true,
      getAuthenticatedUid: () => ACTIVE_OWNER.id,
      manageAdminInvitationsCallable: async (
        payload: ManageAdminInvitationsClientPayload
      ) => {
        capturedPayload = payload as unknown as Record<string, unknown>;
        return {
          data: buildRevokedInvitationResponse({
            invitationId: 'inv_canonical_revoke_55',
            revision: 2,
          }),
        };
      },
    };

    const controller = new AdminInvitationCreationController({
      status: 'succeeded',
      receipt: pendingReceipt,
      error: null,
      submissionCount: 1,
    });

    const snap = await controller.revoke({
      currentUser: ACTIVE_OWNER,
      activeTabId: 'users',
      confirmed: true,
      clientDeps,
    });

    expect(snap.revocationStatus).toBe('revoked');
    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload).toEqual({
      action: 'revokeInvitation',
      invitationId: 'inv_canonical_revoke_55',
      expectedRevision: 1,
    });
    expect(Object.keys(capturedPayload!).sort()).toEqual([
      'action',
      'expectedRevision',
      'invitationId',
    ]);
  });

  it('6. Supplies the exact expectedRevision from the server Pending receipt', async () => {
    const pendingReceipt = buildPendingInvitationReceipt({
      invitationId: 'inv_revision_check_06',
      revision: 3,
    });

    const invokeRevokeSpy = vi.fn(async (input) => {
      expect(input).toEqual({
        invitationId: 'inv_revision_check_06',
        expectedRevision: 3,
      });
      return buildRevokedInvitationResponse({
        invitationId: 'inv_revision_check_06',
        revision: 4,
      });
    });

    const controller = new AdminInvitationCreationController({
      status: 'succeeded',
      receipt: pendingReceipt,
      error: null,
      submissionCount: 1,
    });

    const snap = await controller.revoke({
      currentUser: ACTIVE_OWNER,
      activeTabId: 'users',
      confirmed: true,
      invokeRevokeInvitation: invokeRevokeSpy,
    });

    expect(invokeRevokeSpy).toHaveBeenCalledTimes(1);
    expect(snap.revocationStatus).toBe('revoked');
    expect(snap.receipt?.invitation.revision).toBe(4);
  });

  it('7. Prevents duplicate revocation requests while a revocation is in-flight', async () => {
    const pendingReceipt = buildPendingInvitationReceipt();

    let resolveInFlight!: (value: RevokeAdminInvitationClientResponse) => void;
    const inFlightPromise = new Promise<RevokeAdminInvitationClientResponse>(
      (resolve) => {
        resolveInFlight = resolve;
      }
    );

    const invokeRevokeSpy = vi.fn(() => inFlightPromise);
    const controller = new AdminInvitationCreationController({
      status: 'succeeded',
      receipt: pendingReceipt,
      error: null,
      submissionCount: 1,
    });

    const firstRevokeTask = controller.revoke({
      currentUser: ACTIVE_OWNER,
      activeTabId: 'users',
      confirmed: true,
      invokeRevokeInvitation: invokeRevokeSpy,
    });

    expect(controller.getSnapshot().revocationStatus).toBe('revoking');

    // Attempt second revocation while first is still pending
    const duplicateSnap = await controller.revoke({
      currentUser: ACTIVE_OWNER,
      activeTabId: 'users',
      confirmed: true,
      invokeRevokeInvitation: invokeRevokeSpy,
    });

    expect(duplicateSnap.revocationStatus).toBe('revoking');
    expect(invokeRevokeSpy).toHaveBeenCalledTimes(1);

    resolveInFlight(buildRevokedInvitationResponse());
    const finalSnap = await firstRevokeTask;
    expect(finalSnap.revocationStatus).toBe('revoked');
    expect(invokeRevokeSpy).toHaveBeenCalledTimes(1);
  });

  it('8. Successful server response updates receipt status to Revoked, preserves invitationId and audit reference, and disables further revocation', async () => {
    const pendingReceipt = buildPendingInvitationReceipt({
      invitationId: 'inv_revoked_success_08',
      normalizedTargetEmail: 'revoked.curator@promiseofplanet.org',
      intendedRole: AdminRole.LibraryCurator,
      revision: 1,
    });

    const revokedResponse = buildRevokedInvitationResponse({
      invitationId: 'inv_revoked_success_08',
      normalizedTargetEmail: 'revoked.curator@promiseofplanet.org',
      intendedRole: AdminRole.LibraryCurator,
      revokedAtIso: '2026-10-26T11:45:00.000Z',
      revokedByOwnerUid: ACTIVE_OWNER.id,
      revision: 2,
      auditEventId: 'audit_revoke_889900',
    });

    const controller = new AdminInvitationCreationController({
      status: 'succeeded',
      receipt: pendingReceipt,
      error: null,
      submissionCount: 1,
    });

    const snap = await controller.revoke({
      currentUser: ACTIVE_OWNER,
      activeTabId: 'users',
      confirmed: true,
      invokeRevokeInvitation: async () => revokedResponse,
    });

    expect(snap.revocationStatus).toBe('revoked');
    expect(snap.receipt?.invitation.status).toBe(AdminInvitationStatus.Revoked);
    expect(snap.receipt?.invitation.invitationId).toBe('inv_revoked_success_08');
    expect(snap.receipt?.auditEventId).toBe('audit_revoke_889900');

    const htmlAr = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialSubmissionState={snap}
      />
    );

    expect(htmlAr).toContain('data-invitation-status="Revoked"');
    expect(htmlAr).toContain('الحالة: ملغاة (Revoked)');
    expect(htmlAr).toContain('inv_revoked_success_08');
    expect(htmlAr).toContain('audit_revoke_889900 (rev 2)');
    expect(htmlAr).toContain('2026-10-26T11:45:00.000Z');
    // Revoke action and confirmation box are no longer rendered on a Revoked receipt
    expect(htmlAr).not.toContain('data-testid="request-revoke-invitation-btn"');
    expect(htmlAr).not.toContain('data-testid="confirm-revoke-invitation-btn"');
    expect(htmlAr).not.toContain(
      'data-testid="revoke-invitation-confirmation-box"'
    );

    // Attempting to revoke again on the controller is rejected without calling the server
    const secondRevokeSpy = vi.fn();
    const secondSnap = await controller.revoke({
      currentUser: ACTIVE_OWNER,
      activeTabId: 'users',
      confirmed: true,
      invokeRevokeInvitation: secondRevokeSpy,
    });
    expect(secondSnap.revocationStatus).toBe('error');
    expect(secondSnap.revocationError?.category).toBe('already-revoked');
    expect(secondSnap.receipt?.invitation.status).toBe(
      AdminInvitationStatus.Revoked
    );
    expect(secondRevokeSpy).not.toHaveBeenCalled();
  });

  it('9. Server failures (concurrency conflict, unavailable, internal, or malformed response) do NOT fabricate Revoked status and preserve the Pending receipt', async () => {
    const pendingReceipt = buildPendingInvitationReceipt({
      invitationId: 'inv_preserve_pending_09',
      revision: 1,
    });

    const failureCases: Array<{
      readonly errorObj: Record<string, unknown>;
      readonly expectedCategory: string;
    }> = [
      {
        errorObj: {
          code: 'functions/failed-precondition',
          reason: 'CONCURRENT_MODIFICATION_CONFLICT',
          message: 'CONCURRENT_MODIFICATION_CONFLICT',
        },
        expectedCategory: 'concurrency-conflict',
      },
      {
        errorObj: {
          code: 'functions/unavailable',
          message: 'Service temporarily unavailable',
        },
        expectedCategory: 'unavailable',
      },
      {
        errorObj: {
          code: 'functions/internal',
          message: 'Internal transaction failure',
        },
        expectedCategory: 'server-failure',
      },
    ];

    for (const item of failureCases) {
      const controller = new AdminInvitationCreationController({
        status: 'succeeded',
        receipt: pendingReceipt,
        error: null,
        submissionCount: 1,
      });

      const snap = await controller.revoke({
        currentUser: ACTIVE_OWNER,
        activeTabId: 'users',
        confirmed: true,
        invokeRevokeInvitation: async () => {
          throw item.errorObj;
        },
      });

      expect(snap.revocationStatus).toBe('error');
      expect(snap.revocationError?.category).toBe(item.expectedCategory);
      // Authoritative previous Pending receipt is preserved intact
      expect(snap.receipt).toEqual(pendingReceipt);
      expect(snap.receipt?.invitation.status).toBe(
        AdminInvitationStatus.Pending
      );

      const html = renderToStaticMarkup(
        <AdminInvitationCreationPanel
          currentUser={ACTIVE_OWNER}
          activeTabId="users"
          initialSubmissionState={snap}
        />
      );
      expect(html).toContain(
        'data-testid="admin-invitation-revocation-error-banner"'
      );
      expect(html).toContain(
        `data-error-category="${item.expectedCategory}"`
      );
      expect(html).toContain('data-invitation-status="Pending"');
      expect(html).toContain('inv_preserve_pending_09');
    }

    // Malformed server response (e.g. mismatched revision) also fails closed and preserves Pending receipt
    const malformedController = new AdminInvitationCreationController({
      status: 'succeeded',
      receipt: pendingReceipt,
      error: null,
      submissionCount: 1,
    });
    const malformedSnap = await malformedController.revoke({
      currentUser: ACTIVE_OWNER,
      activeTabId: 'users',
      confirmed: true,
      invokeRevokeInvitation: async () =>
        buildRevokedInvitationResponse({
          invitationId: 'inv_preserve_pending_09',
          revision: 99, // Does not match expectedRevision (1) + 1
        }),
    });
    expect(malformedSnap.revocationStatus).toBe('error');
    expect(malformedSnap.revocationError?.category).toBe('server-failure');
    expect(malformedSnap.receipt).toEqual(pendingReceipt);
  });

  it('10. Already accepted invitation is not locally revoked and surfaces accurate bilingual error', async () => {
    const pendingReceipt = buildPendingInvitationReceipt({
      invitationId: 'inv_already_accepted_10',
    });

    const controller = new AdminInvitationCreationController({
      status: 'succeeded',
      receipt: pendingReceipt,
      error: null,
      submissionCount: 1,
    });

    const snap = await controller.revoke({
      currentUser: ACTIVE_OWNER,
      activeTabId: 'users',
      confirmed: true,
      invokeRevokeInvitation: async () => {
        throw {
          code: 'failed-precondition',
          reason: 'INVITATION_ALREADY_ACCEPTED',
          message: 'INVITATION_ALREADY_ACCEPTED',
        };
      },
    });

    expect(snap.revocationStatus).toBe('error');
    expect(snap.revocationError?.category).toBe('already-accepted');
    expect(snap.receipt?.invitation.status).toBe(AdminInvitationStatus.Pending);

    const htmlAr = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialSubmissionState={snap}
      />
    );
    expect(htmlAr).toContain('data-error-category="already-accepted"');
    expect(htmlAr).toContain('تم قبول هذه الدعوة مسبقاً ولا يمكن إلغاؤها');
    expect(htmlAr).not.toContain('data-invitation-status="Revoked"');

    await i18n.changeLanguage('en');
    const htmlEn = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialSubmissionState={snap}
      />
    );
    expect(htmlEn).toContain(
      'This invitation has already been accepted and cannot be revoked.'
    );
  });

  it('11. Expired invitation is handled safely without fabricating Revoked status', async () => {
    const pendingReceipt = buildPendingInvitationReceipt({
      invitationId: 'inv_expired_11',
    });

    const controller = new AdminInvitationCreationController({
      status: 'succeeded',
      receipt: pendingReceipt,
      error: null,
      submissionCount: 1,
    });

    const snap = await controller.revoke({
      currentUser: ACTIVE_OWNER,
      activeTabId: 'users',
      confirmed: true,
      invokeRevokeInvitation: async () => {
        throw {
          code: 'failed-precondition',
          reason: 'INVITATION_EXPIRED',
          message: 'INVITATION_EXPIRED',
        };
      },
    });

    expect(snap.revocationStatus).toBe('error');
    expect(snap.revocationError?.category).toBe('expired-invitation');
    expect(snap.receipt?.invitation.status).toBe(AdminInvitationStatus.Pending);

    const htmlAr = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialSubmissionState={snap}
      />
    );
    expect(htmlAr).toContain('data-error-category="expired-invitation"');
    expect(htmlAr).toContain('انتهت صلاحية هذه الدعوة الإدارية بالفعل في الخادم');
    expect(htmlAr).not.toContain('data-invitation-status="Revoked"');
  });

  it('12. No direct Firestore write or admins/{uid} mutation exists in AdminInvitationCreationPanel', () => {
    const panelSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'src/components/users/AdminInvitationCreationPanel.tsx'
      ),
      'utf8'
    );

    const forbiddenPatterns = [
      'setDoc',
      'updateDoc',
      'deleteDoc',
      'addDoc',
      'writeBatch',
      'runTransaction',
      "doc(db, 'admins'",
      'doc(db, "admins"',
      "doc(db, 'admin_invitations'",
      'doc(db, "admin_invitations"',
    ];

    for (const pattern of forbiddenPatterns) {
      expect(panelSource).not.toContain(pattern);
    }

    expect(typeof revokeAdminInvitation).toBe('function');
    expect(
      classifyInvitationRevocationFailure(new Error('unexpected')).category
    ).toBe('server-failure');
  });

  it('13. No email delivery or external notification is claimed upon revocation', async () => {
    const revokedResponse = buildRevokedInvitationResponse();

    const htmlAr = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialSubmissionState={{
          status: 'succeeded',
          receipt: revokedResponse,
          error: null,
          submissionCount: 1,
          revocationStatus: 'revoked',
          revocationError: null,
          revocationCount: 1,
        }}
      />
    );

    expect(htmlAr).toContain('data-testid="receipt-revoked-confirmation"');
    expect(htmlAr).toContain(INVITATION_REVOKED_NO_EMAIL_NOTICE_AR);
    expect(htmlAr).not.toContain('تم إرسال البريد');
    expect(htmlAr).not.toContain('https://');
    expect(htmlAr).not.toContain('href=');

    await i18n.changeLanguage('en');
    const htmlEn = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialSubmissionState={{
          status: 'succeeded',
          receipt: revokedResponse,
          error: null,
          submissionCount: 1,
          revocationStatus: 'revoked',
          revocationError: null,
          revocationCount: 1,
        }}
      />
    );

    expect(htmlEn).toContain('data-testid="receipt-revoked-confirmation"');
    expect(htmlEn).toContain(INVITATION_REVOKED_NO_EMAIL_NOTICE_EN);
    expect(htmlEn).not.toContain('https://');
    expect(htmlEn).not.toContain('href=');
  });

  it('14. RTL/LTR direction and mobile-friendly responsive layout classes are rendered for confirmation and revocation states', async () => {
    const pendingReceipt = buildPendingInvitationReceipt();

    await i18n.changeLanguage('ar');
    const htmlAr = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialConfirmingRevocation={true}
        initialSubmissionState={{
          status: 'succeeded',
          receipt: pendingReceipt,
          error: null,
          submissionCount: 1,
        }}
      />
    );

    expect(htmlAr).toContain('dir="rtl"');
    expect(htmlAr).toContain('flex-col sm:flex-row');
    expect(htmlAr).toContain('w-full sm:w-auto');

    await i18n.changeLanguage('en');
    const htmlEn = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={ACTIVE_OWNER}
        activeTabId="users"
        initialConfirmingRevocation={true}
        initialSubmissionState={{
          status: 'succeeded',
          receipt: pendingReceipt,
          error: null,
          submissionCount: 1,
        }}
      />
    );

    expect(htmlEn).toContain('dir="ltr"');
    expect(htmlEn).toContain(CONFIRM_REVOKE_INVITATION_ACTION_EN);
    expect(htmlEn).toContain(CANCEL_REVOKE_INVITATION_ACTION_EN);
  });

  it('15. Existing Pending invitation creation and reset flows remain unchanged', async () => {
    const controller = new AdminInvitationCreationController();

    const createdSnap = await controller.submit({
      currentUser: ACTIVE_OWNER,
      activeTabId: 'users',
      targetEmail: 'new.reviewer@promiseofplanet.org',
      intendedRole: AdminRole.RightsReviewer,
      ttlMs: DEFAULT_ADMIN_INVITATION_TTL_MS,
      invokeCreateInvitation: async (input) =>
        buildPendingInvitationReceipt({
          invitationId: 'inv_create_then_revoke_15',
          normalizedTargetEmail: input.targetEmail,
          intendedRole: input.intendedRole,
          revision: 1,
        }),
    });

    expect(createdSnap.status).toBe('succeeded');
    expect(createdSnap.receipt?.invitation.status).toBe(
      AdminInvitationStatus.Pending
    );
    expect(createdSnap.revocationStatus).toBe('idle');

    const revokedSnap = await controller.revoke({
      currentUser: ACTIVE_OWNER,
      activeTabId: 'users',
      confirmed: true,
      invokeRevokeInvitation: async (input) =>
        buildRevokedInvitationResponse({
          invitationId: input.invitationId,
          normalizedTargetEmail: 'new.reviewer@promiseofplanet.org',
          intendedRole: AdminRole.RightsReviewer,
          revision: (input.expectedRevision ?? 1) + 1,
        }),
    });

    expect(revokedSnap.revocationStatus).toBe('revoked');
    expect(revokedSnap.receipt?.invitation.status).toBe(
      AdminInvitationStatus.Revoked
    );

    controller.reset();
    const resetSnap = controller.getSnapshot();
    expect(resetSnap.status).toBe('idle');
    expect(resetSnap.receipt).toBeNull();
    expect(resetSnap.revocationStatus).toBe('idle');
    expect(resetSnap.revocationError).toBeNull();
  });
});
