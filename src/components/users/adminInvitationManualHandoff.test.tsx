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
  type AdminUser,
} from '../../types/admin';
import { AdminAccessService } from '../../services/adminAccess';
import {
  AdminInvitationStatus,
  type CreateAdminInvitationClientResponse,
  type RevokeAdminInvitationClientResponse,
} from '../../services/adminIdentityManagementClient';
import {
  AdminInvitationCreationPanel,
  AdminInvitationCreationController,
  INVITABLE_ADMIN_ROLES,
  COPY_INVITATION_ID_ACTION_AR,
  COPY_INVITATION_ID_ACTION_EN,
  MANUAL_HANDOFF_TRANSPARENCY_NOTICE_AR,
  MANUAL_HANDOFF_TRANSPARENCY_NOTICE_EN,
  COPY_INVITATION_ID_SUCCESS_AR,
  COPY_INVITATION_ID_SUCCESS_EN,
  COPY_INVITATION_ID_FAILURE_AR,
  COPY_INVITATION_ID_FAILURE_EN,
  REVOKED_INVITATION_CANNOT_BE_ACCEPTED_AR,
  REVOKED_INVITATION_CANNOT_BE_ACCEPTED_EN,
  isAuthorizedToHandoffAdminInvitation,
  isDeliverablePendingInvitationReceipt,
  normalizeAndValidateInvitationId,
} from './AdminInvitationCreationPanel';
import { validateClientInvitationLocatorId } from '../auth/AdminInvitationAcceptancePanel';

function createAdminActor(
  role: AdminRole,
  overrides: Partial<AdminUser> = {}
): AdminUser {
  const permissions =
    role === AdminRole.Owner
      ? Object.values(AdminPermission)
      : Array.from(AdminAccessService.getPermissionsForRole(role));

  return {
    id: overrides.id ?? `uid-${role}`,
    name: overrides.name ?? `Admin ${role}`,
    email: overrides.email ?? `${role}@promiseofplanet.org`,
    role,
    permissions: overrides.permissions ?? permissions,
    isActive: overrides.isActive ?? true,
    createdAt: overrides.createdAt ?? '2026-03-01T00:00:00.000Z',
    lastLogin: overrides.lastLogin,
  };
}

function createPendingInvitationReceipt(
  overrides: Partial<CreateAdminInvitationClientResponse['invitation']> = {}
): CreateAdminInvitationClientResponse {
  return {
    invitation: {
      invitationId: overrides.invitationId ?? 'inv_handoff_pending_2026_01',
      normalizedTargetEmail:
        overrides.normalizedTargetEmail ?? 'candidate@promiseofplanet.org',
      intendedRole: overrides.intendedRole ?? AdminRole.ContentEditor,
      status: overrides.status ?? AdminInvitationStatus.Pending,
      invitingOwnerUid: overrides.invitingOwnerUid ?? 'uid-owner',
      createdAtIso: overrides.createdAtIso ?? '2026-04-01T10:00:00.000Z',
      expiresAtIso: overrides.expiresAtIso ?? '2026-04-08T10:00:00.000Z',
      acceptedAtIso: null,
      acceptedByUid: null,
      revokedAtIso: null,
      revokedByOwnerUid: null,
      expiredAtIso: null,
      revision: overrides.revision ?? 1,
    },
    auditEventId: 'audit_handoff_create_2026_01',
  };
}

