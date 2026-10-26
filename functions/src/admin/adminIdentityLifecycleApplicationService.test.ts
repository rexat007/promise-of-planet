import { describe, expect, it, vi } from 'vitest';

const liveFirestoreMock = vi.fn(() => {
  throw new Error('DIRECT_FIRESTORE_ACCESS_FORBIDDEN: Service must never access Firestore directly.');
});

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => liveFirestoreMock(),
}));

import { AdminRole, type AdminUser } from '../types/admin';
import { AuditAction, AuditTargetType } from '../shared/auditContract';
import {
  AdminIdentityLifecyclePersistenceError,
  type AdminIdentityLifecycleAuditEvent,
  type AdminIdentityLifecycleRepository,
  type ChangeAdminRoleAtomicParams,
  type DeactivateAdminAtomicParams,
  type ExecuteAdminLifecycleTransitionAtomicParams,
  type ExecuteAdminLifecycleTransitionAtomicResult,
  type InitializeLegacyAdminRevisionAtomicParams,
  type InitializeLegacyAdminRevisionAtomicResult,
  type ReactivateAdminAtomicParams,
} from './adminIdentityLifecycleRepository';
import {
  AdminIdentityLifecycleApplicationService,
  AdminLifecycleApplicationError,
  type AdminLifecycleExternalClassification,
} from './adminIdentityLifecycleApplicationService';

const MOCK_CLOCK_ISO = '2026-10-26T15:00:00.000Z';

function createMockAuditEvent(
  auditId: string,
  action: AuditAction,
  targetId: string,
  targetTitle: string
): AdminIdentityLifecycleAuditEvent {
  return {
    id: auditId,
    timestamp: MOCK_CLOCK_ISO,
    actorUserId: 'uid-owner-actor',
    actorName: 'Nadia Owner',
    actorRole: AdminRole.Owner,
    action,
    targetType: AuditTargetType.AdminUser,
    targetId,
    targetTitle,
    changes: [],
    metadata: {
      eventType: 'AdminRoleChanged',
      transitionType: 'ChangeRole',
      targetUid: targetId,
      previousRole: AdminRole.ContentEditor,
      nextRole: AdminRole.LibraryCurator,
      previousIsActive: true,
      nextIsActive: true,
      previousRevision: 1,
      nextRevision: 2,
    },
  };
}

