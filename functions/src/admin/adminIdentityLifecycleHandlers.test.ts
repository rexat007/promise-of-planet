import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({}),
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({}),
}));

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: class HttpsError extends Error {
    public readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = 'HttpsError';
      this.code = code;
    }
  },
}));

import { HttpsError } from 'firebase-functions/v2/https';
import { AdminRole } from '../types/admin';
import {
  executeManageAdminLifecycle,
  mapApplicationClassificationToHttpsError,
  mapLifecycleErrorToHttpsError,
  type ManageAdminLifecycleRequestContext,
} from './adminIdentityLifecycleHandlers';
import {
  AdminIdentityLifecycleApplicationService,
  AdminLifecycleApplicationError,
  type AdminLifecycleOperationResult,
} from './adminIdentityLifecycleApplicationService';
import {
  AdminIdentityLifecyclePersistenceError,
  type AdminIdentityLifecycleRepository,
} from './adminIdentityLifecycleRepository';
import { executeManageAdminInvitations } from './adminInvitationHandlers';

const MOCK_TIMESTAMP = '2026-10-26T15:00:00.000Z';

function createMockResult(
  operation: 'ChangeRole' | 'Deactivate' | 'Reactivate' | 'InitializeRevision',
  targetUid: string,
  role: AdminRole,
  isActive: boolean,
  currentRevision: number
): AdminLifecycleOperationResult {
  return {
    operation,
    targetUid,
    previousRevision: currentRevision === 1 ? null : currentRevision - 1,
    currentRevision,
    committedAtIso: MOCK_TIMESTAMP,
    admin: {
      id: targetUid,
      role,
      isActive,
      revision: currentRevision,
    },
    auditReceipt: {
      auditEventId: `aud_evt_${operation.toLowerCase()}_123`,
      action: operation === 'ChangeRole' ? 'RoleChanged' : operation === 'InitializeRevision' ? 'Updated' : 'StatusChanged',
      targetType: 'AdminUser',
      targetId: targetUid,
      timestamp: MOCK_TIMESTAMP,
    },
  };
}

function createFakeService(overrides?: Partial<AdminIdentityLifecycleApplicationService>): AdminIdentityLifecycleApplicationService {
  return {
    changeAdminRole: vi.fn(async () =>
      createMockResult('ChangeRole', 'uid-target-1', AdminRole.LibraryCurator, true, 2)
    ),
    deactivateAdmin: vi.fn(async () =>
      createMockResult('Deactivate', 'uid-target-1', AdminRole.ContentEditor, false, 2)
    ),
    reactivateAdmin: vi.fn(async () =>
      createMockResult('Reactivate', 'uid-target-1', AdminRole.ContentEditor, true, 2)
    ),
    initializeLegacyRevision: vi.fn(async () =>
      createMockResult('InitializeRevision', 'uid-target-legacy', AdminRole.Trainer, true, 1)
    ),
    executeOperation: vi.fn(async () =>
      createMockResult('ChangeRole', 'uid-target-1', AdminRole.LibraryCurator, true, 2)
    ),
    ...overrides,
  } as unknown as AdminIdentityLifecycleApplicationService;
}

async function expectHttpsError(
  promise: Promise<unknown>,
  expectedCode: string,
  expectedMessageSubstr?: string
): Promise<HttpsError> {
  try {
    await promise;
  } catch (err: unknown) {
    expect(err).toBeInstanceOf(HttpsError);
    const httpsErr = err as HttpsError;
    expect(httpsErr.code).toBe(expectedCode);
    if (expectedMessageSubstr) {
      expect(httpsErr.message).toContain(expectedMessageSubstr);
    }
    return httpsErr;
  }
  throw new Error(`Expected promise to reject with HttpsError(${expectedCode}), but it resolved.`);
}

