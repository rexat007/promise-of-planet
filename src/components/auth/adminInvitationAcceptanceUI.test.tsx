import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { User } from 'firebase/auth';

import {
  AccountService,
  AccountServiceClass,
  InMemoryAccountRepository,
  type EmailVerificationStatusResult,
} from '../../services/accountService';
import {
  AdminInvitationStatus,
  acceptAdminInvitation,
  type AcceptAdminInvitationClientResponse,
  type AdminIdentityClientDependencies,
  type ManageAdminInvitationsClientPayload,
} from '../../services/adminIdentityManagementClient';
import { AdminRole } from '../../types/admin';
import { GlobalMemberAccountDialog } from './GlobalMemberAccountDialog';
import {
  ACCEPT_ADMIN_INVITATION_HEADING_AR,
  ACCEPT_ADMIN_INVITATION_HEADING_EN,
  OPEN_ADMIN_PORTAL_ACTION_AR,
  OPEN_ADMIN_PORTAL_ACTION_EN,
  OPEN_ADMIN_PORTAL_FALLBACK_INSTRUCTION_AR,
  OPEN_ADMIN_PORTAL_FALLBACK_INSTRUCTION_EN,
  SERVER_ROLE_ACTIVATED_NOTICE_AR,
  SERVER_ROLE_ACTIVATED_NOTICE_EN,
  AdminInvitationAcceptanceController,
  AdminInvitationAcceptancePanel,
  classifyInvitationAcceptanceFailure,
  invokePostAcceptanceAdminNavigation,
  validateClientInvitationLocatorId,
} from './AdminInvitationAcceptancePanel';

const SIGNED_OUT_STATUS: EmailVerificationStatusResult = Object.freeze({
  authenticated: false,
  uid: null,
  email: null,
  emailVerified: false,
});

const SIGNED_IN_UNVERIFIED_STATUS: EmailVerificationStatusResult = Object.freeze({
  authenticated: true,
  uid: 'member-uid-401',
  email: 'unverified.member@promiseofplanet.org',
  emailVerified: false,
});

const SIGNED_IN_VERIFIED_STATUS: EmailVerificationStatusResult = Object.freeze({
  authenticated: true,
  uid: 'member-uid-402',
  email: 'verified.member@promiseofplanet.org',
  emailVerified: true,
});

function buildAcceptedInvitationResponse(
  overrides?: Partial<{
    invitationId: string;
    targetUid: string;
    normalizedTargetEmail: string;
    intendedRole: AdminRole;
    invitingOwnerUid: string;
    createdAtIso: string;
    expiresAtIso: string;
    acceptedAtIso: string;
    acceptedByUid: string;
    revision: number;
    adminName: string;
    auditEventId: string;
  }>
): AcceptAdminInvitationClientResponse {
  const uid = overrides?.targetUid ?? SIGNED_IN_VERIFIED_STATUS.uid!;
  const email =
    overrides?.normalizedTargetEmail ?? SIGNED_IN_VERIFIED_STATUS.email!;
  const role = overrides?.intendedRole ?? AdminRole.RightsReviewer;

  return Object.freeze({
    invitation: Object.freeze({
      invitationId: overrides?.invitationId ?? 'inv_accept_20261026_01',
      targetUid: uid,
      normalizedTargetEmail: email,
      intendedRole: role,
      invitingOwnerUid: overrides?.invitingOwnerUid ?? 'owner-uid-900',
      createdAtIso: overrides?.createdAtIso ?? '2026-10-26T08:00:00.000Z',
      expiresAtIso: overrides?.expiresAtIso ?? '2026-11-02T08:00:00.000Z',
      status: AdminInvitationStatus.Accepted,
      acceptedAtIso: overrides?.acceptedAtIso ?? '2026-10-26T10:00:00.000Z',
      acceptedByUid: overrides?.acceptedByUid ?? uid,
      revokedAtIso: null,
      revokedByOwnerUid: null,
      expiredAtIso: null,
      revision: overrides?.revision ?? 2,
    }),
    admin: Object.freeze({
      id: uid,
      name: overrides?.adminName ?? 'Verified Member',
      email,
      role,
      isActive: true,
    }),
    auditEventId: overrides?.auditEventId ?? 'audit_accept_20261026_01',
  });
}