function createRevokedInvitationReceipt(
  overrides: Partial<RevokeAdminInvitationClientResponse['invitation']> = {}
): RevokeAdminInvitationClientResponse {
  return {
    invitation: {
      invitationId: overrides.invitationId ?? 'inv_handoff_pending_2026_01',
      normalizedTargetEmail:
        overrides.normalizedTargetEmail ?? 'candidate@promiseofplanet.org',
      intendedRole: overrides.intendedRole ?? AdminRole.ContentEditor,
      status: AdminInvitationStatus.Revoked,
      invitingOwnerUid: overrides.invitingOwnerUid ?? 'uid-owner',
      createdAtIso: overrides.createdAtIso ?? '2026-04-01T10:00:00.000Z',
      expiresAtIso: overrides.expiresAtIso ?? '2026-04-08T10:00:00.000Z',
      acceptedAtIso: null,
      acceptedByUid: null,
      revokedAtIso: overrides.revokedAtIso ?? '2026-04-01T11:30:00.000Z',
      revokedByOwnerUid: overrides.revokedByOwnerUid ?? 'uid-owner',
      expiredAtIso: null,
      revision: overrides.revision ?? 2,
    },
    auditEventId: 'audit_handoff_revoke_2026_01',
  };
}

describe('AUTH-03C6: Controlled Manual Invitation Handoff', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('ar');
  });

  it('1. Active Owner sees the copy handoff action on a server-confirmed Pending receipt', async () => {
    const activeOwner = createAdminActor(AdminRole.Owner, { isActive: true });
    const pendingReceipt = createPendingInvitationReceipt();

    expect(isAuthorizedToHandoffAdminInvitation(activeOwner, 'users')).toBe(
      true
    );
    expect(isDeliverablePendingInvitationReceipt(pendingReceipt)).toBe(true);

    await i18n.changeLanguage('ar');
    const htmlAr = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={activeOwner}
        activeTabId="users"
        initialSubmissionState={{
          status: 'succeeded',
          receipt: pendingReceipt,
          error: null,
          submissionCount: 1,
          revocationStatus: 'idle',
          revocationError: null,
          revocationCount: 0,
        }}
      />
    );

    expect(htmlAr).toContain('data-testid="copy-invitation-id-btn"');
    expect(htmlAr).toContain(COPY_INVITATION_ID_ACTION_AR);
    expect(htmlAr).toContain(pendingReceipt.invitation.invitationId);
    expect(htmlAr).not.toContain('data-testid="copy-invitation-id-btn" disabled');

    await i18n.changeLanguage('en');
    const htmlEn = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={activeOwner}
        activeTabId="users"
        initialSubmissionState={{
          status: 'succeeded',
          receipt: pendingReceipt,
          error: null,
          submissionCount: 1,
          revocationStatus: 'idle',
          revocationError: null,
          revocationCount: 0,
        }}
      />
    );

    expect(htmlEn).toContain('data-testid="copy-invitation-id-btn"');
    expect(htmlEn).toContain(COPY_INVITATION_ID_ACTION_EN);
  });

  it('2. Inactive Owner sees no invitation creation or handoff UI', () => {
    const inactiveOwner = createAdminActor(AdminRole.Owner, {
      isActive: false,
    });
    const pendingReceipt = createPendingInvitationReceipt();

    expect(isAuthorizedToHandoffAdminInvitation(inactiveOwner, 'users')).toBe(
      false
    );

    const html = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={inactiveOwner}
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
    expect(html).not.toContain('data-testid="copy-invitation-id-btn"');
    expect(html).not.toContain('data-testid="receipt-manual-handoff-notice"');
  });

  it('3. Non-Owner canonical roles see no invitation creation or handoff UI', () => {
    const pendingReceipt = createPendingInvitationReceipt();

    for (const role of INVITABLE_ADMIN_ROLES) {
      const nonOwner = createAdminActor(role, { isActive: true });
      expect(isAuthorizedToHandoffAdminInvitation(nonOwner, 'users')).toBe(
        false
      );

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
      expect(html).not.toContain('data-testid="copy-invitation-id-btn"');
    }
  });

  it('4. No handoff UI is shown before a receipt exists', () => {
    const activeOwner = createAdminActor(AdminRole.Owner, { isActive: true });

    const html = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={activeOwner}
        activeTabId="users"
      />
    );

    expect(html).toContain('data-testid="admin-invitation-creation-form"');
    expect(html).not.toContain('data-testid="admin-invitation-pending-receipt"');
    expect(html).not.toContain('data-testid="copy-invitation-id-btn"');
    expect(html).not.toContain('data-testid="receipt-manual-handoff-notice"');
    expect(html).not.toContain('data-testid="invitation-copy-feedback-banner"');
  });

  it('5. No handoff UI is shown while creation or revocation is in-flight', async () => {
    const activeOwner = createAdminActor(AdminRole.Owner, { isActive: true });
    const pendingReceipt = createPendingInvitationReceipt();

    // Case A: Creation in-flight
    const htmlSubmitting = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={activeOwner}
        activeTabId="users"
        initialSubmissionState={{
          status: 'submitting',
          receipt: null,
          error: null,
          submissionCount: 1,
        }}
      />
    );

    expect(htmlSubmitting).not.toContain('data-testid="copy-invitation-id-btn"');
    expect(htmlSubmitting).not.toContain(
      'data-testid="receipt-manual-handoff-notice"'
    );

    // Case B: Revocation in-flight — handoff controls are not rendered and controller ignores copy calls
    const htmlRevoking = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={activeOwner}
        activeTabId="users"
        initialSubmissionState={{
          status: 'succeeded',
          receipt: pendingReceipt,
          error: null,
          submissionCount: 1,
          revocationStatus: 'revoking',
          revocationError: null,
          revocationCount: 1,
        }}
      />
    );

    expect(htmlRevoking).not.toContain('data-testid="copy-invitation-id-btn"');
    expect(htmlRevoking).not.toContain(
      'data-testid="receipt-manual-handoff-notice"'
    );

    const writeClipboardMock = vi.fn().mockResolvedValue(undefined);
    const controller = new AdminInvitationCreationController({
      status: 'succeeded',
      receipt: pendingReceipt,
      error: null,
      submissionCount: 1,
      revocationStatus: 'revoking',
    });

    await controller.copyInvitationId({
      currentUser: activeOwner,
      activeTabId: 'users',
      writeClipboardText: writeClipboardMock,
    });

    expect(writeClipboardMock).not.toHaveBeenCalled();
    expect(controller.getSnapshot().copyStatus).toBe('idle');
  });

  it('6. Clicking Copy Invitation ID copies ONLY the raw canonical invitationId', async () => {
    const activeOwner = createAdminActor(AdminRole.Owner, { isActive: true });
    const canonicalId = 'inv_canonical_raw_id_987654321';
    const pendingReceipt = createPendingInvitationReceipt({
      invitationId: canonicalId,
    });
    const writeClipboardMock = vi.fn().mockResolvedValue(undefined);

    const controller = new AdminInvitationCreationController({
      status: 'succeeded',
      receipt: pendingReceipt,
      error: null,
      submissionCount: 1,
    });

    const snapshot = await controller.copyInvitationId({
      currentUser: activeOwner,
      activeTabId: 'users',
      writeClipboardText: writeClipboardMock,
    });

    expect(writeClipboardMock).toHaveBeenCalledTimes(1);
    expect(writeClipboardMock).toHaveBeenCalledWith(canonicalId);
    expect(snapshot.copyStatus).toBe('copied');
    expect(snapshot.lastCopiedInvitationId).toBe(canonicalId);
  });

  it('7. Copy does not copy a URL, token, JSON payload, or formatted sentence', async () => {
    const activeOwner = createAdminActor(AdminRole.Owner, { isActive: true });
    const canonicalId = 'inv_strict_locator_2026_abc';
    const pendingReceipt = createPendingInvitationReceipt({
      invitationId: canonicalId,
    });

    let copiedPayload = '';
    const writeClipboardMock = vi.fn(async (text: string) => {
      copiedPayload = text;
    });

    const controller = new AdminInvitationCreationController({
      status: 'succeeded',
      receipt: pendingReceipt,
      error: null,
      submissionCount: 1,
    });

    await controller.copyInvitationId({
      currentUser: activeOwner,
      activeTabId: 'users',
      writeClipboardText: writeClipboardMock,
    });

    expect(copiedPayload).toBe(canonicalId);
    expect(copiedPayload).not.toContain('http://');
    expect(copiedPayload).not.toContain('https://');
    expect(copiedPayload).not.toContain('?invitationId=');
    expect(copiedPayload).not.toContain('{');
    expect(copiedPayload).not.toContain('}');
    expect(copiedPayload).not.toContain(' ');
    expect(copiedPayload).not.toContain(':');
  });

  it('8. Successful copy displays bilingual copy feedback and does NOT claim email delivery or acceptance', async () => {
    const activeOwner = createAdminActor(AdminRole.Owner, { isActive: true });
    const pendingReceipt = createPendingInvitationReceipt();

    await i18n.changeLanguage('ar');
    const htmlAr = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={activeOwner}
        activeTabId="users"
        initialSubmissionState={{
          status: 'succeeded',
          receipt: pendingReceipt,
          error: null,
          submissionCount: 1,
          copyStatus: 'copied',
          lastCopiedInvitationId: pendingReceipt.invitation.invitationId,
        }}
      />
    );

    expect(htmlAr).toContain('data-testid="invitation-copy-feedback-banner"');
    expect(htmlAr).toContain('data-copy-status="copied"');
    expect(htmlAr).toContain(COPY_INVITATION_ID_SUCCESS_AR);
    expect(htmlAr).not.toContain('تم إرسال الدعوة');
    expect(htmlAr).not.toContain('تم إرسال البريد');

    await i18n.changeLanguage('en');
    const htmlEn = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={activeOwner}
        activeTabId="users"
        initialSubmissionState={{
          status: 'succeeded',
          receipt: pendingReceipt,
          error: null,
          submissionCount: 1,
          copyStatus: 'copied',
          lastCopiedInvitationId: pendingReceipt.invitation.invitationId,
        }}
      />
    );

    expect(htmlEn).toContain('data-testid="invitation-copy-feedback-banner"');
    expect(htmlEn).toContain('data-copy-status="copied"');
    expect(htmlEn).toContain(COPY_INVITATION_ID_SUCCESS_EN);
    expect(htmlEn).not.toContain('Invitation sent');
    expect(htmlEn).not.toContain('Email sent');
  });

  it('9. Clipboard API unavailable or rejected is handled gracefully and keeps the raw invitationId visible for manual copying', async () => {
    const activeOwner = createAdminActor(AdminRole.Owner, { isActive: true });
    const pendingReceipt = createPendingInvitationReceipt({
      invitationId: 'inv_manual_fallback_2026_99',
    });

    const rejectingClipboard = vi
      .fn()
      .mockRejectedValue(new Error('Clipboard write permission denied'));

    const controller = new AdminInvitationCreationController({
      status: 'succeeded',
      receipt: pendingReceipt,
      error: null,
      submissionCount: 1,
    });

    const snapshot = await controller.copyInvitationId({
      currentUser: activeOwner,
      activeTabId: 'users',
      writeClipboardText: rejectingClipboard,
    });

    expect(snapshot.copyStatus).toBe('copy-failed');
    expect(snapshot.lastCopiedInvitationId).toBeNull();
    // Authoritative receipt remains intact
    expect(snapshot.receipt).toEqual(pendingReceipt);

    await i18n.changeLanguage('ar');
    const htmlAr = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={activeOwner}
        activeTabId="users"
        initialSubmissionState={snapshot}
      />
    );

    expect(htmlAr).toContain('data-testid="invitation-copy-feedback-banner"');
    expect(htmlAr).toContain('data-copy-status="copy-failed"');
    expect(htmlAr).toContain(COPY_INVITATION_ID_FAILURE_AR);
    expect(htmlAr).toContain('inv_manual_fallback_2026_99');

    await i18n.changeLanguage('en');
    const htmlEn = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={activeOwner}
        activeTabId="users"
        initialSubmissionState={snapshot}
      />
    );

    expect(htmlEn).toContain(COPY_INVITATION_ID_FAILURE_EN);
    expect(htmlEn).toContain('inv_manual_fallback_2026_99');
  });

  it('10. Copy does not call createAdminInvitation, revokeAdminInvitation, acceptAdminInvitation, or listAdminUsers', async () => {
    const activeOwner = createAdminActor(AdminRole.Owner, { isActive: true });
    const pendingReceipt = createPendingInvitationReceipt();

    const invokeCreateSpy = vi.fn();
    const invokeRevokeSpy = vi.fn();
    const httpsCallableSpy = vi.fn();
    const writeClipboardMock = vi.fn().mockResolvedValue(undefined);

    const controller = new AdminInvitationCreationController({
      status: 'succeeded',
      receipt: pendingReceipt,
      error: null,
      submissionCount: 1,
    });

    const beforeSnapshot = controller.getSnapshot();

    const afterSnapshot = await controller.copyInvitationId({
      currentUser: activeOwner,
      activeTabId: 'users',
      writeClipboardText: writeClipboardMock,
    });

    expect(invokeCreateSpy).not.toHaveBeenCalled();
    expect(invokeRevokeSpy).not.toHaveBeenCalled();
    expect(httpsCallableSpy).not.toHaveBeenCalled();
    expect(afterSnapshot.status).toBe(beforeSnapshot.status);
    expect(afterSnapshot.receipt).toBe(beforeSnapshot.receipt);
    expect(afterSnapshot.submissionCount).toBe(beforeSnapshot.submissionCount);
    expect(afterSnapshot.revocationStatus).toBe(beforeSnapshot.revocationStatus);
    expect(afterSnapshot.revocationCount).toBe(beforeSnapshot.revocationCount);
  });

  it('11. Revoking the invitation disables or hides the copy handoff action and displays that revoked invitations cannot be accepted', async () => {
    const activeOwner = createAdminActor(AdminRole.Owner, { isActive: true });
    const pendingReceipt = createPendingInvitationReceipt();
    const revokedReceipt = createRevokedInvitationReceipt();

    const writeClipboardMock = vi.fn().mockResolvedValue(undefined);
    const invokeRevokeMock = vi.fn().mockResolvedValue(revokedReceipt);

    const controller = new AdminInvitationCreationController({
      status: 'succeeded',
      receipt: pendingReceipt,
      error: null,
      submissionCount: 1,
    });

    // First copy succeeds while Pending
    await controller.copyInvitationId({
      currentUser: activeOwner,
      activeTabId: 'users',
      writeClipboardText: writeClipboardMock,
    });
    expect(controller.getSnapshot().copyStatus).toBe('copied');

    // Now revoke the invitation
    const revokedSnapshot = await controller.revoke({
      currentUser: activeOwner,
      activeTabId: 'users',
      confirmed: true,
      invokeRevokeInvitation: invokeRevokeMock,
    });

    expect(revokedSnapshot.receipt?.invitation.status).toBe(
      AdminInvitationStatus.Revoked
    );
    expect(revokedSnapshot.copyStatus).toBe('idle');
    expect(revokedSnapshot.lastCopiedInvitationId).toBeNull();

    // Attempting to copy after revocation is blocked fail-closed
    writeClipboardMock.mockClear();
    const afterRevokeCopyAttempt = await controller.copyInvitationId({
      currentUser: activeOwner,
      activeTabId: 'users',
      writeClipboardText: writeClipboardMock,
    });
    expect(writeClipboardMock).not.toHaveBeenCalled();
    expect(afterRevokeCopyAttempt.copyStatus).toBe('copy-failed');

    await i18n.changeLanguage('ar');
    const htmlAr = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={activeOwner}
        activeTabId="users"
        initialSubmissionState={revokedSnapshot}
      />
    );

    expect(htmlAr).not.toContain('data-testid="copy-invitation-id-btn"');
    expect(htmlAr).not.toContain(
      'data-testid="invitation-copy-feedback-banner"'
    );
    expect(htmlAr).toContain(
      'data-testid="receipt-revoked-cannot-accept-notice"'
    );
    expect(htmlAr).toContain(REVOKED_INVITATION_CANNOT_BE_ACCEPTED_AR);
    expect(htmlAr).not.toContain('data-testid="receipt-manual-handoff-notice"');

    await i18n.changeLanguage('en');
    const htmlEn = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={activeOwner}
        activeTabId="users"
        initialSubmissionState={revokedSnapshot}
      />
    );

    expect(htmlEn).toContain(REVOKED_INVITATION_CANNOT_BE_ACCEPTED_EN);
  });

  it('12. Malformed receipt (Owner role, empty invitationId, invalid status, or missing fields) does not enable deliverable handoff', async () => {
    const activeOwner = createAdminActor(AdminRole.Owner, { isActive: true });
    const writeClipboardMock = vi.fn().mockResolvedValue(undefined);

    const malformedOwnerRoleReceipt = createPendingInvitationReceipt({
      intendedRole: AdminRole.Owner,
    });
    const malformedEmptyIdReceipt = createPendingInvitationReceipt({
      invitationId: '   ',
    });
    const malformedShortIdReceipt = createPendingInvitationReceipt({
      invitationId: 'short',
    });
    const malformedEmailReceipt = createPendingInvitationReceipt({
      normalizedTargetEmail: 'not-an-email',
    });

    expect(isDeliverablePendingInvitationReceipt(malformedOwnerRoleReceipt)).toBe(
      false
    );
    expect(isDeliverablePendingInvitationReceipt(malformedEmptyIdReceipt)).toBe(
      false
    );
    expect(isDeliverablePendingInvitationReceipt(malformedShortIdReceipt)).toBe(
      false
    );
    expect(isDeliverablePendingInvitationReceipt(malformedEmailReceipt)).toBe(
      false
    );
    expect(isDeliverablePendingInvitationReceipt(null)).toBe(false);

    for (const badReceipt of [
      malformedOwnerRoleReceipt,
      malformedEmptyIdReceipt,
      malformedShortIdReceipt,
      malformedEmailReceipt,
    ]) {
      const controller = new AdminInvitationCreationController({
        status: 'succeeded',
        receipt: badReceipt,
        error: null,
        submissionCount: 1,
      });

      const snap = await controller.copyInvitationId({
        currentUser: activeOwner,
        activeTabId: 'users',
        writeClipboardText: writeClipboardMock,
      });

      expect(writeClipboardMock).not.toHaveBeenCalled();
      expect(snap.copyStatus).toBe('copy-failed');

      const html = renderToStaticMarkup(
        <AdminInvitationCreationPanel
          currentUser={activeOwner}
          activeTabId="users"
          initialSubmissionState={{
            status: 'succeeded',
            receipt: badReceipt,
            error: null,
            submissionCount: 1,
          }}
        />
      );

      expect(html).not.toContain('data-testid="copy-invitation-id-btn"');
      expect(html).not.toContain('data-testid="receipt-manual-handoff-notice"');
    }
  });

  it('13. Pending receipt displays the required manual handoff transparency notice in Arabic and English', async () => {
    const activeOwner = createAdminActor(AdminRole.Owner, { isActive: true });
    const pendingReceipt = createPendingInvitationReceipt();

    await i18n.changeLanguage('ar');
    const htmlAr = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={activeOwner}
        activeTabId="users"
        initialSubmissionState={{
          status: 'succeeded',
          receipt: pendingReceipt,
          error: null,
          submissionCount: 1,
        }}
      />
    );

    expect(htmlAr).toContain('data-testid="receipt-manual-handoff-notice"');
    expect(htmlAr).toContain(MANUAL_HANDOFF_TRANSPARENCY_NOTICE_AR);

    await i18n.changeLanguage('en');
    const htmlEn = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={activeOwner}
        activeTabId="users"
        initialSubmissionState={{
          status: 'succeeded',
          receipt: pendingReceipt,
          error: null,
          submissionCount: 1,
        }}
      />
    );

    expect(htmlEn).toContain('data-testid="receipt-manual-handoff-notice"');
    expect(htmlEn).toContain(MANUAL_HANDOFF_TRANSPARENCY_NOTICE_EN);
  });

  it('14. Copied invitationId is accepted by the existing normalizeAndValidateInvitationId validation used by AdminInvitationAcceptancePanel', async () => {
    const activeOwner = createAdminActor(AdminRole.Owner, { isActive: true });
    const pendingReceipt = createPendingInvitationReceipt({
      invitationId: 'inv_handoff_roundtrip_2026_03c6',
    });

    let clipboardText = '';
    const controller = new AdminInvitationCreationController({
      status: 'succeeded',
      receipt: pendingReceipt,
      error: null,
      submissionCount: 1,
    });

    await controller.copyInvitationId({
      currentUser: activeOwner,
      activeTabId: 'users',
      writeClipboardText: async (text) => {
        clipboardText = text;
      },
    });

    const validatedByNormalizedHelper =
      normalizeAndValidateInvitationId(clipboardText);
    const validatedForAcceptance =
      validateClientInvitationLocatorId(clipboardText);
    expect(validatedByNormalizedHelper).toBe('inv_handoff_roundtrip_2026_03c6');
    expect(validatedForAcceptance).toBe('inv_handoff_roundtrip_2026_03c6');
    expect(validatedForAcceptance).toBe(pendingReceipt.invitation.invitationId);
  });

  it('15. Preparing another invitation resets copy feedback and clears the previous receipt', async () => {
    const activeOwner = createAdminActor(AdminRole.Owner, { isActive: true });
    const pendingReceipt = createPendingInvitationReceipt();

    const controller = new AdminInvitationCreationController({
      status: 'succeeded',
      receipt: pendingReceipt,
      error: null,
      submissionCount: 1,
    });

    await controller.copyInvitationId({
      currentUser: activeOwner,
      activeTabId: 'users',
      writeClipboardText: async () => undefined,
    });

    expect(controller.getSnapshot().copyStatus).toBe('copied');
    expect(controller.getSnapshot().lastCopiedInvitationId).toBe(
      pendingReceipt.invitation.invitationId
    );

    controller.reset();

    const resetSnapshot = controller.getSnapshot();
    expect(resetSnapshot.status).toBe('idle');
    expect(resetSnapshot.receipt).toBeNull();
    expect(resetSnapshot.copyStatus).toBe('idle');
    expect(resetSnapshot.lastCopiedInvitationId).toBeNull();
  });

  it('16. Does not render modal, QR generator, share menu, email composer, or URL link builder', () => {
    const activeOwner = createAdminActor(AdminRole.Owner, { isActive: true });
    const pendingReceipt = createPendingInvitationReceipt();

    const html = renderToStaticMarkup(
      <AdminInvitationCreationPanel
        currentUser={activeOwner}
        activeTabId="users"
        initialSubmissionState={{
          status: 'succeeded',
          receipt: pendingReceipt,
          error: null,
          submissionCount: 1,
        }}
      />
    );

    const htmlWithoutSvgXmlns = html.replace(
      /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g,
      ''
    );
    expect(htmlWithoutSvgXmlns).not.toContain('mailto:');
    expect(htmlWithoutSvgXmlns).not.toContain('https://');
    expect(htmlWithoutSvgXmlns).not.toContain('http://');
    expect(htmlWithoutSvgXmlns).not.toContain('?invitationId=');
    expect(htmlWithoutSvgXmlns).not.toContain('href=');
  });
});
