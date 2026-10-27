import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetFunctions,
  mockHttpsCallable,
  mockFirebaseState,
} = vi.hoisted(() => ({
  mockGetFunctions: vi.fn(() => ({ name: 'mock-functions-instance' })),
  mockHttpsCallable: vi.fn(),
  mockFirebaseState: {
    isFirebaseConfigured: true,
    app: { name: '[DEFAULT]' } as unknown,
    auth: {
      currentUser: {
        uid: 'owner_session_uid_01',
        email: 'owner@promiseofplanet.org',
        emailVerified: true,
      },
    } as {
      currentUser: {
        uid: string;
        email?: string;
        emailVerified?: boolean;
      } | null;
    } | null,
  },
}));

vi.mock('firebase/functions', () => ({
  getFunctions: mockGetFunctions,
  httpsCallable: mockHttpsCallable,
}));

vi.mock('./firebase', () => ({
  get isFirebaseConfigured() {
    return mockFirebaseState.isFirebaseConfigured;
  },
  get app() {
    return mockFirebaseState.app;
  },
  get auth() {
    return mockFirebaseState.auth;
  },
}));

import {
  AdminIdentityClientError,
  AdminIdentityManagementClient,
  AdminRole,
  changeAdminRole,
  deactivateAdmin,
  initializeAdminRevision,
  listAdminUsers,
  manageAdminLifecycle,
  reactivateAdmin,
  type AdminIdentityClientDependencies,
  type AdminLifecycleClientResponse,
} from './adminIdentityManagementClient';

const SAMPLE_TARGET_UID = 'target_admin_uid_42';

const SAMPLE_LIFECYCLE_RESPONSE: AdminLifecycleClientResponse = {
  operation: 'ChangeRole',
  targetUid: SAMPLE_TARGET_UID,
  previousRevision: 2,
  currentRevision: 3,
  committedAtIso: '2026-10-27T08:00:00.000Z',
  admin: {
    id: SAMPLE_TARGET_UID,
    role: AdminRole.CitizenModerator,
    isActive: true,
    revision: 3,
  },
  auditReceipt: {
    auditEventId: 'aud_life_0123456789abcdef0123456789abcdef',
    action: 'ChangeRole',
    targetType: 'admin_identity',
    targetId: SAMPLE_TARGET_UID,
    timestamp: '2026-10-27T08:00:00.000Z',
  },
};

function createTestDeps(
  overrides: Partial<AdminIdentityClientDependencies> = {}
): AdminIdentityClientDependencies {
  return {
    isBackendConfigured: () => true,
    getAuthenticatedUid: () => 'owner_session_uid_01',
    ...overrides,
  };
}

