import { describe, expect, it } from 'vitest';
import { AdminRole, type AdminUser } from '../types/admin';
import {
  AdminInvitationContractError,
  AdminInvitationStatus,
  DEFAULT_ADMIN_INVITATION_TTL_MS,
  createAdminInvitationIntent,
  transitionInvitationToAccepted,
  transitionInvitationToExpired,
  transitionInvitationToRevoked,
  validatePersistedAdminInvitationRecord,
  type AdminInvitationErrorCode,
} from './adminInvitationContract';

const BASE_TIME_ISO = '2026-10-26T08:00:00.000Z';
const BASE_TIME_MS = Date.parse(BASE_TIME_ISO);

function fixedClock(isoOrMs: string | number) {
  const ms = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs);
  return () => new Date(ms);
}

const ACTIVE_OWNER: AdminUser = {
  id: 'uid-owner-primary',
  name: 'Nadia Mansour',
  email: 'nadia@planet.org',
  role: AdminRole.Owner,
  isActive: true,
};

function expectContractError(
  fn: () => unknown,
  expectedCode: AdminInvitationErrorCode
): AdminInvitationContractError {
  try {
    fn();
    throw new Error(
      `Expected AdminInvitationContractError(${expectedCode}), but call succeeded.`
    );
  } catch (err: unknown) {
    expect(err).toBeInstanceOf(AdminInvitationContractError);
    const typed = err as AdminInvitationContractError;
    expect(typed.code).toBe(expectedCode);
    return typed;
  }
}