function createMockRepository(overrides?: Partial<AdminIdentityLifecycleRepository>): AdminIdentityLifecycleRepository {
  return {
    executeLifecycleTransitionAtomic: vi.fn(
      async (params: ExecuteAdminLifecycleTransitionAtomicParams): Promise<ExecuteAdminLifecycleTransitionAtomicResult> => {
        return {
          transitionType: params.transitionType,
          actorUid: params.authenticatedActorUid,
          targetUid: params.targetUid,
          previousState: {
            id: params.targetUid,
            name: 'Target Name',
            email: 'target@planet.org',
            role: AdminRole.ContentEditor,
            isActive: true,
            revision: params.expectedRevision,
          },
          currentState: {
            id: params.targetUid,
            name: 'Target Name',
            email: 'target@planet.org',
            role: params.targetRole ?? AdminRole.ContentEditor,
            isActive: params.transitionType === 'Deactivate' ? false : true,
            revision: params.expectedRevision + 1,
          },
          previousRevision: params.expectedRevision,
          currentRevision: params.expectedRevision + 1,
          verifiedActiveOwnerCount: 2,
          committedAtIso: MOCK_CLOCK_ISO,
          auditEvent: createMockAuditEvent(
            params.auditEventId,
            AuditAction.RoleChanged,
            params.targetUid,
            'target@planet.org'
          ),
        };
      }
    ),
    changeAdminRoleAtomic: vi.fn(
      async (params: ChangeAdminRoleAtomicParams): Promise<ExecuteAdminLifecycleTransitionAtomicResult> => {
        return {
          transitionType: 'ChangeRole',
          actorUid: params.authenticatedActorUid,
          targetUid: params.targetUid,
          previousState: {
            id: params.targetUid,
            name: 'Target Name',
            email: 'target@planet.org',
            role: AdminRole.ContentEditor,
            isActive: true,
            revision: params.expectedRevision,
          },
          currentState: {
            id: params.targetUid,
            name: 'Target Name',
            email: 'target@planet.org',
            role: params.targetRole,
            isActive: true,
            revision: params.expectedRevision + 1,
          },
          previousRevision: params.expectedRevision,
          currentRevision: params.expectedRevision + 1,
          verifiedActiveOwnerCount: 2,
          committedAtIso: MOCK_CLOCK_ISO,
          auditEvent: createMockAuditEvent(
            params.auditEventId,
            AuditAction.RoleChanged,
            params.targetUid,
            'target@planet.org'
          ),
        };
      }
    ),
    deactivateAdminAtomic: vi.fn(
      async (params: DeactivateAdminAtomicParams): Promise<ExecuteAdminLifecycleTransitionAtomicResult> => {
        return {
          transitionType: 'Deactivate',
          actorUid: params.authenticatedActorUid,
          targetUid: params.targetUid,
          previousState: {
            id: params.targetUid,
            name: 'Target Name',
            email: 'target@planet.org',
            role: AdminRole.ContentEditor,
            isActive: true,
            revision: params.expectedRevision,
          },
          currentState: {
            id: params.targetUid,
            name: 'Target Name',
            email: 'target@planet.org',
            role: AdminRole.ContentEditor,
            isActive: false,
            revision: params.expectedRevision + 1,
          },
          previousRevision: params.expectedRevision,
          currentRevision: params.expectedRevision + 1,
          verifiedActiveOwnerCount: 2,
          committedAtIso: MOCK_CLOCK_ISO,
          auditEvent: createMockAuditEvent(
            params.auditEventId,
            AuditAction.StatusChanged,
            params.targetUid,
            'target@planet.org'
          ),
        };
      }
    ),
    reactivateAdminAtomic: vi.fn(
      async (params: ReactivateAdminAtomicParams): Promise<ExecuteAdminLifecycleTransitionAtomicResult> => {
        return {
          transitionType: 'Reactivate',
          actorUid: params.authenticatedActorUid,
          targetUid: params.targetUid,
          previousState: {
            id: params.targetUid,
            name: 'Target Name',
            email: 'target@planet.org',
            role: AdminRole.ContentEditor,
            isActive: false,
            revision: params.expectedRevision,
          },
          currentState: {
            id: params.targetUid,
            name: 'Target Name',
            email: 'target@planet.org',
            role: AdminRole.ContentEditor,
            isActive: true,
            revision: params.expectedRevision + 1,
          },
          previousRevision: params.expectedRevision,
          currentRevision: params.expectedRevision + 1,
          verifiedActiveOwnerCount: 2,
          committedAtIso: MOCK_CLOCK_ISO,
          auditEvent: createMockAuditEvent(
            params.auditEventId,
            AuditAction.StatusChanged,
            params.targetUid,
            'target@planet.org'
          ),
        };
      }
    ),
    initializeLegacyAdminRevisionAtomic: vi.fn(
      async (params: InitializeLegacyAdminRevisionAtomicParams): Promise<InitializeLegacyAdminRevisionAtomicResult> => {
        return {
          transitionType: 'InitializeRevision',
          actorUid: params.authenticatedActorUid,
          targetUid: params.targetUid,
          initializedState: {
            id: params.targetUid,
            name: 'Legacy Admin',
            email: 'legacy@planet.org',
            role: AdminRole.Trainer,
            isActive: true,
            revision: 1,
          },
          previousRevision: null,
          currentRevision: 1,
          committedAtIso: MOCK_CLOCK_ISO,
          auditEvent: createMockAuditEvent(
            params.auditEventId,
            AuditAction.Updated,
            params.targetUid,
            'legacy@planet.org'
          ),
        };
      }
    ),
    ...overrides,
  };
}

