import { describe, expect, it } from 'vitest';
import { AdminRole } from '../types/admin';
import { AuditAction, AuditTargetType } from '../shared/auditContract';
import {
  AdminIdentityLifecycleContractError,
  AdminIdentityLifecycleTransitionType,
  LIFECYCLE_CONCURRENCY_REVALIDATION_NOTICE,
  TRUSTED_SERVER_OWNER_SNAPSHOT_ORIGIN,
  validateAdminIdentityLifecycleTransition,
  type AdminIdentityLifecycleErrorCode,
  type TrustedServerOwnerStateSnapshot,
  type VersionedAdminIdentityRecord,
} from './adminIdentityLifecycleContract';

const FIXED_TIME_ISO = '2026-10-26T14:30:00.000Z';
const FIXED_CLOCK = () => new Date(Date.parse(FIXED_TIME_ISO));

const ACTIVE_OWNER_PRIMARY: VersionedAdminIdentityRecord = Object.freeze({
  id: 'uid-owner-primary-001',
  name: 'Dr. Layla Al-Harbi',
  email: 'layla.harbi@promiseofplanet.org',
  role: AdminRole.Owner,
  isActive: true,
  revision: 4,
});

const ACTIVE_OWNER_SECONDARY: VersionedAdminIdentityRecord = Object.freeze({
  id: 'uid-owner-secondary-002',
  name: 'Nadia Al-Mansoor',
  email: 'nadia.mansoor@promiseofplanet.org',
  role: AdminRole.Owner,
  isActive: true,
  revision: 2,
});

const INACTIVE_OWNER: VersionedAdminIdentityRecord = Object.freeze({
  id: 'uid-owner-inactive-003',
  name: 'Former Owner',
  email: 'former.owner@promiseofplanet.org',
  role: AdminRole.Owner,
  isActive: false,
  revision: 5,
});

const ACTIVE_RIGHTS_REVIEWER: VersionedAdminIdentityRecord = Object.freeze({
  id: 'uid-admin-rights-101',
  name: 'Tariq Al-Zahrani',
  email: 'tariq.zahrani@promiseofplanet.org',
  role: AdminRole.RightsReviewer,
  isActive: true,
  revision: 3,
});

const INACTIVE_TRAINING_MANAGER: VersionedAdminIdentityRecord = Object.freeze({
  id: 'uid-admin-training-102',
  name: 'Mona Al-Qahtani',
  email: 'mona.qahtani@promiseofplanet.org',
  role: AdminRole.TrainingManager,
  isActive: false,
  revision: 7,
});

const SINGLE_ACTIVE_OWNER_SNAPSHOT: TrustedServerOwnerStateSnapshot =
  Object.freeze({
    origin: TRUSTED_SERVER_OWNER_SNAPSHOT_ORIGIN,
    activeOwnerUids: Object.freeze([ACTIVE_OWNER_PRIMARY.id]),
    capturedAtIso: FIXED_TIME_ISO,
  });

const DUAL_ACTIVE_OWNER_SNAPSHOT: TrustedServerOwnerStateSnapshot =
  Object.freeze({
    origin: TRUSTED_SERVER_OWNER_SNAPSHOT_ORIGIN,
    activeOwnerUids: Object.freeze([
      ACTIVE_OWNER_PRIMARY.id,
      ACTIVE_OWNER_SECONDARY.id,
    ]),
    capturedAtIso: FIXED_TIME_ISO,
  });

function expectLifecycleContractError(
  fn: () => unknown,
  expectedCode: AdminIdentityLifecycleErrorCode
): AdminIdentityLifecycleContractError {
  try {
    fn();
    throw new Error(
      `Expected AdminIdentityLifecycleContractError(${expectedCode}), but call succeeded.`
    );
  } catch (err: unknown) {
    expect(err).toBeInstanceOf(AdminIdentityLifecycleContractError);
    const typed = err as AdminIdentityLifecycleContractError;
    expect(typed.code).toBe(expectedCode);
    return typed;
  }
}