describe('AUTH-04A4-S1 — Admin Lifecycle Client Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    AdminIdentityManagementClient.resetRuntimeOverrides();
    mockFirebaseState.isFirebaseConfigured = true;
    mockFirebaseState.app = { name: '[DEFAULT]' };
    mockFirebaseState.auth = {
      currentUser: {
        uid: 'owner_session_uid_01',
        email: 'owner@promiseofplanet.org',
        emailVerified: true,
      },
    };
  });

  afterEach(() => {
    AdminIdentityManagementClient.resetRuntimeOverrides();
  });

  describe('1. Exact callable name and transport registration', () => {
    it('invokes exact callable name manageAdminLifecycle via generic invokeCallable', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        data: SAMPLE_LIFECYCLE_RESPONSE,
      });

      const result = await changeAdminRole(
        {
          targetUid: SAMPLE_TARGET_UID,
          expectedRevision: 2,
          targetRole: AdminRole.CitizenModerator,
        },
        createTestDeps({ invokeCallable: mockInvoke })
      );

      expect(mockInvoke).toHaveBeenCalledTimes(1);
      expect(mockInvoke).toHaveBeenCalledWith('manageAdminLifecycle', {
        operation: 'ChangeRole',
        targetUid: SAMPLE_TARGET_UID,
        expectedRevision: 2,
        targetRole: AdminRole.CitizenModerator,
      });
      expect(result).toEqual(SAMPLE_LIFECYCLE_RESPONSE);
    });

    it('invokes exact callable name manageAdminLifecycle via httpsCallable fallback', async () => {
      const mockCallableFn = vi.fn().mockResolvedValue({
        data: SAMPLE_LIFECYCLE_RESPONSE,
      });
      mockHttpsCallable.mockReturnValue(mockCallableFn);

      const result = await changeAdminRole(
        {
          targetUid: SAMPLE_TARGET_UID,
          expectedRevision: 2,
          targetRole: AdminRole.CitizenModerator,
        },
        createTestDeps()
      );

      expect(mockHttpsCallable).toHaveBeenCalledWith(
        expect.anything(),
        'manageAdminLifecycle'
      );
      expect(mockCallableFn).toHaveBeenCalledWith({
        operation: 'ChangeRole',
        targetUid: SAMPLE_TARGET_UID,
        expectedRevision: 2,
        targetRole: AdminRole.CitizenModerator,
      });
      expect(result).toEqual(SAMPLE_LIFECYCLE_RESPONSE);
    });
  });

  describe('2. Exact operation payloads for all four operations', () => {
    it('dispatches exact payload for ChangeRole', async () => {
      const lifecycleCallable = vi.fn().mockResolvedValue({
        data: SAMPLE_LIFECYCLE_RESPONSE,
      });

      await changeAdminRole(
        {
          targetUid: SAMPLE_TARGET_UID,
          expectedRevision: 2,
          targetRole: AdminRole.CitizenModerator,
        },
        createTestDeps({ manageAdminLifecycleCallable: lifecycleCallable })
      );

      expect(lifecycleCallable).toHaveBeenCalledWith({
        operation: 'ChangeRole',
        targetUid: SAMPLE_TARGET_UID,
        expectedRevision: 2,
        targetRole: AdminRole.CitizenModerator,
      });
    });

    it('dispatches exact payload for Deactivate', async () => {
      const deactivateResponse: AdminLifecycleClientResponse = {
        operation: 'Deactivate',
        targetUid: SAMPLE_TARGET_UID,
        previousRevision: 2,
        currentRevision: 3,
        committedAtIso: '2026-10-27T08:00:00.000Z',
        admin: {
          id: SAMPLE_TARGET_UID,
          role: AdminRole.ContentEditor,
          isActive: false,
          revision: 3,
        },
        auditReceipt: {
          auditEventId: 'aud_life_0123456789abcdef0123456789abcdef',
          action: 'Deactivate',
          targetType: 'admin_identity',
          targetId: SAMPLE_TARGET_UID,
          timestamp: '2026-10-27T08:00:00.000Z',
        },
      };

      const lifecycleCallable = vi.fn().mockResolvedValue({
        data: deactivateResponse,
      });

      const result = await deactivateAdmin(
        {
          targetUid: SAMPLE_TARGET_UID,
          expectedRevision: 2,
        },
        createTestDeps({ manageAdminLifecycleCallable: lifecycleCallable })
      );

      expect(lifecycleCallable).toHaveBeenCalledWith({
        operation: 'Deactivate',
        targetUid: SAMPLE_TARGET_UID,
        expectedRevision: 2,
      });
      expect(result.admin.isActive).toBe(false);
      expect(result.currentRevision).toBe(3);
    });

    it('dispatches exact payload for Reactivate', async () => {
      const reactivateResponse: AdminLifecycleClientResponse = {
        operation: 'Reactivate',
        targetUid: SAMPLE_TARGET_UID,
        previousRevision: 3,
        currentRevision: 4,
        committedAtIso: '2026-10-27T08:00:00.000Z',
        admin: {
          id: SAMPLE_TARGET_UID,
          role: AdminRole.ContentEditor,
          isActive: true,
          revision: 4,
        },
        auditReceipt: {
          auditEventId: 'aud_life_0123456789abcdef0123456789abcdef',
          action: 'Reactivate',
          targetType: 'admin_identity',
          targetId: SAMPLE_TARGET_UID,
          timestamp: '2026-10-27T08:00:00.000Z',
        },
      };

      const lifecycleCallable = vi.fn().mockResolvedValue({
        data: reactivateResponse,
      });

      const result = await reactivateAdmin(
        {
          targetUid: SAMPLE_TARGET_UID,
          expectedRevision: 3,
        },
        createTestDeps({ manageAdminLifecycleCallable: lifecycleCallable })
      );

      expect(lifecycleCallable).toHaveBeenCalledWith({
        operation: 'Reactivate',
        targetUid: SAMPLE_TARGET_UID,
        expectedRevision: 3,
      });
      expect(result.admin.isActive).toBe(true);
      expect(result.currentRevision).toBe(4);
    });

    it('dispatches exact payload for InitializeRevision', async () => {
      const initializeResponse: AdminLifecycleClientResponse = {
        operation: 'InitializeRevision',
        targetUid: SAMPLE_TARGET_UID,
        previousRevision: null,
        currentRevision: 1,
        committedAtIso: '2026-10-27T08:00:00.000Z',
        admin: {
          id: SAMPLE_TARGET_UID,
          role: AdminRole.LibraryCurator,
          isActive: true,
          revision: 1,
        },
        auditReceipt: {
          auditEventId: 'aud_life_0123456789abcdef0123456789abcdef',
          action: 'InitializeRevision',
          targetType: 'admin_identity',
          targetId: SAMPLE_TARGET_UID,
          timestamp: '2026-10-27T08:00:00.000Z',
        },
      };

      const lifecycleCallable = vi.fn().mockResolvedValue({
        data: initializeResponse,
      });

      const result = await initializeAdminRevision(
        {
          targetUid: SAMPLE_TARGET_UID,
        },
        createTestDeps({ manageAdminLifecycleCallable: lifecycleCallable })
      );

      expect(lifecycleCallable).toHaveBeenCalledWith({
        operation: 'InitializeRevision',
        targetUid: SAMPLE_TARGET_UID,
      });
      expect(result.previousRevision).toBeNull();
      expect(result.currentRevision).toBe(1);
    });
  });

  describe('3. Preflight input validation: expectedRevision must be safe positive integer', () => {
    it('rejects invalid expectedRevision before calling server', async () => {
      const invalidRevisions = [
        0,
        -1,
        -100,
        1.5,
        NaN,
        Infinity,
        -Infinity,
        Number.MAX_SAFE_INTEGER + 10,
        '1',
        null,
        undefined,
        {},
      ];

      for (const rev of invalidRevisions) {
        const mockCallable = vi.fn();

        await expect(
          changeAdminRole(
            {
              targetUid: SAMPLE_TARGET_UID,
              expectedRevision: rev as unknown as number,
              targetRole: AdminRole.CitizenModerator,
            },
            createTestDeps({ manageAdminLifecycleCallable: mockCallable })
          )
        ).rejects.toMatchObject({
          name: 'AdminIdentityClientError',
          code: 'invalid-argument',
          reason: 'INVALID_ARGUMENT',
        });

        await expect(
          deactivateAdmin(
            {
              targetUid: SAMPLE_TARGET_UID,
              expectedRevision: rev as unknown as number,
            },
            createTestDeps({ manageAdminLifecycleCallable: mockCallable })
          )
        ).rejects.toMatchObject({
          name: 'AdminIdentityClientError',
          code: 'invalid-argument',
          reason: 'INVALID_ARGUMENT',
        });

        await expect(
          reactivateAdmin(
            {
              targetUid: SAMPLE_TARGET_UID,
              expectedRevision: rev as unknown as number,
            },
            createTestDeps({ manageAdminLifecycleCallable: mockCallable })
          )
        ).rejects.toMatchObject({
          name: 'AdminIdentityClientError',
          code: 'invalid-argument',
          reason: 'INVALID_ARGUMENT',
        });

        expect(mockCallable).not.toHaveBeenCalled();
      }
    });
  });

  describe('4. Preflight input validation: targetUid validation', () => {
    it('rejects empty, untrimmed, or non-canonical target UIDs before calling server', async () => {
      const invalidUids = [
        '',
        '   ',
        ' uid_with_spaces ',
        'uid with spaces',
        null,
        undefined,
        123,
        {},
      ];

      for (const uid of invalidUids) {
        const mockCallable = vi.fn();

        await expect(
          deactivateAdmin(
            {
              targetUid: uid as unknown as string,
              expectedRevision: 1,
            },
            createTestDeps({ manageAdminLifecycleCallable: mockCallable })
          )
        ).rejects.toMatchObject({
          name: 'AdminIdentityClientError',
          code: 'invalid-argument',
          reason: 'INVALID_ARGUMENT',
        });

        expect(mockCallable).not.toHaveBeenCalled();
      }
    });
  });

  describe('5. Owner promotion rejected', () => {
    it('rejects promotion to Owner at the client boundary before calling server', async () => {
      const mockCallable = vi.fn();

      await expect(
        changeAdminRole(
          {
            targetUid: SAMPLE_TARGET_UID,
            expectedRevision: 1,
            targetRole: AdminRole.Owner,
          },
          createTestDeps({ manageAdminLifecycleCallable: mockCallable })
        )
      ).rejects.toMatchObject({
        name: 'AdminIdentityClientError',
        code: 'permission-denied',
        reason: 'OWNER_PROMOTION_FORBIDDEN',
      });

      expect(mockCallable).not.toHaveBeenCalled();
    });
  });

  describe('6. Spoofed authority claims and unexpected fields rejected', () => {
    it('rejects callerUid, actorUid, role claims, and extra fields before calling server', async () => {
      const spoofInputs = [
        {
          targetUid: SAMPLE_TARGET_UID,
          expectedRevision: 1,
          targetRole: AdminRole.CitizenModerator,
          actorUid: 'spoofed_owner_uid',
        },
        {
          targetUid: SAMPLE_TARGET_UID,
          expectedRevision: 1,
          targetRole: AdminRole.CitizenModerator,
          isOwner: true,
        },
        {
          targetUid: SAMPLE_TARGET_UID,
          expectedRevision: 1,
          targetRole: AdminRole.CitizenModerator,
          permissions: ['ALL'],
        },
        {
          targetUid: SAMPLE_TARGET_UID,
          expectedRevision: 1,
          targetRole: AdminRole.CitizenModerator,
          token: 'forged_bearer_token',
        },
        {
          targetUid: SAMPLE_TARGET_UID,
          expectedRevision: 1,
          targetRole: AdminRole.CitizenModerator,
          activeOwnerCount: 5,
        },
      ];

      for (const input of spoofInputs) {
        const mockCallable = vi.fn();

        await expect(
          changeAdminRole(
            input as unknown as {
              targetUid: string;
              expectedRevision: number;
              targetRole: AdminRole;
            },
            createTestDeps({ manageAdminLifecycleCallable: mockCallable })
          )
        ).rejects.toMatchObject({
          name: 'AdminIdentityClientError',
          code: 'permission-denied',
          reason: 'SPOOFED_AUTHORITY_REJECTED',
        });

        expect(mockCallable).not.toHaveBeenCalled();
      }

      // Unexpected non-spoof fields rejected as invalid-argument
      const mockCallable = vi.fn();
      await expect(
        changeAdminRole(
          {
            targetUid: SAMPLE_TARGET_UID,
            expectedRevision: 1,
            targetRole: AdminRole.CitizenModerator,
            unrelatedRandomField: 'foo',
          } as unknown as {
            targetUid: string;
            expectedRevision: number;
            targetRole: AdminRole;
          },
          createTestDeps({ manageAdminLifecycleCallable: mockCallable })
        )
      ).rejects.toMatchObject({
        name: 'AdminIdentityClientError',
        code: 'invalid-argument',
        reason: 'INVALID_ARGUMENT',
      });
      expect(mockCallable).not.toHaveBeenCalled();
    });
  });

  describe('7. InitializeRevision is never invoked automatically', () => {
    it('fails closed when expectedRevision is missing or causes conflict without automatically invoking InitializeRevision', async () => {
      const mockLifecycle = vi.fn().mockRejectedValue({
        code: 'functions/aborted',
        message: 'Administrative revision or transaction conflict occurred',
      });

      await expect(
        deactivateAdmin(
          {
            targetUid: SAMPLE_TARGET_UID,
            expectedRevision: 5,
          },
          createTestDeps({ manageAdminLifecycleCallable: mockLifecycle })
        )
      ).rejects.toMatchObject({
        name: 'AdminIdentityClientError',
        code: 'aborted',
        reason: 'REVISION_CONFLICT',
      });

      // Verify only 1 call was made with Deactivate, NEVER an automatic fallback to InitializeRevision
      expect(mockLifecycle).toHaveBeenCalledTimes(1);
      expect(mockLifecycle).toHaveBeenCalledWith({
        operation: 'Deactivate',
        targetUid: SAMPLE_TARGET_UID,
        expectedRevision: 5,
      });
    });
  });

  describe('8. Server error sanitization and fail-closed handling', () => {
    it('sanitizes and maps all standard and non-standard Firebase callable errors safely', async () => {
      const errorCases = [
        {
          rawCode: 'functions/unauthenticated',
          rawMessage: 'Authentication is required at /workspace/functions/src/index.ts:25',
          expectedCode: 'unauthenticated',
          expectedReason: 'UNAUTHENTICATED_SESSION',
        },
        {
          rawCode: 'permission-denied',
          rawMessage: 'Caller not authorized at admins/target_uid',
          expectedCode: 'permission-denied',
          expectedReason: 'PERMISSION_DENIED',
        },
        {
          rawCode: 'functions/invalid-argument',
          rawMessage: 'Invalid arguments passed to Cloud Function',
          expectedCode: 'invalid-argument',
          expectedReason: 'INVALID_ARGUMENT',
        },
        {
          rawCode: 'functions/not-found',
          rawMessage: 'Target administrative identity not found',
          expectedCode: 'not-found',
          expectedReason: 'TARGET_NOT_FOUND',
        },
        {
          rawCode: 'functions/failed-precondition',
          rawMessage: 'Administrative lifecycle state precondition failed',
          expectedCode: 'failed-precondition',
          expectedReason: 'FAILED_PRECONDITION',
        },
        {
          rawCode: 'functions/aborted',
          rawMessage: 'Revision conflict',
          expectedCode: 'aborted',
          expectedReason: 'REVISION_CONFLICT',
        },
        {
          rawCode: 'functions/unavailable',
          rawMessage: 'Service temporarily down',
          expectedCode: 'unavailable',
          expectedReason: 'SERVICE_UNAVAILABLE',
        },
        {
          rawCode: 'functions/internal',
          rawMessage: 'Internal error in Firestore at line 42\n    at internalFunction (/app/applet/node_modules/...)',
          expectedCode: 'internal',
          expectedReason: 'INTERNAL_ERROR',
        },
      ];

      for (const item of errorCases) {
        const mockCallable = vi.fn().mockRejectedValue({
          code: item.rawCode,
          message: item.rawMessage,
          stack: `Error: ${item.rawMessage}\n    at /workspace/functions/src/index.ts:10:5`,
        });

        try {
          await changeAdminRole(
            {
              targetUid: SAMPLE_TARGET_UID,
              expectedRevision: 1,
              targetRole: AdminRole.CitizenModerator,
            },
            createTestDeps({ manageAdminLifecycleCallable: mockCallable })
          );
          expect.fail(`Expected changeAdminRole to throw for ${item.rawCode}`);
        } catch (err: unknown) {
          expect(err).toBeInstanceOf(AdminIdentityClientError);
          const clientErr = err as AdminIdentityClientError;
          expect(clientErr.code).toBe(item.expectedCode);
          expect(clientErr.reason).toBe(item.expectedReason);
          expect(clientErr.message).not.toMatch(/\/workspace\/|\/app\/applet\/|functions\/src\//);
          expect(clientErr.message).not.toMatch(/admins\/|admin_invitations\/|audit_logs\//);
          expect(clientErr.stack).not.toMatch(/\bat\s+/);
        }
      }
    });

    it('rejects malformed server responses containing leaked secret fields or corrupted revisions', async () => {
      const malformedResponses = [
        null,
        'not-an-object',
        { ...SAMPLE_LIFECYCLE_RESPONSE, operation: 'Deactivate' }, // operation mismatch
        { ...SAMPLE_LIFECYCLE_RESPONSE, targetUid: 'wrong_uid' }, // uid mismatch
        { ...SAMPLE_LIFECYCLE_RESPONSE, currentRevision: 1 }, // current <= previous
        { ...SAMPLE_LIFECYCLE_RESPONSE, token: 'leaked_service_token' }, // secret leakage
        {
          ...SAMPLE_LIFECYCLE_RESPONSE,
          admin: { ...SAMPLE_LIFECYCLE_RESPONSE.admin, password: 'leak' },
        },
      ];

      for (const badResp of malformedResponses) {
        const mockCallable = vi.fn().mockResolvedValue({
          data: badResp,
        });

        await expect(
          changeAdminRole(
            {
              targetUid: SAMPLE_TARGET_UID,
              expectedRevision: 2,
              targetRole: AdminRole.CitizenModerator,
            },
            createTestDeps({ manageAdminLifecycleCallable: mockCallable })
          )
        ).rejects.toMatchObject({
          name: 'AdminIdentityClientError',
          code: 'internal',
        });
      }
    });
  });

  describe('9. Session authentication prerequisite', () => {
    it('requires authenticated session before dispatching lifecycle calls', async () => {
      const mockCallable = vi.fn();

      await expect(
        changeAdminRole(
          {
            targetUid: SAMPLE_TARGET_UID,
            expectedRevision: 1,
            targetRole: AdminRole.CitizenModerator,
          },
          createTestDeps({ getAuthenticatedUid: () => null })
        )
      ).rejects.toMatchObject({
        name: 'AdminIdentityClientError',
        code: 'unauthenticated',
        reason: 'UNAUTHENTICATED_SESSION',
      });

      expect(mockCallable).not.toHaveBeenCalled();
    });
  });

  describe('10. AdminIdentityManagementClient class wrapper and static methods', () => {
    it('supports static and instance method dispatch', async () => {
      const mockCallable = vi.fn().mockResolvedValue({
        data: SAMPLE_LIFECYCLE_RESPONSE,
      });

      const client = new AdminIdentityManagementClient(
        createTestDeps({ manageAdminLifecycleCallable: mockCallable })
      );

      const staticResult = await AdminIdentityManagementClient.changeRole(
        {
          targetUid: SAMPLE_TARGET_UID,
          expectedRevision: 2,
          targetRole: AdminRole.CitizenModerator,
        },
        createTestDeps({ manageAdminLifecycleCallable: mockCallable })
      );
      expect(staticResult).toEqual(SAMPLE_LIFECYCLE_RESPONSE);

      const instanceResult = await client.changeRole({
        targetUid: SAMPLE_TARGET_UID,
        expectedRevision: 2,
        targetRole: AdminRole.CitizenModerator,
      });
      expect(instanceResult).toEqual(SAMPLE_LIFECYCLE_RESPONSE);
    });
  });

  describe('11. Preservation of 5-field directory DTO', () => {
    it('preserves existing directory listAdminUsers 5-field DTO without revision inference', async () => {
      const mockList = vi.fn().mockResolvedValue({
        data: {
          admins: [
            {
              id: 'admin_1',
              name: 'Admin One',
              email: 'admin1@promiseofplanet.org',
              role: AdminRole.LibraryCurator,
              isActive: true,
            },
          ],
        },
      });

      const result = await listAdminUsers(
        createTestDeps({ listAdminUsersCallable: mockList })
      );

      expect(result.admins).toHaveLength(1);
      const admin = result.admins[0];
      const keys = Object.keys(admin);
      expect(keys.sort()).toEqual(['email', 'id', 'isActive', 'name', 'role'].sort());
      // Explicitly check that revision is NOT present or inferred in directory DTO
      expect('revision' in admin).toBe(false);
    });
  });
});