async function expectAppError(
  promise: Promise<unknown>,
  expectedClassification: AdminLifecycleExternalClassification,
  expectedInternalCode?: string
): Promise<AdminLifecycleApplicationError> {
  try {
    await promise;
  } catch (err: unknown) {
    expect(err).toBeInstanceOf(AdminLifecycleApplicationError);
    const typed = err as AdminLifecycleApplicationError;
    expect(typed.classification).toBe(expectedClassification);
    if (expectedInternalCode) {
      expect(typed.internalCode).toBe(expectedInternalCode);
    }
    return typed;
  }
  throw new Error(`Expected promise to reject with AdminLifecycleApplicationError(${expectedClassification}), but it resolved.`);
}

describe('AUTH-04A3-S1 AdminIdentityLifecycleApplicationService', () => {
  it('1. ChangeRole: validates boundary, delegates to repository, and returns minimal sanitized DTO without leakage', async () => {
    const mockRepo = createMockRepository();
    const service = new AdminIdentityLifecycleApplicationService({
      repository: mockRepo,
      clock: () => new Date(MOCK_CLOCK_ISO),
      generateAuditEventId: () => 'aud_fixed_test_id_123',
    });

    const result = await service.changeAdminRole({
      authenticatedActorUid: 'uid-owner-actor',
      targetUid: 'uid-target-editor',
      expectedRevision: 1,
      targetRole: AdminRole.LibraryCurator,
    });

    expect(result.operation).toBe('ChangeRole');
    expect(result.targetUid).toBe('uid-target-editor');
    expect(result.previousRevision).toBe(1);
    expect(result.currentRevision).toBe(2);
    expect(result.committedAtIso).toBe(MOCK_CLOCK_ISO);

    // Verify minimal sanitized admin state (no email, name, timestamps or extra fields)
    expect(result.admin).toEqual({
      id: 'uid-target-editor',
      role: AdminRole.LibraryCurator,
      isActive: true,
      revision: 2,
    });
    expect((result.admin as any).email).toBeUndefined();
    expect((result.admin as any).name).toBeUndefined();

    // Verify sanitized audit receipt
    expect(result.auditReceipt).toEqual({
      auditEventId: 'aud_fixed_test_id_123',
      action: AuditAction.RoleChanged,
      targetType: AuditTargetType.AdminUser,
      targetId: 'uid-target-editor',
      timestamp: MOCK_CLOCK_ISO,
    });

    // Ensure repository was called with exact boundary inputs
    expect(mockRepo.changeAdminRoleAtomic).toHaveBeenCalledTimes(1);
    expect(mockRepo.changeAdminRoleAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        auditEventId: 'aud_fixed_test_id_123',
        authenticatedActorUid: 'uid-owner-actor',
        targetUid: 'uid-target-editor',
        expectedRevision: 1,
        targetRole: AdminRole.LibraryCurator,
      })
    );
  });

  it('2. Deactivate: delegates to repository and returns sanitized deactivated state', async () => {
    const mockRepo = createMockRepository();
    const service = new AdminIdentityLifecycleApplicationService({
      repository: mockRepo,
      clock: () => new Date(MOCK_CLOCK_ISO),
      generateAuditEventId: () => 'aud_deact_test_id',
    });

    const result = await service.deactivateAdmin({
      authenticatedActorUid: 'uid-owner-actor',
      targetUid: 'uid-target-editor',
      expectedRevision: 2,
    });

    expect(result.operation).toBe('Deactivate');
    expect(result.currentRevision).toBe(3);
    expect(result.admin.isActive).toBe(false);
    expect(result.auditReceipt.auditEventId).toBe('aud_deact_test_id');
    expect(mockRepo.deactivateAdminAtomic).toHaveBeenCalledTimes(1);
  });

  it('3. Reactivate: delegates to repository and returns sanitized reactivated state', async () => {
    const mockRepo = createMockRepository();
    const service = new AdminIdentityLifecycleApplicationService({
      repository: mockRepo,
      clock: () => new Date(MOCK_CLOCK_ISO),
      generateAuditEventId: () => 'aud_react_test_id',
    });

    const result = await service.reactivateAdmin({
      authenticatedActorUid: 'uid-owner-actor',
      targetUid: 'uid-target-editor',
      expectedRevision: 3,
    });

    expect(result.operation).toBe('Reactivate');
    expect(result.currentRevision).toBe(4);
    expect(result.admin.isActive).toBe(true);
    expect(result.auditReceipt.auditEventId).toBe('aud_react_test_id');
    expect(mockRepo.reactivateAdminAtomic).toHaveBeenCalledTimes(1);
  });

  it('4. InitializeRevision: explicitly invokes legacy revision initialization without expectedRevision', async () => {
    const mockRepo = createMockRepository();
    const service = new AdminIdentityLifecycleApplicationService({
      repository: mockRepo,
      clock: () => new Date(MOCK_CLOCK_ISO),
      generateAuditEventId: () => 'aud_init_test_id',
    });

    const result = await service.initializeLegacyRevision({
      authenticatedActorUid: 'uid-owner-actor',
      targetUid: 'uid-target-legacy',
    });

    expect(result.operation).toBe('InitializeRevision');
    expect(result.previousRevision).toBeNull();
    expect(result.currentRevision).toBe(1);
    expect(result.admin.revision).toBe(1);
    expect(mockRepo.initializeLegacyAdminRevisionAtomic).toHaveBeenCalledTimes(1);
    expect(mockRepo.initializeLegacyAdminRevisionAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        auditEventId: 'aud_init_test_id',
        authenticatedActorUid: 'uid-owner-actor',
        targetUid: 'uid-target-legacy',
      })
    );
  });

  it('5. executeOperation unified dispatcher handles all four operations', async () => {
    const mockRepo = createMockRepository();
    const service = new AdminIdentityLifecycleApplicationService({
      repository: mockRepo,
    });

    const res1 = await service.executeOperation({
      authenticatedActorUid: 'uid-owner-actor',
      operation: 'ChangeRole',
      targetUid: 'uid-target-1',
      expectedRevision: 1,
      targetRole: AdminRole.TrainingManager,
    });
    expect(res1.operation).toBe('ChangeRole');

    const res2 = await service.executeOperation({
      authenticatedActorUid: 'uid-owner-actor',
      operation: 'Deactivate',
      targetUid: 'uid-target-1',
      expectedRevision: 2,
    });
    expect(res2.operation).toBe('Deactivate');

    const res3 = await service.executeOperation({
      authenticatedActorUid: 'uid-owner-actor',
      operation: 'Reactivate',
      targetUid: 'uid-target-1',
      expectedRevision: 3,
    });
    expect(res3.operation).toBe('Reactivate');

    const res4 = await service.executeOperation({
      authenticatedActorUid: 'uid-owner-actor',
      operation: 'InitializeRevision',
      targetUid: 'uid-target-legacy',
    });
    expect(res4.operation).toBe('InitializeRevision');
  });

  it('6. Rejects unknown operations and malformed UIDs', async () => {
    const mockRepo = createMockRepository();
    const service = new AdminIdentityLifecycleApplicationService({ repository: mockRepo });

    await expectAppError(
      service.executeOperation({
        authenticatedActorUid: 'uid-owner-actor',
        operation: 'PromoteToSuperAdmin' as any,
        targetUid: 'uid-target-1',
      }),
      'invalid-argument',
      'UNKNOWN_OPERATION'
    );

    await expectAppError(
      service.changeAdminRole({
        authenticatedActorUid: 'uid-owner-actor',
        targetUid: '   ',
        expectedRevision: 1,
        targetRole: AdminRole.Trainer,
      }),
      'invalid-argument',
      'INVALID_TARGET_UID'
    );

    await expectAppError(
      service.changeAdminRole({
        authenticatedActorUid: '   ',
        targetUid: 'uid-target-1',
        expectedRevision: 1,
        targetRole: AdminRole.Trainer,
      }),
      'unauthenticated',
      'UNAUTHENTICATED_ACTOR'
    );
  });

  it('7. Rejects malformed or missing expectedRevision where required', async () => {
    const mockRepo = createMockRepository();
    const service = new AdminIdentityLifecycleApplicationService({ repository: mockRepo });

    const badRevisions = [0, -1, 1.5, NaN, '1', null, undefined];
    for (const badRev of badRevisions) {
      await expectAppError(
        service.changeAdminRole({
          authenticatedActorUid: 'uid-owner-actor',
          targetUid: 'uid-target-1',
          expectedRevision: badRev as any,
          targetRole: AdminRole.Trainer,
        }),
        'invalid-argument',
        'INVALID_REVISION'
      );
    }
  });

  it('8. Rejects client authority spoofing and unexpected fields in untrusted payload', async () => {
    const mockRepo = createMockRepository();
    const service = new AdminIdentityLifecycleApplicationService({ repository: mockRepo });

    const spoofKeys = [
      'actorUid',
      'callerUid',
      'uid',
      'isOwner',
      'permissions',
      'activeOwnerCount',
      'trustedOwnerState',
      'explicitOwnerPromotionPolicy',
      'token',
      'password',
    ];

    for (const spoofKey of spoofKeys) {
      await expectAppError(
        service.changeAdminRole({
          authenticatedActorUid: 'uid-owner-actor',
          targetUid: 'uid-target-1',
          expectedRevision: 1,
          targetRole: AdminRole.Trainer,
          untrustedClientPayload: {
            operation: 'ChangeRole',
            targetUid: 'uid-target-1',
            expectedRevision: 1,
            targetRole: AdminRole.Trainer,
            [spoofKey]: 'malicious_claim',
          },
        }),
        'permission-denied',
        'IDENTITY_OR_PRIVILEGE_SPOOFING_DETECTED'
      );
    }

    // Unexpected property
    await expectAppError(
      service.deactivateAdmin({
        authenticatedActorUid: 'uid-owner-actor',
        targetUid: 'uid-target-1',
        expectedRevision: 1,
        untrustedClientPayload: {
          operation: 'Deactivate',
          targetUid: 'uid-target-1',
          expectedRevision: 1,
          unexpectedExtraField: 'bad',
        },
      }),
      'invalid-argument',
      'UNEXPECTED_PAYLOAD_FIELD'
    );
  });

  it('9. Rejects Owner promotion at the application boundary', async () => {
    const mockRepo = createMockRepository();
    const service = new AdminIdentityLifecycleApplicationService({ repository: mockRepo });

    await expectAppError(
      service.changeAdminRole({
        authenticatedActorUid: 'uid-owner-actor',
        targetUid: 'uid-target-1',
        expectedRevision: 1,
        targetRole: AdminRole.Owner,
      }),
      'permission-denied',
      'OWNER_PROMOTION_POLICY_NOT_ESTABLISHED'
    );

    expect(mockRepo.changeAdminRoleAtomic).not.toHaveBeenCalled();
  });

  it('10. Repository permission failures fail closed with permission-denied without identity leakage', async () => {
    const permissionErrors = [
      'UNAUTHORIZED_ACTOR',
      'INACTIVE_ACTOR',
      'SELF_DEACTIVATION_FORBIDDEN',
      'SELF_DEMOTION_FORBIDDEN',
      'LAST_ACTIVE_OWNER_DEACTIVATION_FORBIDDEN',
      'LAST_ACTIVE_OWNER_DEMOTION_FORBIDDEN',
    ] as const;

    for (const code of permissionErrors) {
      const mockRepo = createMockRepository({
        deactivateAdminAtomic: vi.fn(async () => {
          throw new AdminIdentityLifecyclePersistenceError(code, `Persistence rejected: ${code}`);
        }),
      });
      const service = new AdminIdentityLifecycleApplicationService({ repository: mockRepo });

      const err = await expectAppError(
        service.deactivateAdmin({
          authenticatedActorUid: 'uid-actor',
          targetUid: 'uid-target',
          expectedRevision: 1,
        }),
        'permission-denied',
        code
      );
      expect(err.message).toBe('Caller is not authorized to execute this administrative lifecycle operation.');
    }
  });

  it('11. Target not found maps to not-found', async () => {
    const mockRepo = createMockRepository({
      deactivateAdminAtomic: vi.fn(async () => {
        throw new AdminIdentityLifecyclePersistenceError('TARGET_ADMIN_NOT_FOUND', 'Target not found in admins/{uid}');
      }),
    });
    const service = new AdminIdentityLifecycleApplicationService({ repository: mockRepo });

    await expectAppError(
      service.deactivateAdmin({
        authenticatedActorUid: 'uid-owner',
        targetUid: 'uid-non-existent',
        expectedRevision: 1,
      }),
      'not-found',
      'TARGET_ADMIN_NOT_FOUND'
    );
  });

  it('12. Stale revision conflict maps to conflict classification', async () => {
    const mockRepo = createMockRepository({
      changeAdminRoleAtomic: vi.fn(async () => {
        throw new AdminIdentityLifecyclePersistenceError('REVISION_CONFLICT', 'Expected revision 1 but got 2');
      }),
    });
    const service = new AdminIdentityLifecycleApplicationService({ repository: mockRepo });

    await expectAppError(
      service.changeAdminRole({
        authenticatedActorUid: 'uid-owner',
        targetUid: 'uid-target',
        expectedRevision: 1,
        targetRole: AdminRole.Trainer,
      }),
      'conflict',
      'REVISION_CONFLICT'
    );
  });

  it('13. Precondition failures (already active, already inactive, no-op, already initialized) map to failed-precondition', async () => {
    const preconditionCodes = [
      'ALREADY_INACTIVE',
      'ALREADY_ACTIVE',
      'NO_OP_TRANSITION',
      'REVISION_ALREADY_INITIALIZED',
    ] as const;

    for (const code of preconditionCodes) {
      const mockRepo = createMockRepository({
        deactivateAdminAtomic: vi.fn(async () => {
          throw new AdminIdentityLifecyclePersistenceError(code, `Precondition: ${code}`);
        }),
      });
      const service = new AdminIdentityLifecycleApplicationService({ repository: mockRepo });

      await expectAppError(
        service.deactivateAdmin({
          authenticatedActorUid: 'uid-owner',
          targetUid: 'uid-target',
          expectedRevision: 1,
        }),
        'failed-precondition',
        code
      );
    }
  });

  it('14. Internal and unexpected errors map to internal classification', async () => {
    const mockRepo = createMockRepository({
      deactivateAdminAtomic: vi.fn(async () => {
        throw new Error('Database connection broke');
      }),
    });
    const service = new AdminIdentityLifecycleApplicationService({ repository: mockRepo });

    await expectAppError(
      service.deactivateAdmin({
        authenticatedActorUid: 'uid-owner',
        targetUid: 'uid-target',
        expectedRevision: 1,
      }),
      'internal',
      'INTERNAL_ERROR'
    );
  });

  it('15. Service calls only the transactional repository and never invokes Firestore directly', async () => {
    const mockRepo = createMockRepository();
    const service = new AdminIdentityLifecycleApplicationService({ repository: mockRepo });

    await service.changeAdminRole({
      authenticatedActorUid: 'uid-owner-actor',
      targetUid: 'uid-target-1',
      expectedRevision: 1,
      targetRole: AdminRole.Trainer,
    });

    expect(liveFirestoreMock).not.toHaveBeenCalled();
    expect(mockRepo.changeAdminRoleAtomic).toHaveBeenCalledTimes(1);
  });
});