describe('AUTH-04A1 Administrative Identity Lifecycle Transition Contract', () => {
  it('1. Valid non-Owner role change produces a validated transition intent with RoleChanged audit metadata', () => {
    const nonOwnerRoles: ReadonlyArray<AdminRole> = [
      AdminRole.ContentEditor,
      AdminRole.LibraryCurator,
      AdminRole.RightsReviewer,
      AdminRole.TrainingManager,
      AdminRole.Trainer,
      AdminRole.CitizenModerator,
      AdminRole.AIAssistant,
      AdminRole.Viewer,
    ];

    const result = validateAdminIdentityLifecycleTransition(
      {
        authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
        resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
        targetUid: ACTIVE_RIGHTS_REVIEWER.id,
        resolvedTargetAdmin: ACTIVE_RIGHTS_REVIEWER,
        expectedRevision: 3,
        transitionType: AdminIdentityLifecycleTransitionType.ChangeRole,
        targetRole: AdminRole.LibraryCurator,
        trustedOwnerState: SINGLE_ACTIVE_OWNER_SNAPSHOT,
      },
      FIXED_CLOCK
    );

    expect(result.transitionType).toBe(
      AdminIdentityLifecycleTransitionType.ChangeRole
    );
    expect(result.actorUid).toBe(ACTIVE_OWNER_PRIMARY.id);
    expect(result.actorRole).toBe(AdminRole.Owner);
    expect(result.targetUid).toBe(ACTIVE_RIGHTS_REVIEWER.id);
    expect(result.previousState).toEqual({
      id: ACTIVE_RIGHTS_REVIEWER.id,
      name: ACTIVE_RIGHTS_REVIEWER.name,
      email: ACTIVE_RIGHTS_REVIEWER.email,
      role: AdminRole.RightsReviewer,
      isActive: true,
      revision: 3,
    });
    expect(result.proposedNextState).toEqual({
      id: ACTIVE_RIGHTS_REVIEWER.id,
      name: ACTIVE_RIGHTS_REVIEWER.name,
      email: ACTIVE_RIGHTS_REVIEWER.email,
      role: AdminRole.LibraryCurator,
      isActive: true,
      revision: 4,
    });
    expect(result.expectedRevision).toBe(3);
    expect(result.nextRevision).toBe(4);
    expect(result.validatedAtIso).toBe(FIXED_TIME_ISO);
    expect(result.requiresTransactionalOwnerInvariantRevalidation).toBe(true);
    expect(result.concurrencyNotice).toBe(
      LIFECYCLE_CONCURRENCY_REVALIDATION_NOTICE
    );
    expect(result.auditIntent).toEqual({
      timestamp: FIXED_TIME_ISO,
      actorUserId: ACTIVE_OWNER_PRIMARY.id,
      actorName: ACTIVE_OWNER_PRIMARY.name,
      actorRole: AdminRole.Owner,
      action: AuditAction.RoleChanged,
      targetType: AuditTargetType.AdminUser,
      targetId: ACTIVE_RIGHTS_REVIEWER.id,
      targetTitle: `${ACTIVE_RIGHTS_REVIEWER.email} (${AdminRole.LibraryCurator})`,
      changes: [
        {
          field: 'role',
          previousValue: AdminRole.RightsReviewer,
          newValue: AdminRole.LibraryCurator,
        },
      ],
      metadata: {
        transitionType: AdminIdentityLifecycleTransitionType.ChangeRole,
        targetUid: ACTIVE_RIGHTS_REVIEWER.id,
        previousRole: AdminRole.RightsReviewer,
        nextRole: AdminRole.LibraryCurator,
        previousIsActive: true,
        nextIsActive: true,
        previousRevision: 3,
        nextRevision: 4,
      },
    });

    // Verify all 8 canonical non-Owner roles are accepted when transitioning from a different role
    for (const nextRole of nonOwnerRoles) {
      if (nextRole === ACTIVE_RIGHTS_REVIEWER.role) continue;
      const roleTransition = validateAdminIdentityLifecycleTransition(
        {
          authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
          resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
          targetUid: ACTIVE_RIGHTS_REVIEWER.id,
          resolvedTargetAdmin: ACTIVE_RIGHTS_REVIEWER,
          expectedRevision: 3,
          transitionType: AdminIdentityLifecycleTransitionType.ChangeRole,
          targetRole: nextRole,
          trustedOwnerState: SINGLE_ACTIVE_OWNER_SNAPSHOT,
        },
        FIXED_CLOCK
      );
      expect(roleTransition.proposedNextState.role).toBe(nextRole);
    }
  });

  it('2. Valid non-Owner deactivation produces a validated transition intent with StatusChanged audit metadata', () => {
    const result = validateAdminIdentityLifecycleTransition(
      {
        authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
        resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
        targetUid: ACTIVE_RIGHTS_REVIEWER.id,
        resolvedTargetAdmin: ACTIVE_RIGHTS_REVIEWER,
        expectedRevision: 3,
        transitionType: AdminIdentityLifecycleTransitionType.Deactivate,
        trustedOwnerState: SINGLE_ACTIVE_OWNER_SNAPSHOT,
      },
      FIXED_CLOCK
    );

    expect(result.transitionType).toBe(
      AdminIdentityLifecycleTransitionType.Deactivate
    );
    expect(result.previousState.isActive).toBe(true);
    expect(result.proposedNextState.isActive).toBe(false);
    expect(result.proposedNextState.role).toBe(AdminRole.RightsReviewer);
    expect(result.nextRevision).toBe(4);
    expect(result.auditIntent.action).toBe(AuditAction.StatusChanged);
    expect(result.auditIntent.changes).toEqual([
      {
        field: 'isActive',
        previousValue: true,
        newValue: false,
      },
    ]);
  });

  it('3. Valid non-Owner reactivation produces a validated transition intent with StatusChanged audit metadata', () => {
    const result = validateAdminIdentityLifecycleTransition(
      {
        authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
        resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
        targetUid: INACTIVE_TRAINING_MANAGER.id,
        resolvedTargetAdmin: INACTIVE_TRAINING_MANAGER,
        expectedRevision: 7,
        transitionType: AdminIdentityLifecycleTransitionType.Reactivate,
        trustedOwnerState: SINGLE_ACTIVE_OWNER_SNAPSHOT,
      },
      FIXED_CLOCK
    );

    expect(result.transitionType).toBe(
      AdminIdentityLifecycleTransitionType.Reactivate
    );
    expect(result.previousState.isActive).toBe(false);
    expect(result.proposedNextState.isActive).toBe(true);
    expect(result.proposedNextState.role).toBe(AdminRole.TrainingManager);
    expect(result.nextRevision).toBe(8);
    expect(result.auditIntent.action).toBe(AuditAction.StatusChanged);
    expect(result.auditIntent.changes).toEqual([
      {
        field: 'isActive',
        previousValue: false,
        newValue: true,
      },
    ]);
  });

  it('4. Non-Owner actor is denied across all non-Owner canonical roles', () => {
    const nonOwnerRoles: ReadonlyArray<AdminRole> = [
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
      const nonOwnerActor: VersionedAdminIdentityRecord = {
        id: `uid-actor-${role}`,
        name: `Actor ${role}`,
        email: `${role.toLowerCase()}@promiseofplanet.org`,
        role,
        isActive: true,
        revision: 1,
      };

      expectLifecycleContractError(
        () =>
          validateAdminIdentityLifecycleTransition(
            {
              authenticatedActorUid: nonOwnerActor.id,
              resolvedActorAdmin: nonOwnerActor,
              targetUid: ACTIVE_RIGHTS_REVIEWER.id,
              resolvedTargetAdmin: ACTIVE_RIGHTS_REVIEWER,
              expectedRevision: 3,
              transitionType: AdminIdentityLifecycleTransitionType.Deactivate,
              trustedOwnerState: SINGLE_ACTIVE_OWNER_SNAPSHOT,
            },
            FIXED_CLOCK
          ),
        'UNAUTHORIZED_ACTOR'
      );
    }
  });

  it('5. Inactive Owner actor is denied', () => {
    expectLifecycleContractError(
      () =>
        validateAdminIdentityLifecycleTransition(
          {
            authenticatedActorUid: INACTIVE_OWNER.id,
            resolvedActorAdmin: INACTIVE_OWNER,
            targetUid: ACTIVE_RIGHTS_REVIEWER.id,
            resolvedTargetAdmin: ACTIVE_RIGHTS_REVIEWER,
            expectedRevision: 3,
            transitionType: AdminIdentityLifecycleTransitionType.ChangeRole,
            targetRole: AdminRole.Viewer,
            trustedOwnerState: SINGLE_ACTIVE_OWNER_SNAPSHOT,
          },
          FIXED_CLOCK
        ),
      'INACTIVE_ACTOR'
    );
  });

  it('6. Wrong or missing actor UID is denied', () => {
    expectLifecycleContractError(
      () =>
        validateAdminIdentityLifecycleTransition(
          {
            authenticatedActorUid: 'uid-different-caller',
            resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
            targetUid: ACTIVE_RIGHTS_REVIEWER.id,
            resolvedTargetAdmin: ACTIVE_RIGHTS_REVIEWER,
            expectedRevision: 3,
            transitionType: AdminIdentityLifecycleTransitionType.Deactivate,
            trustedOwnerState: SINGLE_ACTIVE_OWNER_SNAPSHOT,
          },
          FIXED_CLOCK
        ),
      'IDENTITY_MISMATCH'
    );

    expectLifecycleContractError(
      () =>
        validateAdminIdentityLifecycleTransition(
          {
            authenticatedActorUid: '   ',
            resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
            targetUid: ACTIVE_RIGHTS_REVIEWER.id,
            resolvedTargetAdmin: ACTIVE_RIGHTS_REVIEWER,
            expectedRevision: 3,
            transitionType: AdminIdentityLifecycleTransitionType.Deactivate,
            trustedOwnerState: SINGLE_ACTIVE_OWNER_SNAPSHOT,
          },
          FIXED_CLOCK
        ),
      'UNAUTHENTICATED_ACTOR'
    );
  });

  it('7. Wrong target UID or missing target admin record is denied', () => {
    expectLifecycleContractError(
      () =>
        validateAdminIdentityLifecycleTransition(
          {
            authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
            resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
            targetUid: 'uid-mismatched-target',
            resolvedTargetAdmin: ACTIVE_RIGHTS_REVIEWER,
            expectedRevision: 3,
            transitionType: AdminIdentityLifecycleTransitionType.Deactivate,
            trustedOwnerState: SINGLE_ACTIVE_OWNER_SNAPSHOT,
          },
          FIXED_CLOCK
        ),
      'TARGET_UID_MISMATCH'
    );

    expectLifecycleContractError(
      () =>
        validateAdminIdentityLifecycleTransition(
          {
            authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
            resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
            targetUid: 'uid-nonexistent-admin',
            resolvedTargetAdmin: null,
            expectedRevision: 1,
            transitionType: AdminIdentityLifecycleTransitionType.Deactivate,
            trustedOwnerState: SINGLE_ACTIVE_OWNER_SNAPSHOT,
          },
          FIXED_CLOCK
        ),
      'TARGET_ADMIN_NOT_FOUND'
    );
  });

  it('8. Invalid or non-canonical target role is rejected', () => {
    expectLifecycleContractError(
      () =>
        validateAdminIdentityLifecycleTransition(
          {
            authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
            resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
            targetUid: ACTIVE_RIGHTS_REVIEWER.id,
            resolvedTargetAdmin: ACTIVE_RIGHTS_REVIEWER,
            expectedRevision: 3,
            transitionType: AdminIdentityLifecycleTransitionType.ChangeRole,
            targetRole: 'SuperAdmin' as unknown as AdminRole,
            trustedOwnerState: SINGLE_ACTIVE_OWNER_SNAPSHOT,
          },
          FIXED_CLOCK
        ),
      'INVALID_TARGET_ROLE'
    );

    expectLifecycleContractError(
      () =>
        validateAdminIdentityLifecycleTransition(
          {
            authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
            resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
            targetUid: ACTIVE_RIGHTS_REVIEWER.id,
            resolvedTargetAdmin: ACTIVE_RIGHTS_REVIEWER,
            expectedRevision: 3,
            transitionType: AdminIdentityLifecycleTransitionType.ChangeRole,
            trustedOwnerState: SINGLE_ACTIVE_OWNER_SNAPSHOT,
          },
          FIXED_CLOCK
        ),
      'INVALID_TARGET_ROLE'
    );
  });

  it('9. No-op role change is rejected', () => {
    expectLifecycleContractError(
      () =>
        validateAdminIdentityLifecycleTransition(
          {
            authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
            resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
            targetUid: ACTIVE_RIGHTS_REVIEWER.id,
            resolvedTargetAdmin: ACTIVE_RIGHTS_REVIEWER,
            expectedRevision: 3,
            transitionType: AdminIdentityLifecycleTransitionType.ChangeRole,
            targetRole: AdminRole.RightsReviewer,
            trustedOwnerState: SINGLE_ACTIVE_OWNER_SNAPSHOT,
          },
          FIXED_CLOCK
        ),
      'NO_OP_TRANSITION'
    );
  });

  it('10. Double deactivation (deactivating an already inactive admin) is rejected', () => {
    expectLifecycleContractError(
      () =>
        validateAdminIdentityLifecycleTransition(
          {
            authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
            resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
            targetUid: INACTIVE_TRAINING_MANAGER.id,
            resolvedTargetAdmin: INACTIVE_TRAINING_MANAGER,
            expectedRevision: 7,
            transitionType: AdminIdentityLifecycleTransitionType.Deactivate,
            trustedOwnerState: SINGLE_ACTIVE_OWNER_SNAPSHOT,
          },
          FIXED_CLOCK
        ),
      'ALREADY_INACTIVE'
    );
  });

  it('11. Double reactivation (reactivating an already active admin) is rejected', () => {
    expectLifecycleContractError(
      () =>
        validateAdminIdentityLifecycleTransition(
          {
            authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
            resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
            targetUid: ACTIVE_RIGHTS_REVIEWER.id,
            resolvedTargetAdmin: ACTIVE_RIGHTS_REVIEWER,
            expectedRevision: 3,
            transitionType: AdminIdentityLifecycleTransitionType.Reactivate,
            trustedOwnerState: SINGLE_ACTIVE_OWNER_SNAPSHOT,
          },
          FIXED_CLOCK
        ),
      'ALREADY_ACTIVE'
    );
  });

  it('12. Self-deactivation is rejected even when multiple active Owners exist', () => {
    expectLifecycleContractError(
      () =>
        validateAdminIdentityLifecycleTransition(
          {
            authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
            resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
            targetUid: ACTIVE_OWNER_PRIMARY.id,
            resolvedTargetAdmin: ACTIVE_OWNER_PRIMARY,
            expectedRevision: 4,
            transitionType: AdminIdentityLifecycleTransitionType.Deactivate,
            trustedOwnerState: DUAL_ACTIVE_OWNER_SNAPSHOT,
          },
          FIXED_CLOCK
        ),
      'SELF_DEACTIVATION_FORBIDDEN'
    );
  });

  it('13. Self-demotion is rejected even when multiple active Owners exist', () => {
    expectLifecycleContractError(
      () =>
        validateAdminIdentityLifecycleTransition(
          {
            authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
            resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
            targetUid: ACTIVE_OWNER_PRIMARY.id,
            resolvedTargetAdmin: ACTIVE_OWNER_PRIMARY,
            expectedRevision: 4,
            transitionType: AdminIdentityLifecycleTransitionType.ChangeRole,
            targetRole: AdminRole.Viewer,
            trustedOwnerState: DUAL_ACTIVE_OWNER_SNAPSHOT,
          },
          FIXED_CLOCK
        ),
      'SELF_DEMOTION_FORBIDDEN'
    );
  });

  it('14. Deactivation of the last active Owner is rejected', () => {
    const soleTargetOwnerSnapshot: TrustedServerOwnerStateSnapshot =
      Object.freeze({
        origin: TRUSTED_SERVER_OWNER_SNAPSHOT_ORIGIN,
        activeOwnerUids: Object.freeze([ACTIVE_OWNER_SECONDARY.id]),
        capturedAtIso: FIXED_TIME_ISO,
      });

    expectLifecycleContractError(
      () =>
        validateAdminIdentityLifecycleTransition(
          {
            authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
            resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
            targetUid: ACTIVE_OWNER_SECONDARY.id,
            resolvedTargetAdmin: ACTIVE_OWNER_SECONDARY,
            expectedRevision: 2,
            transitionType: AdminIdentityLifecycleTransitionType.Deactivate,
            trustedOwnerState: soleTargetOwnerSnapshot,
          },
          FIXED_CLOCK
        ),
      'LAST_ACTIVE_OWNER_DEACTIVATION_FORBIDDEN'
    );

    expectLifecycleContractError(
      () =>
        validateAdminIdentityLifecycleTransition(
          {
            authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
            resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
            targetUid: ACTIVE_OWNER_SECONDARY.id,
            resolvedTargetAdmin: ACTIVE_OWNER_SECONDARY,
            expectedRevision: 2,
            transitionType: AdminIdentityLifecycleTransitionType.Deactivate,
            trustedOwnerState: SINGLE_ACTIVE_OWNER_SNAPSHOT,
          },
          FIXED_CLOCK
        ),
      'LAST_ACTIVE_OWNER_DEACTIVATION_FORBIDDEN'
    );
  });

  it('15. Demotion of the last active Owner is rejected', () => {
    const soleTargetOwnerSnapshot: TrustedServerOwnerStateSnapshot =
      Object.freeze({
        origin: TRUSTED_SERVER_OWNER_SNAPSHOT_ORIGIN,
        activeOwnerUids: Object.freeze([ACTIVE_OWNER_SECONDARY.id]),
        capturedAtIso: FIXED_TIME_ISO,
      });

    expectLifecycleContractError(
      () =>
        validateAdminIdentityLifecycleTransition(
          {
            authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
            resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
            targetUid: ACTIVE_OWNER_SECONDARY.id,
            resolvedTargetAdmin: ACTIVE_OWNER_SECONDARY,
            expectedRevision: 2,
            transitionType: AdminIdentityLifecycleTransitionType.ChangeRole,
            targetRole: AdminRole.ContentEditor,
            trustedOwnerState: soleTargetOwnerSnapshot,
          },
          FIXED_CLOCK
        ),
      'LAST_ACTIVE_OWNER_DEMOTION_FORBIDDEN'
    );

    expectLifecycleContractError(
      () =>
        validateAdminIdentityLifecycleTransition(
          {
            authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
            resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
            targetUid: ACTIVE_OWNER_SECONDARY.id,
            resolvedTargetAdmin: ACTIVE_OWNER_SECONDARY,
            expectedRevision: 2,
            transitionType: AdminIdentityLifecycleTransitionType.ChangeRole,
            targetRole: AdminRole.ContentEditor,
            trustedOwnerState: SINGLE_ACTIVE_OWNER_SNAPSHOT,
          },
          FIXED_CLOCK
        ),
      'LAST_ACTIVE_OWNER_DEMOTION_FORBIDDEN'
    );
  });

  it('16. Missing or untrusted Owner state snapshot is rejected', () => {
    expectLifecycleContractError(
      () =>
        validateAdminIdentityLifecycleTransition(
          {
            authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
            resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
            targetUid: ACTIVE_RIGHTS_REVIEWER.id,
            resolvedTargetAdmin: ACTIVE_RIGHTS_REVIEWER,
            expectedRevision: 3,
            transitionType: AdminIdentityLifecycleTransitionType.Deactivate,
            trustedOwnerState: null,
          },
          FIXED_CLOCK
        ),
      'UNTRUSTED_OWNER_STATE_SNAPSHOT'
    );

    // Caller-provided numeric count instead of server snapshot must be rejected
    expectLifecycleContractError(
      () =>
        validateAdminIdentityLifecycleTransition(
          {
            authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
            resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
            targetUid: ACTIVE_RIGHTS_REVIEWER.id,
            resolvedTargetAdmin: ACTIVE_RIGHTS_REVIEWER,
            expectedRevision: 3,
            transitionType: AdminIdentityLifecycleTransitionType.Deactivate,
            trustedOwnerState: {
              origin: TRUSTED_SERVER_OWNER_SNAPSHOT_ORIGIN,
              activeOwnerUids: [ACTIVE_OWNER_PRIMARY.id],
              activeOwnerCount: 5,
            } as unknown as TrustedServerOwnerStateSnapshot,
          },
          FIXED_CLOCK
        ),
      'UNTRUSTED_OWNER_STATE_SNAPSHOT'
    );

    // Wrong origin rejected
    expectLifecycleContractError(
      () =>
        validateAdminIdentityLifecycleTransition(
          {
            authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
            resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
            targetUid: ACTIVE_RIGHTS_REVIEWER.id,
            resolvedTargetAdmin: ACTIVE_RIGHTS_REVIEWER,
            expectedRevision: 3,
            transitionType: AdminIdentityLifecycleTransitionType.Deactivate,
            trustedOwnerState: {
              origin: 'CLIENT_PROVIDED_COUNT' as unknown as typeof TRUSTED_SERVER_OWNER_SNAPSHOT_ORIGIN,
              activeOwnerUids: [ACTIVE_OWNER_PRIMARY.id],
            },
          },
          FIXED_CLOCK
        ),
      'UNTRUSTED_OWNER_STATE_SNAPSHOT'
    );
  });

  it('17. Explicit Owner promotion policy not established — promotion or reactivation to Owner is denied', () => {
    expectLifecycleContractError(
      () =>
        validateAdminIdentityLifecycleTransition(
          {
            authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
            resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
            targetUid: ACTIVE_RIGHTS_REVIEWER.id,
            resolvedTargetAdmin: ACTIVE_RIGHTS_REVIEWER,
            expectedRevision: 3,
            transitionType: AdminIdentityLifecycleTransitionType.ChangeRole,
            targetRole: AdminRole.Owner,
            trustedOwnerState: SINGLE_ACTIVE_OWNER_SNAPSHOT,
          },
          FIXED_CLOCK
        ),
      'OWNER_PROMOTION_POLICY_NOT_ESTABLISHED'
    );

    expectLifecycleContractError(
      () =>
        validateAdminIdentityLifecycleTransition(
          {
            authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
            resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
            targetUid: ACTIVE_RIGHTS_REVIEWER.id,
            resolvedTargetAdmin: ACTIVE_RIGHTS_REVIEWER,
            expectedRevision: 3,
            transitionType: AdminIdentityLifecycleTransitionType.ChangeRole,
            targetRole: AdminRole.Owner,
            explicitOwnerPromotionPolicy: { confirmed: true },
            trustedOwnerState: SINGLE_ACTIVE_OWNER_SNAPSHOT,
          },
          FIXED_CLOCK
        ),
      'OWNER_PROMOTION_POLICY_NOT_ESTABLISHED'
    );

    expectLifecycleContractError(
      () =>
        validateAdminIdentityLifecycleTransition(
          {
            authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
            resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
            targetUid: INACTIVE_OWNER.id,
            resolvedTargetAdmin: INACTIVE_OWNER,
            expectedRevision: 5,
            transitionType: AdminIdentityLifecycleTransitionType.Reactivate,
            trustedOwnerState: SINGLE_ACTIVE_OWNER_SNAPSHOT,
          },
          FIXED_CLOCK
        ),
      'OWNER_PROMOTION_POLICY_NOT_ESTABLISHED'
    );
  });

  it('18. Revision conflict or invalid revision is rejected fail-closed', () => {
    expectLifecycleContractError(
      () =>
        validateAdminIdentityLifecycleTransition(
          {
            authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
            resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
            targetUid: ACTIVE_RIGHTS_REVIEWER.id,
            resolvedTargetAdmin: ACTIVE_RIGHTS_REVIEWER,
            expectedRevision: 2, // actual is 3
            transitionType: AdminIdentityLifecycleTransitionType.Deactivate,
            trustedOwnerState: SINGLE_ACTIVE_OWNER_SNAPSHOT,
          },
          FIXED_CLOCK
        ),
      'REVISION_CONFLICT'
    );

    expectLifecycleContractError(
      () =>
        validateAdminIdentityLifecycleTransition(
          {
            authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
            resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
            targetUid: ACTIVE_RIGHTS_REVIEWER.id,
            resolvedTargetAdmin: ACTIVE_RIGHTS_REVIEWER,
            expectedRevision: 0,
            transitionType: AdminIdentityLifecycleTransitionType.Deactivate,
            trustedOwnerState: SINGLE_ACTIVE_OWNER_SNAPSHOT,
          },
          FIXED_CLOCK
        ),
      'INVALID_REVISION'
    );

    const targetWithoutRevision: VersionedAdminIdentityRecord = {
      id: ACTIVE_RIGHTS_REVIEWER.id,
      name: ACTIVE_RIGHTS_REVIEWER.name,
      email: ACTIVE_RIGHTS_REVIEWER.email,
      role: ACTIVE_RIGHTS_REVIEWER.role,
      isActive: ACTIVE_RIGHTS_REVIEWER.isActive,
    };

    expectLifecycleContractError(
      () =>
        validateAdminIdentityLifecycleTransition(
          {
            authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
            resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
            targetUid: targetWithoutRevision.id,
            resolvedTargetAdmin: targetWithoutRevision,
            expectedRevision: 1,
            transitionType: AdminIdentityLifecycleTransitionType.Deactivate,
            trustedOwnerState: SINGLE_ACTIVE_OWNER_SNAPSHOT,
          },
          FIXED_CLOCK
        ),
      'INVALID_REVISION'
    );
  });

  it('19. Contract performs zero Firebase writes or side effects, preserves input immutability, and returns deeply frozen intent', () => {
    const actorSnapshotBefore = JSON.stringify(ACTIVE_OWNER_PRIMARY);
    const targetSnapshotBefore = JSON.stringify(ACTIVE_RIGHTS_REVIEWER);
    const ownerStateSnapshotBefore = JSON.stringify(
      SINGLE_ACTIVE_OWNER_SNAPSHOT
    );

    const intent = validateAdminIdentityLifecycleTransition(
      {
        authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
        resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
        targetUid: ACTIVE_RIGHTS_REVIEWER.id,
        resolvedTargetAdmin: ACTIVE_RIGHTS_REVIEWER,
        expectedRevision: 3,
        transitionType: AdminIdentityLifecycleTransitionType.ChangeRole,
        targetRole: AdminRole.Viewer,
        trustedOwnerState: SINGLE_ACTIVE_OWNER_SNAPSHOT,
      },
      FIXED_CLOCK
    );

    // Input records and snapshots remain completely unmutated
    expect(JSON.stringify(ACTIVE_OWNER_PRIMARY)).toBe(actorSnapshotBefore);
    expect(JSON.stringify(ACTIVE_RIGHTS_REVIEWER)).toBe(targetSnapshotBefore);
    expect(JSON.stringify(SINGLE_ACTIVE_OWNER_SNAPSHOT)).toBe(
      ownerStateSnapshotBefore
    );

    expect(Object.isFrozen(intent)).toBe(true);
    expect(Object.isFrozen(intent.previousState)).toBe(true);
    expect(Object.isFrozen(intent.proposedNextState)).toBe(true);
    expect(Object.isFrozen(intent.auditIntent)).toBe(true);
    expect(Object.isFrozen(intent.auditIntent.changes)).toBe(true);
    expect(Object.isFrozen(intent.auditIntent.metadata)).toBe(true);
    expect(intent.requiresTransactionalOwnerInvariantRevalidation).toBe(true);
  });

  it('20. Client role, UID, privilege, or invitation spoofing claims are rejected fail-closed', () => {
    const spoofPayloads = [
      { actorUid: ACTIVE_OWNER_PRIMARY.id },
      { callerUid: ACTIVE_OWNER_PRIMARY.id },
      { uid: ACTIVE_OWNER_PRIMARY.id },
      { actorRole: AdminRole.Owner },
      { role: AdminRole.Owner },
      { isOwner: true },
      { isActive: true },
      { permissions: ['manageUsers'] },
      { activeOwnerCount: 3 },
      { trustedOwnerState: SINGLE_ACTIVE_OWNER_SNAPSHOT },
      { explicitOwnerPromotionPolicy: true },
    ];

    for (const spoof of spoofPayloads) {
      expectLifecycleContractError(
        () =>
          validateAdminIdentityLifecycleTransition(
            {
              authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
              resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
              targetUid: ACTIVE_RIGHTS_REVIEWER.id,
              resolvedTargetAdmin: ACTIVE_RIGHTS_REVIEWER,
              expectedRevision: 3,
              transitionType: AdminIdentityLifecycleTransitionType.Deactivate,
              trustedOwnerState: SINGLE_ACTIVE_OWNER_SNAPSHOT,
              untrustedClientClaims: spoof,
            },
            FIXED_CLOCK
          ),
        'IDENTITY_OR_PRIVILEGE_SPOOFING_DETECTED'
      );
    }

    // Forbidden invitationId or secret field on target record must also fail closed
    expectLifecycleContractError(
      () =>
        validateAdminIdentityLifecycleTransition(
          {
            authenticatedActorUid: ACTIVE_OWNER_PRIMARY.id,
            resolvedActorAdmin: ACTIVE_OWNER_PRIMARY,
            targetUid: ACTIVE_RIGHTS_REVIEWER.id,
            resolvedTargetAdmin: {
              ...ACTIVE_RIGHTS_REVIEWER,
              invitationId: 'inv_reuse_attempt',
            } as unknown as VersionedAdminIdentityRecord,
            expectedRevision: 3,
            transitionType: AdminIdentityLifecycleTransitionType.ChangeRole,
            targetRole: AdminRole.Viewer,
            trustedOwnerState: SINGLE_ACTIVE_OWNER_SNAPSHOT,
          },
          FIXED_CLOCK
        ),
      'IDENTITY_OR_PRIVILEGE_SPOOFING_DETECTED'
    );
  });
});