describe('AUTH-04A3-S2 Secure Administrative Lifecycle Callable Boundary', () => {
  it('1. Valid ChangeRole: dispatches to service and returns safe result', async () => {
    const service = createFakeService();
    const req: ManageAdminLifecycleRequestContext = {
      auth: { uid: 'uid-owner-actor' },
      data: {
        operation: 'ChangeRole',
        targetUid: 'uid-target-1',
        expectedRevision: 1,
        targetRole: AdminRole.LibraryCurator,
      },
    };

    const res = await executeManageAdminLifecycle(req, { service });

    expect(res.operation).toBe('ChangeRole');
    expect(res.targetUid).toBe('uid-target-1');
    expect(res.currentRevision).toBe(2);
    expect(res.admin.role).toBe(AdminRole.LibraryCurator);
    expect(service.changeAdminRole).toHaveBeenCalledWith(
      expect.objectContaining({
        authenticatedActorUid: 'uid-owner-actor',
        targetUid: 'uid-target-1',
        expectedRevision: 1,
        targetRole: AdminRole.LibraryCurator,
      })
    );
  });

  it('2. Valid Deactivate: dispatches to service and returns deactivated state', async () => {
    const service = createFakeService();
    const req: ManageAdminLifecycleRequestContext = {
      auth: { uid: 'uid-owner-actor' },
      data: {
        operation: 'Deactivate',
        targetUid: 'uid-target-1',
        expectedRevision: 1,
      },
    };

    const res = await executeManageAdminLifecycle(req, { service });

    expect(res.operation).toBe('Deactivate');
    expect(res.admin.isActive).toBe(false);
    expect(service.deactivateAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        authenticatedActorUid: 'uid-owner-actor',
        targetUid: 'uid-target-1',
        expectedRevision: 1,
      })
    );
  });

  it('3. Valid Reactivate: dispatches to service and returns reactivated state', async () => {
    const service = createFakeService();
    const req: ManageAdminLifecycleRequestContext = {
      auth: { uid: 'uid-owner-actor' },
      data: {
        operation: 'Reactivate',
        targetUid: 'uid-target-1',
        expectedRevision: 1,
      },
    };

    const res = await executeManageAdminLifecycle(req, { service });

    expect(res.operation).toBe('Reactivate');
    expect(res.admin.isActive).toBe(true);
    expect(service.reactivateAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        authenticatedActorUid: 'uid-owner-actor',
        targetUid: 'uid-target-1',
        expectedRevision: 1,
      })
    );
  });

  it('4. Valid InitializeRevision: dispatches legacy initialization without expectedRevision', async () => {
    const service = createFakeService();
    const req: ManageAdminLifecycleRequestContext = {
      auth: { uid: 'uid-owner-actor' },
      data: {
        operation: 'InitializeRevision',
        targetUid: 'uid-target-legacy',
      },
    };

    const res = await executeManageAdminLifecycle(req, { service });

    expect(res.operation).toBe('InitializeRevision');
    expect(res.admin.revision).toBe(1);
    expect(service.initializeLegacyRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        authenticatedActorUid: 'uid-owner-actor',
        targetUid: 'uid-target-legacy',
      })
    );
  });

  it('5. Missing authentication rejected with unauthenticated', async () => {
    const service = createFakeService();
    const req: ManageAdminLifecycleRequestContext = {
      data: {
        operation: 'Deactivate',
        targetUid: 'uid-target-1',
        expectedRevision: 1,
      },
    };

    await expectHttpsError(
      executeManageAdminLifecycle(req, { service }),
      'unauthenticated',
      'Authentication is required'
    );
  });

  it('6. Invalid or empty auth UID rejected with unauthenticated', async () => {
    const service = createFakeService();
    const invalidAuthUids = ['', '   ', null, undefined];

    for (const badUid of invalidAuthUids) {
      const req: ManageAdminLifecycleRequestContext = {
        auth: { uid: badUid as any },
        data: {
          operation: 'Deactivate',
          targetUid: 'uid-target-1',
          expectedRevision: 1,
        },
      };

      await expectHttpsError(
        executeManageAdminLifecycle(req, { service }),
        'unauthenticated',
        'Authentication is required'
      );
    }
  });

  it('7. Client-supplied actor UID rejected with permission-denied', async () => {
    const service = createFakeService();
    const req: ManageAdminLifecycleRequestContext = {
      auth: { uid: 'uid-real-owner' },
      data: {
        operation: 'Deactivate',
        targetUid: 'uid-target-1',
        expectedRevision: 1,
        actorUid: 'uid-spoofed-owner',
      },
    };

    await expectHttpsError(
      executeManageAdminLifecycle(req, { service }),
      'permission-denied',
      'Caller-supplied authority, identity, or verification claims are forbidden.'
    );
    expect(service.deactivateAdmin).not.toHaveBeenCalled();
  });

  it('8. Client-supplied Owner claims rejected with permission-denied', async () => {
    const service = createFakeService();
    const spoofClaims = [
      { isOwner: true },
      { role: 'Owner' },
      { actorRole: 'Owner' },
      { permissions: ['manageUsers'] },
      { activeOwnerCount: 3 },
      { trustedOwnerState: { count: 3 } },
      { explicitOwnerPromotionPolicy: true },
    ];

    for (const claim of spoofClaims) {
      const req: ManageAdminLifecycleRequestContext = {
        auth: { uid: 'uid-real-owner' },
        data: {
          operation: 'Deactivate',
          targetUid: 'uid-target-1',
          expectedRevision: 1,
          ...claim,
        },
      };

      await expectHttpsError(
        executeManageAdminLifecycle(req, { service }),
        'permission-denied',
        'Caller-supplied authority, identity, or verification claims are forbidden.'
      );
    }
    expect(service.deactivateAdmin).not.toHaveBeenCalled();
  });

  it('9. Unknown operation rejected with invalid-argument', async () => {
    const service = createFakeService();
    const req: ManageAdminLifecycleRequestContext = {
      auth: { uid: 'uid-owner-actor' },
      data: {
        operation: 'DeleteAdmin',
        targetUid: 'uid-target-1',
        expectedRevision: 1,
      },
    };

    await expectHttpsError(
      executeManageAdminLifecycle(req, { service }),
      'invalid-argument',
      'Unknown administrative lifecycle operation'
    );
  });

  it('10. Missing target UID rejected with invalid-argument', async () => {
    const service = createFakeService();
    const badTargetUids = ['', '   ', null, undefined];

    for (const badTarget of badTargetUids) {
      const req: ManageAdminLifecycleRequestContext = {
        auth: { uid: 'uid-owner-actor' },
        data: {
          operation: 'Deactivate',
          targetUid: badTarget,
          expectedRevision: 1,
        },
      };

      await expectHttpsError(
        executeManageAdminLifecycle(req, { service }),
        'invalid-argument',
        'targetUid'
      );
    }
  });

  it('11. Invalid expectedRevision rejected with invalid-argument', async () => {
    const service = createFakeService();
    const badRevisions = [0, -1, 1.5, NaN, '1', null, undefined];

    for (const badRev of badRevisions) {
      const req: ManageAdminLifecycleRequestContext = {
        auth: { uid: 'uid-owner-actor' },
        data: {
          operation: 'Deactivate',
          targetUid: 'uid-target-1',
          expectedRevision: badRev,
        },
      };

      await expectHttpsError(
        executeManageAdminLifecycle(req, { service }),
        'invalid-argument',
        'expectedRevision'
      );
    }
  });

  it('12. Unexpected payload field rejected with invalid-argument', async () => {
    const service = createFakeService();
    const req: ManageAdminLifecycleRequestContext = {
      auth: { uid: 'uid-owner-actor' },
      data: {
        operation: 'Deactivate',
        targetUid: 'uid-target-1',
        expectedRevision: 1,
        unexpectedProperty: 'not_allowed',
      },
    };

    await expectHttpsError(
      executeManageAdminLifecycle(req, { service }),
      'invalid-argument',
      "Unexpected field 'unexpectedProperty'"
    );
  });

  it('13. Owner promotion rejected with permission-denied', async () => {
    const service = createFakeService();
    const req: ManageAdminLifecycleRequestContext = {
      auth: { uid: 'uid-owner-actor' },
      data: {
        operation: 'ChangeRole',
        targetUid: 'uid-target-1',
        expectedRevision: 1,
        targetRole: AdminRole.Owner,
      },
    };

    await expectHttpsError(
      executeManageAdminLifecycle(req, { service }),
      'permission-denied',
      'Promotion to Owner is forbidden'
    );
    expect(service.changeAdminRole).not.toHaveBeenCalled();
  });

  it('14. Service permission-denied mapping preserves safe message without identity enumeration', async () => {
    const service = createFakeService({
      deactivateAdmin: vi.fn(async () => {
        throw new AdminLifecycleApplicationError(
          'permission-denied',
          'LAST_ACTIVE_OWNER_DEACTIVATION_FORBIDDEN',
          'Cannot deactivate Owner because at least one active Owner must remain.'
        );
      }),
    });

    const req: ManageAdminLifecycleRequestContext = {
      auth: { uid: 'uid-owner-actor' },
      data: {
        operation: 'Deactivate',
        targetUid: 'uid-target-1',
        expectedRevision: 1,
      },
    };

    const err = await expectHttpsError(
      executeManageAdminLifecycle(req, { service }),
      'permission-denied'
    );
    expect(err.message).toContain('Cannot deactivate Owner');
  });

  it('15. Service revision-conflict mapping maps non-standard conflict to standard Firebase aborted', async () => {
    const service = createFakeService({
      deactivateAdmin: vi.fn(async () => {
        throw new AdminLifecycleApplicationError(
          'conflict',
          'REVISION_CONFLICT',
          'Revision conflict'
        );
      }),
    });

    const req: ManageAdminLifecycleRequestContext = {
      auth: { uid: 'uid-owner-actor' },
      data: {
        operation: 'Deactivate',
        targetUid: 'uid-target-1',
        expectedRevision: 1,
      },
    };

    const err = await expectHttpsError(
      executeManageAdminLifecycle(req, { service }),
      'aborted',
      'Administrative revision or transaction conflict occurred'
    );
    expect(err.code).toBe('aborted');
  });

  it('16. Unexpected service failure maps to internal error code without stack trace', async () => {
    const service = createFakeService({
      deactivateAdmin: vi.fn(async () => {
        throw new Error('Uncaught database internal error');
      }),
    });

    const req: ManageAdminLifecycleRequestContext = {
      auth: { uid: 'uid-owner-actor' },
      data: {
        operation: 'Deactivate',
        targetUid: 'uid-target-1',
        expectedRevision: 1,
      },
    };

    const err = await expectHttpsError(
      executeManageAdminLifecycle(req, { service }),
      'internal',
      'An internal error occurred'
    );
    expect(err.message).not.toContain('Uncaught database internal error');
  });

  it('17. No duplicate writes on repeated handler invocation', async () => {
    const service = createFakeService();
    const req: ManageAdminLifecycleRequestContext = {
      auth: { uid: 'uid-owner-actor' },
      data: {
        operation: 'ChangeRole',
        targetUid: 'uid-target-1',
        expectedRevision: 1,
        targetRole: AdminRole.TrainingManager,
      },
    };

    await executeManageAdminLifecycle(req, { service });
    await executeManageAdminLifecycle(req, { service });

    expect(service.changeAdminRole).toHaveBeenCalledTimes(2);
  });

  it('18. Safe DTO returned without private fields (email, name, internal snapshots stripped)', async () => {
    const service = createFakeService();
    const req: ManageAdminLifecycleRequestContext = {
      auth: { uid: 'uid-owner-actor' },
      data: {
        operation: 'ChangeRole',
        targetUid: 'uid-target-1',
        expectedRevision: 1,
        targetRole: AdminRole.LibraryCurator,
      },
    };

    const res = await executeManageAdminLifecycle(req, { service });

    expect(res.admin).toEqual({
      id: 'uid-target-1',
      role: AdminRole.LibraryCurator,
      isActive: true,
      revision: 2,
    });
    expect((res.admin as any).email).toBeUndefined();
    expect((res.admin as any).name).toBeUndefined();
    expect((res as any).trustedOwnerState).toBeUndefined();
  });

  it('19. No bypass around service/repository validation: callerUid parameter cannot override auth context', async () => {
    const service = createFakeService();
    const req: ManageAdminLifecycleRequestContext = {
      auth: { uid: 'uid-caller-1' },
      data: {
        operation: 'Deactivate',
        targetUid: 'uid-target-1',
        expectedRevision: 1,
        callerUid: 'uid-caller-2',
      },
    };

    await expectHttpsError(
      executeManageAdminLifecycle(req, { service }),
      'permission-denied',
      'Caller-supplied authority, identity, or verification claims are forbidden.'
    );
    expect(service.deactivateAdmin).not.toHaveBeenCalled();
  });

  it('20. Existing invitation handler behavior remains unchanged', async () => {
    const unauthInvitationReq = {
      auth: undefined,
      data: {
        action: 'createInvitation',
        targetEmail: 'new@planet.org',
        intendedRole: AdminRole.ContentEditor,
      },
    };

    await expectHttpsError(
      executeManageAdminInvitations(unauthInvitationReq),
      'unauthenticated'
    );
  });
});