class TestableMemberAccountService extends AccountServiceClass {
  public simulatedUser: User | null = null;
  public sentVerifications = 0;
  public reloadCalls = 0;

  protected isConfigured(): boolean {
    return true;
  }

  protected getAuthenticatedUser(): User | null {
    return this.simulatedUser;
  }

  protected async performCreateUser(
    email: string,
    _password: string
  ): Promise<User> {
    const created = {
      uid: `uid-${email.split('@')[0].toLowerCase()}`,
      email: email.trim().toLowerCase(),
      displayName: null,
      emailVerified: false,
    } as unknown as User;
    this.simulatedUser = created;
    return created;
  }

  protected async performSendEmailVerification(_user: User): Promise<void> {
    this.sentVerifications += 1;
  }

  protected async performReloadUser(_user: User): Promise<void> {
    this.reloadCalls += 1;
  }
}

describe('AUTH-03C4 — Authenticated Administrative Invitation Acceptance UI', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Signed-out users cannot submit or accept an administrative invitation', async () => {
    const htmlAr = renderToStaticMarkup(
      <AdminInvitationAcceptancePanel
        isAr={true}
        initialAuthStatus={SIGNED_OUT_STATUS}
      />
    );

    expect(htmlAr).toContain('data-testid="admin-invitation-acceptance-panel"');
    expect(htmlAr).toContain('data-testid="invitation-acceptance-signed-out-state"');
    expect(htmlAr).not.toContain('data-testid="admin-invitation-acceptance-form"');
    expect(htmlAr).not.toContain('data-testid="submit-accept-invitation-btn"');

    const invokeSpy = vi.fn();
    const controller = new AdminInvitationAcceptanceController();
    const snap = await controller.submit({
      authStatus: SIGNED_OUT_STATUS,
      invitationId: 'inv_accept_20261026_01',
      invokeAcceptInvitation: invokeSpy,
    });

    expect(snap.status).toBe('error');
    expect(snap.error?.category).toBe('unauthenticated');
    expect(snap.result).toBeNull();
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it('2. Signed-in non-admin users can reach the acceptance panel inside GlobalMemberAccountDialog without AdminAccessGate', () => {
    const dialogArHtml = renderToStaticMarkup(
      <GlobalMemberAccountDialog
        isOpen={true}
        onClose={() => {}}
        isAr={true}
        invitationAcceptanceProps={{
          initialAuthStatus: SIGNED_IN_VERIFIED_STATUS,
        }}
      />
    );

    expect(dialogArHtml).toContain('data-testid="global-member-account-dialog"');
    expect(dialogArHtml).toContain(
      'data-testid="admin-invitation-acceptance-panel"'
    );
    expect(dialogArHtml).toContain(ACCEPT_ADMIN_INVITATION_HEADING_AR);
    expect(dialogArHtml).toContain('data-testid="admin-invitation-acceptance-form"');
    expect(dialogArHtml).toContain('data-testid="invitation-acceptance-id-input"');

    const dialogEnHtml = renderToStaticMarkup(
      <GlobalMemberAccountDialog
        isOpen={true}
        onClose={() => {}}
        isAr={false}
        invitationAcceptanceProps={{
          initialAuthStatus: SIGNED_IN_VERIFIED_STATUS,
        }}
      />
    );

    expect(dialogEnHtml).toContain(ACCEPT_ADMIN_INVITATION_HEADING_EN);
    expect(dialogEnHtml).toContain('data-testid="invitation-acceptance-id-input"');
  });

  it('3. Unverified signed-in users receive clear guidance and refresh verification action without calling server acceptance', async () => {
    const htmlAr = renderToStaticMarkup(
      <AdminInvitationAcceptancePanel
        isAr={true}
        initialAuthStatus={SIGNED_IN_UNVERIFIED_STATUS}
      />
    );

    expect(htmlAr).toContain(
      'data-testid="invitation-acceptance-unverified-guidance"'
    );
    expect(htmlAr).toContain(
      'data-testid="invitation-acceptance-refresh-verification-btn"'
    );
    expect(htmlAr).not.toContain('data-testid="admin-invitation-acceptance-form"');

    const htmlEn = renderToStaticMarkup(
      <AdminInvitationAcceptancePanel
        isAr={false}
        initialAuthStatus={SIGNED_IN_UNVERIFIED_STATUS}
      />
    );

    expect(htmlEn).toContain(
      'Accepting an administrative invitation requires a verified email address first.'
    );
    expect(htmlEn).toContain('Refresh Email Verification Status');

    const invokeSpy = vi.fn();
    const controller = new AdminInvitationAcceptanceController();
    const snap = await controller.submit({
      authStatus: SIGNED_IN_UNVERIFIED_STATUS,
      invitationId: 'inv_accept_20261026_01',
      invokeAcceptInvitation: invokeSpy,
    });

    expect(snap.status).toBe('error');
    expect(snap.error?.category).toBe('unverified-email');
    expect(snap.result).toBeNull();
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it('4. Verified signed-in users can submit a valid invitation ID to acceptAdminInvitation', async () => {
    expect(validateClientInvitationLocatorId('inv_accept_20261026_01')).toBe(
      'inv_accept_20261026_01'
    );
    expect(validateClientInvitationLocatorId('short')).toBeNull();
    expect(validateClientInvitationLocatorId('bad space id')).toBeNull();

    const callableSpy = vi.fn(
      async (payload: ManageAdminInvitationsClientPayload) => {
        expect(payload).toEqual({
          action: 'acceptInvitation',
          invitationId: 'inv_accept_20261026_01',
        });
        return {
          data: buildAcceptedInvitationResponse({
            invitationId: 'inv_accept_20261026_01',
            intendedRole: AdminRole.LibraryCurator,
          }),
        };
      }
    );

    const clientDeps: AdminIdentityClientDependencies = {
      isBackendConfigured: () => true,
      getAuthenticatedUid: () => SIGNED_IN_VERIFIED_STATUS.uid,
      manageAdminInvitationsCallable: callableSpy,
    };

    const controller = new AdminInvitationAcceptanceController();
    const snap = await controller.submit({
      authStatus: SIGNED_IN_VERIFIED_STATUS,
      invitationId: '  inv_accept_20261026_01  ',
      clientDeps,
    });

    expect(callableSpy).toHaveBeenCalledTimes(1);
    expect(snap.status).toBe('succeeded');
    expect(snap.error).toBeNull();
    expect(snap.result?.admin.role).toBe(AdminRole.LibraryCurator);
    expect(snap.result?.invitation.status).toBe(AdminInvitationStatus.Accepted);
  });

  it('5. No privileged client claims (uid, email, role, emailVerified, isOwner, permissions) are transmitted', async () => {
    let capturedPayload: Record<string, unknown> | null = null;

    const clientDeps: AdminIdentityClientDependencies = {
      isBackendConfigured: () => true,
      getAuthenticatedUid: () => SIGNED_IN_VERIFIED_STATUS.uid,
      manageAdminInvitationsCallable: async (payload) => {
        capturedPayload = payload as unknown as Record<string, unknown>;
        return {
          data: buildAcceptedInvitationResponse(),
        };
      },
    };

    const controller = new AdminInvitationAcceptanceController();
    await controller.submit({
      authStatus: SIGNED_IN_VERIFIED_STATUS,
      invitationId: 'inv_accept_20261026_01',
      clientDeps,
    });

    expect(capturedPayload).not.toBeNull();
    expect(Object.keys(capturedPayload!).sort()).toEqual([
      'action',
      'invitationId',
    ]);
    expect('uid' in capturedPayload!).toBe(false);
    expect('callerUid' in capturedPayload!).toBe(false);
    expect('email' in capturedPayload!).toBe(false);
    expect('targetEmail' in capturedPayload!).toBe(false);
    expect('intendedRole' in capturedPayload!).toBe(false);
    expect('role' in capturedPayload!).toBe(false);
    expect('emailVerified' in capturedPayload!).toBe(false);
    expect('isOwner' in capturedPayload!).toBe(false);
    expect('permissions' in capturedPayload!).toBe(false);
  });

  it('6. Valid server acceptance displays the canonical accepted invitation, assigned role, and server-activation confirmation (with action button when onEnterAdmin provided, or neutral instruction when omitted)', () => {
    const accepted = buildAcceptedInvitationResponse({
      invitationId: 'inv_accepted_9911',
      intendedRole: AdminRole.TrainingManager,
      auditEventId: 'audit_accept_9911',
    });

    const htmlArWithCallback = renderToStaticMarkup(
      <AdminInvitationAcceptancePanel
        isAr={true}
        onEnterAdmin={() => {}}
        initialAuthStatus={SIGNED_IN_VERIFIED_STATUS}
        initialAcceptanceState={{
          status: 'succeeded',
          result: accepted,
          error: null,
          submissionCount: 1,
        }}
      />
    );

    expect(htmlArWithCallback).toContain(
      'data-testid="invitation-acceptance-success-state"'
    );
    expect(htmlArWithCallback).toContain(SERVER_ROLE_ACTIVATED_NOTICE_AR);
    expect(htmlArWithCallback).toContain('inv_accepted_9911');
    expect(htmlArWithCallback).toContain('مدير البرامج والتدريب');
    expect(htmlArWithCallback).toContain(AdminRole.TrainingManager);
    expect(htmlArWithCallback).toContain('audit_accept_9911');
    expect(htmlArWithCallback).toContain(
      'data-testid="open-admin-portal-after-acceptance-btn"'
    );
    expect(htmlArWithCallback).toContain(OPEN_ADMIN_PORTAL_ACTION_AR);
    expect(htmlArWithCallback).not.toContain(
      'data-testid="open-admin-portal-fallback-instruction"'
    );

    const htmlEnWithCallback = renderToStaticMarkup(
      <AdminInvitationAcceptancePanel
        isAr={false}
        onEnterAdmin={() => {}}
        initialAuthStatus={SIGNED_IN_VERIFIED_STATUS}
        initialAcceptanceState={{
          status: 'succeeded',
          result: accepted,
          error: null,
          submissionCount: 1,
        }}
      />
    );

    expect(htmlEnWithCallback).toContain(
      'data-testid="invitation-acceptance-success-state"'
    );
    expect(htmlEnWithCallback).toContain(SERVER_ROLE_ACTIVATED_NOTICE_EN);
    expect(htmlEnWithCallback).toContain('Training Program Manager');
    expect(htmlEnWithCallback).toContain(OPEN_ADMIN_PORTAL_ACTION_EN);

    // When onEnterAdmin is unavailable, do not render an inert button; render neutral fallback instruction
    const htmlArWithoutCallback = renderToStaticMarkup(
      <AdminInvitationAcceptancePanel
        isAr={true}
        initialAuthStatus={SIGNED_IN_VERIFIED_STATUS}
        initialAcceptanceState={{
          status: 'succeeded',
          result: accepted,
          error: null,
          submissionCount: 1,
        }}
      />
    );
    expect(htmlArWithoutCallback).not.toContain(
      'data-testid="open-admin-portal-after-acceptance-btn"'
    );
    expect(htmlArWithoutCallback).toContain(
      'data-testid="open-admin-portal-fallback-instruction"'
    );
    expect(htmlArWithoutCallback).toContain(
      OPEN_ADMIN_PORTAL_FALLBACK_INSTRUCTION_AR
    );

    const htmlEnWithoutCallback = renderToStaticMarkup(
      <AdminInvitationAcceptancePanel
        isAr={false}
        initialAuthStatus={SIGNED_IN_VERIFIED_STATUS}
        initialAcceptanceState={{
          status: 'succeeded',
          result: accepted,
          error: null,
          submissionCount: 1,
        }}
      />
    );
    expect(htmlEnWithoutCallback).not.toContain(
      'data-testid="open-admin-portal-after-acceptance-btn"'
    );
    expect(htmlEnWithoutCallback).toContain(
      OPEN_ADMIN_PORTAL_FALLBACK_INSTRUCTION_EN
    );
  });

  it('7. Does NOT automatically redirect before user reviews the result; only invokes explicit onEnterAdmin callback once when clicked', async () => {
    const onCloseSpy = vi.fn();
    const onEnterAdminSpy = vi.fn();

    const controller = new AdminInvitationAcceptanceController();

    // Before acceptance (idle state), callback cannot be invoked
    expect(
      invokePostAcceptanceAdminNavigation(
        controller.getSnapshot(),
        onEnterAdminSpy
      )
    ).toBe(false);
    expect(onEnterAdminSpy).not.toHaveBeenCalled();

    const snap = await controller.submit({
      authStatus: SIGNED_IN_VERIFIED_STATUS,
      invitationId: 'inv_accept_20261026_01',
      invokeAcceptInvitation: async () => buildAcceptedInvitationResponse(),
    });

    expect(snap.status).toBe('succeeded');

    renderToStaticMarkup(
      <GlobalMemberAccountDialog
        isOpen={true}
        onClose={onCloseSpy}
        onEnterAdmin={onEnterAdminSpy}
        isAr={true}
        invitationAcceptanceProps={{
          initialAuthStatus: SIGNED_IN_VERIFIED_STATUS,
          initialAcceptanceState: snap,
        }}
      />
    );

    // Neither dialog close nor Admin Portal entry was triggered automatically upon success
    expect(onCloseSpy).not.toHaveBeenCalled();
    expect(onEnterAdminSpy).not.toHaveBeenCalled();

    // Clicking the action invokes onEnterAdmin exactly once
    const triggered = invokePostAcceptanceAdminNavigation(snap, onEnterAdminSpy);
    expect(triggered).toBe(true);
    expect(onEnterAdminSpy).toHaveBeenCalledTimes(1);
    expect(onCloseSpy).not.toHaveBeenCalled();
  });

  it('8. Duplicate submission is prevented while acceptance is pending', async () => {
    let resolveInFlight!: (value: AcceptAdminInvitationClientResponse) => void;
    const inFlightPromise = new Promise<AcceptAdminInvitationClientResponse>(
      (resolve) => {
        resolveInFlight = resolve;
      }
    );

    const invokeSpy = vi.fn(() => inFlightPromise);
    const controller = new AdminInvitationAcceptanceController();

    const firstTask = controller.submit({
      authStatus: SIGNED_IN_VERIFIED_STATUS,
      invitationId: 'inv_accept_20261026_01',
      invokeAcceptInvitation: invokeSpy,
    });

    expect(controller.getSnapshot().status).toBe('submitting');

    // Attempt second submission while first is in-flight
    const secondSnap = await controller.submit({
      authStatus: SIGNED_IN_VERIFIED_STATUS,
      invitationId: 'inv_accept_20261026_01',
      invokeAcceptInvitation: invokeSpy,
    });

    expect(secondSnap.status).toBe('submitting');
    expect(invokeSpy).toHaveBeenCalledTimes(1);

    resolveInFlight(buildAcceptedInvitationResponse());
    const finalSnap = await firstTask;
    expect(finalSnap.status).toBe('succeeded');
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });

  it('9. Expired, revoked, and already-accepted invitations fail safely with accurate bilingual feedback', async () => {
    const lifecycleErrors: Array<{
      readonly errorObj: Record<string, unknown>;
      readonly expectedCategory: string;
    }> = [
      {
        errorObj: {
          code: 'failed-precondition',
          reason: 'INVITATION_EXPIRED',
          message: 'INVITATION_EXPIRED',
        },
        expectedCategory: 'expired-invitation',
      },
      {
        errorObj: {
          code: 'failed-precondition',
          reason: 'INVITATION_REVOKED',
          message: 'INVITATION_REVOKED',
        },
        expectedCategory: 'revoked-invitation',
      },
      {
        errorObj: {
          code: 'failed-precondition',
          reason: 'INVITATION_ALREADY_ACCEPTED',
          message: 'INVITATION_ALREADY_ACCEPTED',
        },
        expectedCategory: 'already-accepted',
      },
    ];

    for (const item of lifecycleErrors) {
      const controller = new AdminInvitationAcceptanceController();
      const snap = await controller.submit({
        authStatus: SIGNED_IN_VERIFIED_STATUS,
        invitationId: 'inv_accept_20261026_01',
        invokeAcceptInvitation: async () => {
          throw item.errorObj;
        },
      });

      expect(snap.status).toBe('error');
      expect(snap.result).toBeNull();
      expect(snap.error?.category).toBe(item.expectedCategory);

      const html = renderToStaticMarkup(
        <AdminInvitationAcceptancePanel
          isAr={true}
          initialAuthStatus={SIGNED_IN_VERIFIED_STATUS}
          initialAcceptanceState={snap}
        />
      );
      expect(html).toContain('data-testid="invitation-acceptance-error-banner"');
      expect(html).toContain(
        `data-error-category="${item.expectedCategory}"`
      );
      expect(html).not.toContain(
        'data-testid="invitation-acceptance-success-state"'
      );
    }
  });

  it('10. Wrong UID or email mismatch fails safely without activating any role', async () => {
    const clientDeps: AdminIdentityClientDependencies = {
      isBackendConfigured: () => true,
      getAuthenticatedUid: () => SIGNED_IN_VERIFIED_STATUS.uid,
      manageAdminInvitationsCallable: async () => {
        throw {
          code: 'functions/permission-denied',
          message: 'Caller is not authorized to perform this administrative invitation operation.',
        };
      },
    };

    const controller = new AdminInvitationAcceptanceController();
    const snap = await controller.submit({
      authStatus: SIGNED_IN_VERIFIED_STATUS,
      invitationId: 'inv_accept_20261026_01',
      clientDeps,
    });

    expect(snap.status).toBe('error');
    expect(snap.result).toBeNull();
    expect(snap.error?.category).toBe('identity-mismatch');

    const html = renderToStaticMarkup(
      <AdminInvitationAcceptancePanel
        isAr={false}
        initialAuthStatus={SIGNED_IN_VERIFIED_STATUS}
        initialAcceptanceState={snap}
      />
    );
    expect(html).toContain('data-error-category="identity-mismatch"');
    expect(html).not.toContain('data-testid="invitation-acceptance-success-state"');
  });

  it('11. Server unavailable, conflict, or transaction failure does not fabricate activation and preserves session', async () => {
    const failureCases: Array<{
      readonly code: string;
      readonly expectedCategory: string;
    }> = [
      {
        code: 'functions/failed-precondition',
        expectedCategory: 'existing-admin-conflict',
      },
      {
        code: 'functions/unavailable',
        expectedCategory: 'unavailable',
      },
      {
        code: 'functions/internal',
        expectedCategory: 'transaction-failure',
      },
    ];

    const signOutSpy = vi.spyOn(AccountService, 'signOut');

    for (const item of failureCases) {
      const clientDeps: AdminIdentityClientDependencies = {
        isBackendConfigured: () => true,
        getAuthenticatedUid: () => SIGNED_IN_VERIFIED_STATUS.uid,
        manageAdminInvitationsCallable: async () => {
          throw { code: item.code, message: 'Server failure' };
        },
      };

      const controller = new AdminInvitationAcceptanceController();
      const snap = await controller.submit({
        authStatus: SIGNED_IN_VERIFIED_STATUS,
        invitationId: 'inv_accept_20261026_01',
        clientDeps,
      });

      expect(snap.status).toBe('error');
      expect(snap.result).toBeNull();
      expect(snap.error?.category).toBe(item.expectedCategory);
    }

    // Also verify forged/mismatched server response is rejected fail-closed
    const forgedController = new AdminInvitationAcceptanceController();
    const forgedSnap = await forgedController.submit({
      authStatus: SIGNED_IN_VERIFIED_STATUS,
      invitationId: 'inv_accept_20261026_01',
      invokeAcceptInvitation: async () =>
        buildAcceptedInvitationResponse({
          intendedRole: AdminRole.Owner, // Forbidden Owner activation
        }),
    });
    expect(forgedSnap.status).toBe('error');
    expect(forgedSnap.result).toBeNull();
    expect(forgedSnap.error?.category).toBe('transaction-failure');

    expect(signOutSpy).not.toHaveBeenCalled();
  });

  it('12. Client does not write admins/{uid} or import Firestore write APIs in acceptance UI', () => {
    const acceptanceSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'src/components/auth/AdminInvitationAcceptancePanel.tsx'
      ),
      'utf8'
    );
    const dialogSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'src/components/auth/GlobalMemberAccountDialog.tsx'
      ),
      'utf8'
    );

    const forbiddenApis = [
      'setDoc',
      'updateDoc',
      'deleteDoc',
      'addDoc',
      'writeBatch',
      'runTransaction',
      "doc(db, 'admins'",
      'doc(db, "admins"',
    ];

    for (const api of forbiddenApis) {
      expect(acceptanceSource).not.toContain(api);
      expect(dialogSource).not.toContain(api);
    }

    expect(typeof acceptAdminInvitation).toBe('function');
    expect(
      classifyInvitationAcceptanceFailure(new Error('unexpected')).category
    ).toBe('transaction-failure');
  });

  it('13. AdminAccessGate remains separate from GlobalMemberAccountDialog and AdminInvitationAcceptancePanel', () => {
    const acceptanceSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'src/components/auth/AdminInvitationAcceptancePanel.tsx'
      ),
      'utf8'
    );
    const dialogSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'src/components/auth/GlobalMemberAccountDialog.tsx'
      ),
      'utf8'
    );

    expect(acceptanceSource).not.toContain('AdminAccessGate');
    expect(dialogSource).not.toContain('AdminAccessGate');
    expect(acceptanceSource).not.toContain('AdminDomain.Users');
  });

  it('14. Existing account registration and email verification lifecycle remain functional', async () => {
    const repo = new InMemoryAccountRepository();
    const service = new TestableMemberAccountService(repo);

    const reg = await service.register(
      'member.accept@promiseofplanet.org',
      'SecurePass123!',
      'Member Invitee'
    );
    expect(reg.account?.email).toBe('member.accept@promiseofplanet.org');
    expect(service.getEmailVerificationStatus().emailVerified).toBe(false);

    const sendRes = await service.sendEmailVerificationForCurrentUser();
    expect(sendRes.status).toBe('sent');
    expect(service.sentVerifications).toBe(1);

    // Simulate user clicking verification link in email and refreshing status via AccountService
    service.simulatedUser = {
      ...service.simulatedUser!,
      emailVerified: true,
    } as unknown as User;

    const refreshRes = await service.refreshEmailVerificationStatus();
    expect(refreshRes.emailVerified).toBe(true);
    expect(service.reloadCalls).toBe(1);
    expect(service.getEmailVerificationStatus().emailVerified).toBe(true);
  });

  it('15. RTL/LTR direction and mobile-friendly responsive layout classes remain usable', () => {
    const htmlAr = renderToStaticMarkup(
      <GlobalMemberAccountDialog
        isOpen={true}
        onClose={() => {}}
        isAr={true}
        invitationAcceptanceProps={{
          initialAuthStatus: SIGNED_IN_VERIFIED_STATUS,
        }}
      />
    );
    expect(htmlAr).toContain('dir="rtl"');
    expect(htmlAr).toContain('flex-col sm:flex-row');
    expect(htmlAr).toContain('w-full sm:w-auto');

    const htmlEn = renderToStaticMarkup(
      <GlobalMemberAccountDialog
        isOpen={true}
        onClose={() => {}}
        isAr={false}
        invitationAcceptanceProps={{
          initialAuthStatus: SIGNED_IN_VERIFIED_STATUS,
        }}
      />
    );
    expect(htmlEn).toContain('dir="ltr"');
    expect(htmlEn).toContain('flex-col sm:flex-row');
    expect(htmlEn).toContain('w-full sm:w-auto');
  });

  it('16. Does not introduce a second login form, password field, or extra authentication provider', () => {
    const panelHtml = renderToStaticMarkup(
      <AdminInvitationAcceptancePanel
        isAr={true}
        initialAuthStatus={SIGNED_IN_VERIFIED_STATUS}
      />
    );

    expect(panelHtml).not.toContain('type="password"');
    expect(panelHtml).not.toContain('type="email"');

    const acceptanceSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'src/components/auth/AdminInvitationAcceptancePanel.tsx'
      ),
      'utf8'
    );
    expect(acceptanceSource).not.toContain('signInWithEmailAndPassword');
    expect(acceptanceSource).not.toContain('createUserWithEmailAndPassword');
    expect(acceptanceSource).not.toContain('FirebaseAuthProvider');
  });

  it('17. AUTH-03C4-R1: Explicit onEnterAdmin callback wiring through AppShell -> GlobalMemberAccountDialog -> AdminInvitationAcceptancePanel without DOM click simulation', async () => {
    const acceptanceSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'src/components/auth/AdminInvitationAcceptancePanel.tsx'
      ),
      'utf8'
    );
    const dialogSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'src/components/auth/GlobalMemberAccountDialog.tsx'
      ),
      'utf8'
    );
    const appShellSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/layout/AppShell.tsx'),
      'utf8'
    );
    const appSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/App.tsx'),
      'utf8'
    );

    // 1. No DOM click simulation or URL reloads in AdminInvitationAcceptancePanel
    expect(acceptanceSource).not.toContain('header-enter-admin-btn');
    expect(acceptanceSource).not.toContain('getElementById');
    expect(acceptanceSource).not.toContain('querySelector');
    expect(acceptanceSource).not.toContain('window.location');

    // 2. Explicit prop wiring from AppShell -> GlobalMemberAccountDialog -> AdminInvitationAcceptancePanel
    expect(appShellSource).toContain('onEnterAdmin={onEnterAdmin}');
    expect(dialogSource).toContain('onEnterAdmin={onEnterAdmin}');

    // 3. App.tsx onEnterAdmin closes member dialog and opens AdminAccessGate
    expect(appSource).toContain('setIsMemberAccountOpen(false)');
    expect(appSource).toContain('setIsAdminOpen(true)');
    expect(appSource).toContain('<AdminAccessGate');

    // 4. Failed acceptance never renders the navigation button or invokes onEnterAdmin
    const onEnterAdminSpy = vi.fn();
    const failedController = new AdminInvitationAcceptanceController();
    const failedSnap = await failedController.submit({
      authStatus: SIGNED_IN_VERIFIED_STATUS,
      invitationId: 'inv_accept_20261026_01',
      invokeAcceptInvitation: async () => {
        throw {
          code: 'failed-precondition',
          reason: 'INVITATION_EXPIRED',
          message: 'INVITATION_EXPIRED',
        };
      },
    });

    expect(failedSnap.status).toBe('error');
    expect(
      invokePostAcceptanceAdminNavigation(failedSnap, onEnterAdminSpy)
    ).toBe(false);
    expect(onEnterAdminSpy).not.toHaveBeenCalled();

    const failedHtml = renderToStaticMarkup(
      <GlobalMemberAccountDialog
        isOpen={true}
        onClose={() => {}}
        onEnterAdmin={onEnterAdminSpy}
        isAr={true}
        invitationAcceptanceProps={{
          initialAuthStatus: SIGNED_IN_VERIFIED_STATUS,
          initialAcceptanceState: failedSnap,
        }}
      />
    );
    expect(failedHtml).not.toContain(
      'data-testid="open-admin-portal-after-acceptance-btn"'
    );

    // 5. Exact Arabic and English labels
    expect(OPEN_ADMIN_PORTAL_ACTION_AR).toBe('الانتقال إلى بوابة الإدارة');
    expect(OPEN_ADMIN_PORTAL_ACTION_EN).toBe('Open Admin Portal');
  });
});