describe('AUTH-03B1 Secure Administrative Invitation Contract', () => {
  it('1. Valid Owner invitation intent creates a Pending invitation without creating an active admin', () => {
    const invitation = createAdminInvitationIntent(
      {
        invitationId: 'inv_20261026_rights_01',
        authenticatedCallerUid: ACTIVE_OWNER.id,
        resolvedCallerAdmin: ACTIVE_OWNER,
        targetEmail: '  Salma.Farouk@Planet.org ',
        intendedRole: AdminRole.RightsReviewer,
      },
      fixedClock(BASE_TIME_ISO)
    );

    expect(invitation).toEqual({
      invitationId: 'inv_20261026_rights_01',
      targetUid: null,
      normalizedTargetEmail: 'salma.farouk@planet.org',
      intendedRole: AdminRole.RightsReviewer,
      invitingOwnerUid: ACTIVE_OWNER.id,
      createdAtIso: BASE_TIME_ISO,
      expiresAtIso: new Date(
        BASE_TIME_MS + DEFAULT_ADMIN_INVITATION_TTL_MS
      ).toISOString(),
      status: AdminInvitationStatus.Pending,
      acceptedAtIso: null,
      acceptedByUid: null,
      revokedAtIso: null,
      revokedByOwnerUid: null,
      expiredAtIso: null,
      revision: 1,
    });

    // Verify invitation record is not an active AdminUser (has no isActive property)
    expect('isActive' in (invitation as unknown as Record<string, unknown>)).toBe(
      false
    );
  });

  it('2. Rejects unauthorized inviter (unauthenticated, missing admin record, or any non-Owner canonical role)', () => {
    expectContractError(
      () =>
        createAdminInvitationIntent(
          {
            invitationId: 'inv_unauth_0001',
            authenticatedCallerUid: '   ',
            resolvedCallerAdmin: ACTIVE_OWNER,
            targetEmail: 'candidate@planet.org',
            intendedRole: AdminRole.ContentEditor,
          },
          fixedClock(BASE_TIME_ISO)
        ),
      'UNAUTHENTICATED_CALLER'
    );

    expectContractError(
      () =>
        createAdminInvitationIntent(
          {
            invitationId: 'inv_no_admin_0001',
            authenticatedCallerUid: 'uid-public-member',
            resolvedCallerAdmin: null,
            targetEmail: 'candidate@planet.org',
            intendedRole: AdminRole.ContentEditor,
          },
          fixedClock(BASE_TIME_ISO)
        ),
      'UNAUTHORIZED_INVITER'
    );

    const nonOwnerRoles: AdminRole[] = [
      AdminRole.ContentEditor,
      AdminRole.LibraryCurator,
      AdminRole.RightsReviewer,
      AdminRole.TrainingManager,
      AdminRole.Trainer,
      AdminRole.CitizenModerator,
      AdminRole.AIAssistant,
      AdminRole.Viewer,
    ];

    for (const role of nonOwnerRoles) {
      const nonOwnerAdmin: AdminUser = {
        id: `uid-${role}`,
        name: `Role ${role}`,
        email: `${role.toLowerCase()}@planet.org`,
        role,
        isActive: true,
      };

      expectContractError(
        () =>
          createAdminInvitationIntent(
            {
              invitationId: `inv_role_${role}`,
              authenticatedCallerUid: nonOwnerAdmin.id,
              resolvedCallerAdmin: nonOwnerAdmin,
              targetEmail: 'candidate@planet.org',
              intendedRole: AdminRole.Viewer,
            },
            fixedClock(BASE_TIME_ISO)
          ),
        'UNAUTHORIZED_INVITER'
      );
    }
  });

  it('3. Rejects inactive inviter (Owner with isActive: false)', () => {
    const inactiveOwner: AdminUser = {
      ...ACTIVE_OWNER,
      isActive: false,
    };

    expectContractError(
      () =>
        createAdminInvitationIntent(
          {
            invitationId: 'inv_inactive_owner_01',
            authenticatedCallerUid: inactiveOwner.id,
            resolvedCallerAdmin: inactiveOwner,
            targetEmail: 'candidate@planet.org',
            intendedRole: AdminRole.ContentEditor,
          },
          fixedClock(BASE_TIME_ISO)
        ),
      'INACTIVE_INVITER'
    );
  });

  it('4. Rejects invalid target email formats and unnormalized persisted emails', () => {
    for (const badEmail of [
      '',
      '   ',
      'not-an-email',
      '@planet.org',
      'user@',
      'user@planet',
      'user..double@planet.org',
      'user name@planet.org',
    ]) {
      expectContractError(
        () =>
          createAdminInvitationIntent(
            {
              invitationId: 'inv_bad_email_01',
              authenticatedCallerUid: ACTIVE_OWNER.id,
              resolvedCallerAdmin: ACTIVE_OWNER,
              targetEmail: badEmail,
              intendedRole: AdminRole.ContentEditor,
            },
            fixedClock(BASE_TIME_ISO)
          ),
        'INVALID_TARGET_EMAIL'
      );
    }

    const validPending = createAdminInvitationIntent(
      {
        invitationId: 'inv_valid_email_01',
        authenticatedCallerUid: ACTIVE_OWNER.id,
        resolvedCallerAdmin: ACTIVE_OWNER,
        targetEmail: 'editor@planet.org',
        intendedRole: AdminRole.ContentEditor,
      },
      fixedClock(BASE_TIME_ISO)
    );

    expectContractError(
      () =>
        validatePersistedAdminInvitationRecord({
          ...validPending,
          normalizedTargetEmail: 'Editor@Planet.org',
        }),
      'INVALID_TARGET_EMAIL'
    );
  });

  it('5. Rejects invalid or legacy non-canonical AdminRole values', () => {
    for (const badRole of [
      'SuperAdmin',
      'Admin',
      'ManagingEditor',
      'Editor',
      'Writer',
      'Moderator',
      '',
    ]) {
      expectContractError(
        () =>
          createAdminInvitationIntent(
            {
              invitationId: 'inv_bad_role_01',
              authenticatedCallerUid: ACTIVE_OWNER.id,
              resolvedCallerAdmin: ACTIVE_OWNER,
              targetEmail: 'candidate@planet.org',
              intendedRole: badRole as AdminRole,
            },
            fixedClock(BASE_TIME_ISO)
          ),
        'INVALID_INTENDED_ROLE'
      );
    }
  });

  it('6. Rejects acceptance of expired invitations (both time-expired Pending and Expired status)', () => {
    const invitation = createAdminInvitationIntent(
      {
        invitationId: 'inv_expiring_0001',
        authenticatedCallerUid: ACTIVE_OWNER.id,
        resolvedCallerAdmin: ACTIVE_OWNER,
        targetEmail: 'curator@planet.org',
        intendedRole: AdminRole.LibraryCurator,
      },
      fixedClock(BASE_TIME_ISO)
    );

    const exactExpiryMs = Date.parse(invitation.expiresAtIso);

    // Attempting to accept at or after expiresAtIso fails closed even while status is still Pending
    expectContractError(
      () =>
        transitionInvitationToAccepted(
          {
            invitation,
            acceptorIdentity: {
              authenticatedUid: 'uid-curator-new',
              verifiedEmail: 'curator@planet.org',
              emailVerified: true,
              boundInvitationId: invitation.invitationId,
            },
          },
          fixedClock(exactExpiryMs)
        ),
      'INVITATION_EXPIRED'
    );

    // Transitioning to Expired at or after expiresAtIso succeeds deterministically
    const expiredRecord = transitionInvitationToExpired(
      { invitation, expectedRevision: 1 },
      fixedClock(exactExpiryMs + 1000)
    );

    expect(expiredRecord.status).toBe(AdminInvitationStatus.Expired);
    expect(expiredRecord.expiredAtIso).toBe(
      new Date(exactExpiryMs + 1000).toISOString()
    );
    expect(expiredRecord.revision).toBe(2);

    // Attempting to accept an already-Expired invitation fails closed even if clock is rewound
    expectContractError(
      () =>
        transitionInvitationToAccepted(
          {
            invitation: expiredRecord,
            acceptorIdentity: {
              authenticatedUid: 'uid-curator-new',
              verifiedEmail: 'curator@planet.org',
              emailVerified: true,
              boundInvitationId: invitation.invitationId,
            },
          },
          fixedClock(BASE_TIME_MS + 60_000)
        ),
      'INVITATION_EXPIRED'
    );
  });

  it('7. Rejects acceptance of revoked invitations after Owner revocation', () => {
    const invitation = createAdminInvitationIntent(
      {
        invitationId: 'inv_revocable_0001',
        authenticatedCallerUid: ACTIVE_OWNER.id,
        resolvedCallerAdmin: ACTIVE_OWNER,
        targetEmail: 'trainer@planet.org',
        intendedRole: AdminRole.Trainer,
      },
      fixedClock(BASE_TIME_ISO)
    );

    const revoked = transitionInvitationToRevoked(
      {
        invitation,
        authenticatedCallerUid: ACTIVE_OWNER.id,
        resolvedCallerAdmin: ACTIVE_OWNER,
        expectedRevision: 1,
      },
      fixedClock(BASE_TIME_MS + 30_000)
    );

    expect(revoked.status).toBe(AdminInvitationStatus.Revoked);
    expect(revoked.revokedByOwnerUid).toBe(ACTIVE_OWNER.id);
    expect(revoked.revokedAtIso).toBe(
      new Date(BASE_TIME_MS + 30_000).toISOString()
    );
    expect(revoked.revision).toBe(2);

    expectContractError(
      () =>
        transitionInvitationToAccepted(
          {
            invitation: revoked,
            acceptorIdentity: {
              authenticatedUid: 'uid-trainer-new',
              verifiedEmail: 'trainer@planet.org',
              emailVerified: true,
              boundInvitationId: invitation.invitationId,
            },
          },
          fixedClock(BASE_TIME_MS + 60_000)
        ),
      'INVITATION_REVOKED'
    );
  });

  it('8. Prevents double acceptance and detects concurrent revision conflicts', () => {
    const invitation = createAdminInvitationIntent(
      {
        invitationId: 'inv_single_use_0001',
        authenticatedCallerUid: ACTIVE_OWNER.id,
        resolvedCallerAdmin: ACTIVE_OWNER,
        targetEmail: 'editor@planet.org',
        intendedRole: AdminRole.ContentEditor,
      },
      fixedClock(BASE_TIME_ISO)
    );

    const accepted = transitionInvitationToAccepted(
      {
        invitation,
        expectedRevision: 1,
        acceptorIdentity: {
          authenticatedUid: 'uid-editor-1',
          verifiedEmail: 'editor@planet.org',
          emailVerified: true,
          boundInvitationId: invitation.invitationId,
        },
      },
      fixedClock(BASE_TIME_MS + 10_000)
    );

    expect(accepted.status).toBe(AdminInvitationStatus.Accepted);
    expect(accepted.targetUid).toBe('uid-editor-1');
    expect(accepted.acceptedByUid).toBe('uid-editor-1');
    expect(accepted.revision).toBe(2);

    // Second acceptance attempt on the accepted record fails with INVITATION_ALREADY_ACCEPTED
    expectContractError(
      () =>
        transitionInvitationToAccepted(
          {
            invitation: accepted,
            acceptorIdentity: {
              authenticatedUid: 'uid-editor-1',
              verifiedEmail: 'editor@planet.org',
              emailVerified: true,
              boundInvitationId: invitation.invitationId,
            },
          },
          fixedClock(BASE_TIME_MS + 20_000)
        ),
      'INVITATION_ALREADY_ACCEPTED'
    );

    // Concurrent acceptance with stale expectedRevision fails with CONCURRENT_MODIFICATION_CONFLICT
    expectContractError(
      () =>
        transitionInvitationToAccepted(
          {
            invitation: accepted,
            expectedRevision: 1,
            acceptorIdentity: {
              authenticatedUid: 'uid-editor-1',
              verifiedEmail: 'editor@planet.org',
              emailVerified: true,
              boundInvitationId: invitation.invitationId,
            },
          },
          fixedClock(BASE_TIME_MS + 20_000)
        ),
      'CONCURRENT_MODIFICATION_CONFLICT'
    );
  });

  it('9. Rejects cross-user acceptance attempts (pre-bound UID mismatch, email mismatch, or invitation binding mismatch)', () => {
    const uidBoundInvitation = createAdminInvitationIntent(
      {
        invitationId: 'inv_bound_uid_0001',
        authenticatedCallerUid: ACTIVE_OWNER.id,
        resolvedCallerAdmin: ACTIVE_OWNER,
        targetEmail: 'bound.user@planet.org',
        targetUid: 'uid-intended-recipient',
        intendedRole: AdminRole.RightsReviewer,
      },
      fixedClock(BASE_TIME_ISO)
    );

    // Even if email string matches, a different authenticated UID is rejected (not trusting email equality alone)
    expectContractError(
      () =>
        transitionInvitationToAccepted(
          {
            invitation: uidBoundInvitation,
            acceptorIdentity: {
              authenticatedUid: 'uid-different-user',
              verifiedEmail: 'bound.user@planet.org',
              emailVerified: true,
              boundInvitationId: uidBoundInvitation.invitationId,
            },
          },
          fixedClock(BASE_TIME_MS + 5_000)
        ),
      'IDENTITY_MISMATCH'
    );

    // Different email address is rejected with EMAIL_MISMATCH
    expectContractError(
      () =>
        transitionInvitationToAccepted(
          {
            invitation: uidBoundInvitation,
            acceptorIdentity: {
              authenticatedUid: 'uid-intended-recipient',
              verifiedEmail: 'other.person@planet.org',
              emailVerified: true,
              boundInvitationId: uidBoundInvitation.invitationId,
            },
          },
          fixedClock(BASE_TIME_MS + 5_000)
        ),
      'EMAIL_MISMATCH'
    );

    // Mismatched boundInvitationId is rejected with IDENTITY_MISMATCH
    expectContractError(
      () =>
        transitionInvitationToAccepted(
          {
            invitation: uidBoundInvitation,
            acceptorIdentity: {
              authenticatedUid: 'uid-intended-recipient',
              verifiedEmail: 'bound.user@planet.org',
              emailVerified: true,
              boundInvitationId: 'inv_some_other_id',
            },
          },
          fixedClock(BASE_TIME_MS + 5_000)
        ),
      'IDENTITY_MISMATCH'
    );
  });

  it('10. Rejects acceptance when target email is unverified in Firebase Auth', () => {
    const invitation = createAdminInvitationIntent(
      {
        invitationId: 'inv_unverified_email_01',
        authenticatedCallerUid: ACTIVE_OWNER.id,
        resolvedCallerAdmin: ACTIVE_OWNER,
        targetEmail: 'unverified@planet.org',
        intendedRole: AdminRole.CitizenModerator,
      },
      fixedClock(BASE_TIME_ISO)
    );

    expectContractError(
      () =>
        transitionInvitationToAccepted(
          {
            invitation,
            acceptorIdentity: {
              authenticatedUid: 'uid-unverified-1',
              verifiedEmail: 'unverified@planet.org',
              emailVerified: false,
              boundInvitationId: invitation.invitationId,
            },
          },
          fixedClock(BASE_TIME_MS + 5_000)
        ),
      'UNVERIFIED_TARGET_EMAIL'
    );
  });

  it('11. Rejects existing admin conflict at both creation and acceptance to prevent silent role overwrite', () => {
    const existingEditor: AdminUser = {
      id: 'uid-existing-editor',
      name: 'Existing Editor',
      email: 'existing@planet.org',
      role: AdminRole.ContentEditor,
      isActive: true,
    };

    // Conflict at creation
    expectContractError(
      () =>
        createAdminInvitationIntent(
          {
            invitationId: 'inv_conflict_create_01',
            authenticatedCallerUid: ACTIVE_OWNER.id,
            resolvedCallerAdmin: ACTIVE_OWNER,
            targetEmail: existingEditor.email,
            intendedRole: AdminRole.Viewer,
            existingTargetAdmin: existingEditor,
          },
          fixedClock(BASE_TIME_ISO)
        ),
      'EXISTING_ADMIN_CONFLICT'
    );

    // Conflict at acceptance (e.g. target became an admin after invitation was created)
    const pendingInvitation = createAdminInvitationIntent(
      {
        invitationId: 'inv_conflict_accept_01',
        authenticatedCallerUid: ACTIVE_OWNER.id,
        resolvedCallerAdmin: ACTIVE_OWNER,
        targetEmail: existingEditor.email,
        intendedRole: AdminRole.Viewer,
      },
      fixedClock(BASE_TIME_ISO)
    );

    expectContractError(
      () =>
        transitionInvitationToAccepted(
          {
            invitation: pendingInvitation,
            existingTargetAdmin: existingEditor,
            acceptorIdentity: {
              authenticatedUid: existingEditor.id,
              verifiedEmail: existingEditor.email,
              emailVerified: true,
              boundInvitationId: pendingInvitation.invitationId,
            },
          },
          fixedClock(BASE_TIME_MS + 10_000)
        ),
      'EXISTING_ADMIN_CONFLICT'
    );
  });

  it('12. Rejects forged role and forged UID in creation and acceptance', () => {
    // Forged caller UID vs resolved admin record ID
    expectContractError(
      () =>
        createAdminInvitationIntent(
          {
            invitationId: 'inv_forged_caller_01',
            authenticatedCallerUid: 'uid-attacker',
            resolvedCallerAdmin: ACTIVE_OWNER,
            targetEmail: 'target@planet.org',
            intendedRole: AdminRole.Viewer,
          },
          fixedClock(BASE_TIME_ISO)
        ),
      'IDENTITY_MISMATCH'
    );

    const invitation = createAdminInvitationIntent(
      {
        invitationId: 'inv_forged_accept_01',
        authenticatedCallerUid: ACTIVE_OWNER.id,
        resolvedCallerAdmin: ACTIVE_OWNER,
        targetEmail: 'viewer@planet.org',
        intendedRole: AdminRole.Viewer,
      },
      fixedClock(BASE_TIME_ISO)
    );

    // Forged payloadClaimedUid during acceptance
    expectContractError(
      () =>
        transitionInvitationToAccepted(
          {
            invitation,
            acceptorIdentity: {
              authenticatedUid: 'uid-real-acceptor',
              verifiedEmail: 'viewer@planet.org',
              emailVerified: true,
              boundInvitationId: invitation.invitationId,
              payloadClaimedUid: 'uid-spoofed-other',
            },
          },
          fixedClock(BASE_TIME_MS + 5_000)
        ),
      'IDENTITY_MISMATCH'
    );

    // Forged payloadClaimedRole attempting self-promotion to Owner during acceptance
    expectContractError(
      () =>
        transitionInvitationToAccepted(
          {
            invitation,
            acceptorIdentity: {
              authenticatedUid: 'uid-real-acceptor',
              verifiedEmail: 'viewer@planet.org',
              emailVerified: true,
              boundInvitationId: invitation.invitationId,
              payloadClaimedRole: AdminRole.Owner,
            },
          },
          fixedClock(BASE_TIME_MS + 5_000)
        ),
      'IDENTITY_MISMATCH'
    );
  });

  it('13. Prevents automatic Owner assignment unless separate explicit Owner role grant is provided', () => {
    // Without explicitOwnerRoleGrant -> rejected
    expectContractError(
      () =>
        createAdminInvitationIntent(
          {
            invitationId: 'inv_owner_no_grant_01',
            authenticatedCallerUid: ACTIVE_OWNER.id,
            resolvedCallerAdmin: ACTIVE_OWNER,
            targetEmail: 'co-owner@planet.org',
            intendedRole: AdminRole.Owner,
          },
          fixedClock(BASE_TIME_ISO)
        ),
      'OWNER_ROLE_ASSIGNMENT_REQUIRES_EXPLICIT_AUTHORIZATION'
    );

    // With mismatched authorizingOwnerUid -> rejected
    expectContractError(
      () =>
        createAdminInvitationIntent(
          {
            invitationId: 'inv_owner_bad_grant_01',
            authenticatedCallerUid: ACTIVE_OWNER.id,
            resolvedCallerAdmin: ACTIVE_OWNER,
            targetEmail: 'co-owner@planet.org',
            intendedRole: AdminRole.Owner,
            explicitOwnerRoleGrant: {
              confirmedOwnerRoleGrant: true,
              authorizingOwnerUid: 'uid-different-owner',
            },
          },
          fixedClock(BASE_TIME_ISO)
        ),
      'OWNER_ROLE_ASSIGNMENT_REQUIRES_EXPLICIT_AUTHORIZATION'
    );

    // With valid explicitOwnerRoleGrant matching authenticated Owner -> succeeds
    const ownerInvitation = createAdminInvitationIntent(
      {
        invitationId: 'inv_owner_explicit_01',
        authenticatedCallerUid: ACTIVE_OWNER.id,
        resolvedCallerAdmin: ACTIVE_OWNER,
        targetEmail: 'co-owner@planet.org',
        intendedRole: AdminRole.Owner,
        explicitOwnerRoleGrant: {
          confirmedOwnerRoleGrant: true,
          authorizingOwnerUid: ACTIVE_OWNER.id,
        },
      },
      fixedClock(BASE_TIME_ISO)
    );

    expect(ownerInvitation.intendedRole).toBe(AdminRole.Owner);
    expect(ownerInvitation.status).toBe(AdminInvitationStatus.Pending);
  });

  it('14. Ensures no passwords, plaintext tokens, or secrets exist or are accepted in invitation DTOs', () => {
    const invitation = createAdminInvitationIntent(
      {
        invitationId: 'inv_clean_dto_0001',
        authenticatedCallerUid: ACTIVE_OWNER.id,
        resolvedCallerAdmin: ACTIVE_OWNER,
        targetEmail: 'clean@planet.org',
        intendedRole: AdminRole.TrainingManager,
      },
      fixedClock(BASE_TIME_ISO)
    );

    for (const forbiddenField of [
      'password',
      'passwordHash',
      'invitationToken',
      'rawToken',
      'secret',
      'clientSecret',
      'oobCode',
      'apiKey',
      'privateKey',
    ]) {
      expectContractError(
        () =>
          validatePersistedAdminInvitationRecord({
            ...invitation,
            [forbiddenField]: 'sensitive-value-123',
          }),
        'FORBIDDEN_SECRET_FIELD_DETECTED'
      );
    }
  });

  it('15. Enforces deterministic state transition validation across all terminal states', () => {
    const pending = createAdminInvitationIntent(
      {
        invitationId: 'inv_transitions_0001',
        authenticatedCallerUid: ACTIVE_OWNER.id,
        resolvedCallerAdmin: ACTIVE_OWNER,
        targetEmail: 'transitions@planet.org',
        intendedRole: AdminRole.AIAssistant,
      },
      fixedClock(BASE_TIME_ISO)
    );

    // Cannot transition Pending -> Expired before expiresAtIso
    expectContractError(
      () =>
        transitionInvitationToExpired(
          { invitation: pending },
          fixedClock(BASE_TIME_MS + 60_000)
        ),
      'INVALID_STATE_TRANSITION'
    );

    const accepted = transitionInvitationToAccepted(
      {
        invitation: pending,
        acceptorIdentity: {
          authenticatedUid: 'uid-ai-assistant-1',
          verifiedEmail: 'transitions@planet.org',
          emailVerified: true,
          boundInvitationId: pending.invitationId,
        },
      },
      fixedClock(BASE_TIME_MS + 60_000)
    );

    // Cannot revoke an Accepted invitation
    expectContractError(
      () =>
        transitionInvitationToRevoked(
          {
            invitation: accepted,
            authenticatedCallerUid: ACTIVE_OWNER.id,
            resolvedCallerAdmin: ACTIVE_OWNER,
          },
          fixedClock(BASE_TIME_MS + 120_000)
        ),
      'INVALID_STATE_TRANSITION'
    );

    // Cannot expire an Accepted invitation even after expiresAtIso
    expectContractError(
      () =>
        transitionInvitationToExpired(
          { invitation: accepted },
          fixedClock(Date.parse(pending.expiresAtIso) + 10_000)
        ),
      'INVALID_STATE_TRANSITION'
    );

    const revoked = transitionInvitationToRevoked(
      {
        invitation: pending,
        authenticatedCallerUid: ACTIVE_OWNER.id,
        resolvedCallerAdmin: ACTIVE_OWNER,
      },
      fixedClock(BASE_TIME_MS + 60_000)
    );

    // Cannot revoke an already-Revoked invitation
    expectContractError(
      () =>
        transitionInvitationToRevoked(
          {
            invitation: revoked,
            authenticatedCallerUid: ACTIVE_OWNER.id,
            resolvedCallerAdmin: ACTIVE_OWNER,
          },
          fixedClock(BASE_TIME_MS + 120_000)
        ),
      'INVALID_STATE_TRANSITION'
    );

    // Cannot expire an already-Revoked invitation
    expectContractError(
      () =>
        transitionInvitationToExpired(
          { invitation: revoked },
          fixedClock(Date.parse(pending.expiresAtIso) + 10_000)
        ),
      'INVALID_STATE_TRANSITION'
    );
  });
});
