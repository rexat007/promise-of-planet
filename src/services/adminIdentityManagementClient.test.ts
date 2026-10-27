import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  AdminInvitationStatus,
  AdminRole,
  acceptAdminInvitation,
  createAdminInvitation,
  listAdminUsers,
  revokeAdminInvitation,
  type AdminIdentityClientDependencies,
  type SanitizedAdminInvitationDto,
} from './adminIdentityManagementClient';

const SAMPLE_PENDING_INVITATION: SanitizedAdminInvitationDto = {
  invitationId: 'inv_0123456789abcdef0123456789abcdef',
  targetUid: null,
  normalizedTargetEmail: 'curator@promiseofplanet.org',
  intendedRole: AdminRole.LibraryCurator,
  invitingOwnerUid: 'owner_session_uid_01',
  createdAtIso: '2026-10-26T08:00:00.000Z',
  expiresAtIso: '2026-11-02T08:00:00.000Z',
  status: AdminInvitationStatus.Pending,
  acceptedAtIso: null,
  acceptedByUid: null,
  revokedAtIso: null,
  revokedByOwnerUid: null,
  expiredAtIso: null,
  revision: 1,
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

describe('AUTH-03C1 — Typed Admin Directory & Invitation Client Bridge', () => {
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

  describe('1. Directory Client (listAdminUsers)', () => {
    it('returns validated directory entries across canonical roles and preserves inactive admins', async () => {
      const listCallable = vi.fn().mockResolvedValue({
        data: {
          admins: [
            {
              id: 'owner_session_uid_01',
              name: 'Lead Owner',
              email: 'owner@promiseofplanet.org',
              role: AdminRole.Owner,
              isActive: true,
            },
            {
              id: 'editor_uid_02',
              name: 'Senior Content Editor',
              email: 'editor@promiseofplanet.org',
              role: AdminRole.ContentEditor,
              isActive: true,
            },
            {
              id: 'inactive_reviewer_uid_03',
              name: 'Suspended Rights Reviewer',
              email: 'reviewer@promiseofplanet.org',
              role: AdminRole.RightsReviewer,
              isActive: false,
            },
            {
              id: 'viewer_uid_04',
              name: 'Audit Viewer',
              email: 'viewer@promiseofplanet.org',
              role: AdminRole.Viewer,
              isActive: false,
            },
          ],
        },
      });

      const response = await listAdminUsers(
        createTestDeps({ listAdminUsersCallable: listCallable })
      );

      expect(listCallable).toHaveBeenCalledTimes(1);
      expect(listCallable).toHaveBeenCalledWith({});
      expect(response.admins).toHaveLength(4);
      expect(response.admins[2]).toEqual({
        id: 'inactive_reviewer_uid_03',
        name: 'Suspended Rights Reviewer',
        email: 'reviewer@promiseofplanet.org',
        role: AdminRole.RightsReviewer,
        isActive: false,
      });
      expect(response.admins[3]?.isActive).toBe(false);
    });

    it('rejects duplicate administrative UIDs in directory response', async () => {
      const listCallable = vi.fn().mockResolvedValue({
        data: {
          admins: [
            {
              id: 'duplicate_uid_01',
              name: 'First Entry',
              email: 'first@promiseofplanet.org',
              role: AdminRole.ContentEditor,
              isActive: true,
            },
            {
              id: 'duplicate_uid_01',
              name: 'Second Entry',
              email: 'second@promiseofplanet.org',
              role: AdminRole.Trainer,
              isActive: true,
            },
          ],
        },
      });

      await expect(
        listAdminUsers(createTestDeps({ listAdminUsersCallable: listCallable }))
      ).rejects.toMatchObject({
        name: 'AdminIdentityClientError',
        code: 'internal',
        reason: 'DUPLICATE_ADMIN_UID',
      });
    });

    it('rejects malformed admin entries (missing UID, untrimmed UID, missing email, extra fields, or non-boolean isActive)', async () => {
      const malformedPayloads = [
        {
          admins: [
            {
              id: '',
              name: 'Missing UID',
              email: 'user@promiseofplanet.org',
              role: AdminRole.Viewer,
              isActive: true,
            },
          ],
        },
        {
          admins: [
            {
              id: ' uid_with_leading_space',
              name: 'Whitespace UID',
              email: 'user@promiseofplanet.org',
              role: AdminRole.Viewer,
              isActive: true,
            },
          ],
        },
        {
          admins: [
            {
              id: 'valid_uid_01',
              name: 'Invalid Email Admin',
              email: 'not-an-email',
              role: AdminRole.Viewer,
              isActive: true,
            },
          ],
        },
        {
          admins: [
            {
              id: 'valid_uid_02',
              name: 'Extra Field Admin',
              email: 'valid@promiseofplanet.org',
              role: AdminRole.Viewer,
              isActive: true,
              permissions: ['manageUsers'],
            },
          ],
        },
        {
          admins: [
            {
              id: 'valid_uid_03',
              name: 'String Active Flag',
              email: 'valid@promiseofplanet.org',
              role: AdminRole.Viewer,
              isActive: 'true',
            },
          ],
        },
      ];

      for (const payload of malformedPayloads) {
        const listCallable = vi.fn().mockResolvedValue({ data: payload });
        await expect(
          listAdminUsers(createTestDeps({ listAdminUsersCallable: listCallable }))
        ).rejects.toMatchObject({
          name: 'AdminIdentityClientError',
          code: 'internal',
        });
      }
    });

    it('rejects legacy or unknown non-canonical roles in directory response', async () => {
      for (const invalidRole of [
        'SuperAdmin',
        'Admin',
        'ManagingEditor',
        'Editor',
        'Writer',
        'Moderator',
        '',
      ]) {
        const listCallable = vi.fn().mockResolvedValue({
          data: {
            admins: [
              {
                id: 'legacy_role_uid',
                name: 'Legacy Role User',
                email: 'legacy@promiseofplanet.org',
                role: invalidRole,
                isActive: true,
              },
            ],
          },
        });

        await expect(
          listAdminUsers(createTestDeps({ listAdminUsersCallable: listCallable }))
        ).rejects.toMatchObject({
          name: 'AdminIdentityClientError',
          code: 'internal',
          reason: 'INVALID_ADMIN_ROLE',
        });
      }
    });

    it('handles unauthorized and canonical server callable errors fail-closed without leaking stack traces or internal paths', async () => {
      const serverErrors: Array<{
        rawCode: string;
        rawMessage: string;
        expectedCode: string;
      }> = [
        {
          rawCode: 'functions/unauthenticated',
          rawMessage:
            'Unauthenticated at /workspace/functions/src/admin/adminUserDirectoryHandlers.ts:102',
          expectedCode: 'unauthenticated',
        },
        {
          rawCode: 'functions/permission-denied',
          rawMessage:
            'Permission denied reading admins/owner_session_uid_01 at Object.execute (/app/applet/functions/src/index.ts:15)',
          expectedCode: 'permission-denied',
        },
        {
          rawCode: 'invalid-argument',
          rawMessage: 'Invalid limit in /workspace/functions/src/admin/adminRepository.ts',
          expectedCode: 'invalid-argument',
        },
        {
          rawCode: 'functions/failed-precondition',
          rawMessage: 'Invalid record in admin_invitations/inv_1234567890abcdef',
          expectedCode: 'failed-precondition',
        },
        {
          rawCode: 'functions/unavailable',
          rawMessage: 'Service temporarily unavailable',
          expectedCode: 'unavailable',
        },
        {
          rawCode: 'functions/internal',
          rawMessage:
            'Internal failure writing audit_logs/aud_inv_123 at C:\\server\\index.js:40',
          expectedCode: 'internal',
        },
      ];

      for (const item of serverErrors) {
        const listCallable = vi.fn().mockRejectedValue({
          code: item.rawCode,
          message: item.rawMessage,
          stack: `Error: ${item.rawMessage}\n    at /workspace/functions/src/index.ts:10:5`,
        });

        try {
          await listAdminUsers(
            createTestDeps({ listAdminUsersCallable: listCallable })
          );
          expect.fail(`Expected listAdminUsers to throw for ${item.rawCode}`);
        } catch (err: unknown) {
          expect(err).toBeInstanceOf(AdminIdentityClientError);
          const clientErr = err as AdminIdentityClientError;
          expect(clientErr.code).toBe(item.expectedCode);
          expect(clientErr.message).not.toMatch(/\/workspace\/|\/app\/applet\/|functions\/src\//);
          expect(clientErr.message).not.toMatch(/admins\/|admin_invitations\/|audit_logs\//);
          expect(clientErr.stack).not.toMatch(/\bat\s+/);
        }
      }
    });
    it('accepts versioned directory entries with positive safe integer revision and unversioned entries without revision', async () => {
      const listCallable = vi.fn().mockResolvedValue({
        data: {
          admins: [
            {
              id: 'versioned_admin_01',
              name: 'Versioned Admin',
              email: 'versioned@promiseofplanet.org',
              role: AdminRole.Owner,
              isActive: true,
              revision: 42,
            },
            {
              id: 'legacy_admin_02',
              name: 'Legacy Admin',
              email: 'legacy@promiseofplanet.org',
              role: AdminRole.RightsReviewer,
              isActive: true,
            },
          ],
        },
      });

      const response = await listAdminUsers(
        createTestDeps({ listAdminUsersCallable: listCallable })
      );

      expect(response.admins).toHaveLength(2);
      expect(response.admins[0].revision).toBe(42);
      expect('revision' in response.admins[0]).toBe(true);
      expect(response.admins[1].revision).toBeUndefined();
      expect('revision' in response.admins[1]).toBe(false);
      expect(Object.keys(response.admins[1])).toEqual([
        'id',
        'name',
        'email',
        'role',
        'isActive',
      ]);
    });

    it('fails closed with MALFORMED_ADMIN_RECORD when directory entry has an invalid revision', async () => {
      const invalidRevisions = [0, -1, -5, 1.5, NaN, '1', null, {}, [], Number.MAX_SAFE_INTEGER + 10];

      for (const invalidRev of invalidRevisions) {
        const listCallable = vi.fn().mockResolvedValue({
          data: {
            admins: [
              {
                id: 'admin_with_bad_revision',
                name: 'Bad Rev Admin',
                email: 'badrev@promiseofplanet.org',
                role: AdminRole.Owner,
                isActive: true,
                revision: invalidRev,
              },
            ],
          },
        });

        await expect(
          listAdminUsers(createTestDeps({ listAdminUsersCallable: listCallable }))
        ).rejects.toMatchObject({
          code: 'internal',
          reason: 'MALFORMED_ADMIN_RECORD',
        });
      }
    });
  });

  describe('2. Invitation Client (manageAdminInvitations)', () => {
    it('creates a valid administrative invitation and validates the canonical response', async () => {
      const manageCallable = vi.fn().mockResolvedValue({
        data: {
          invitation: SAMPLE_PENDING_INVITATION,
          auditEventId: 'aud_inv_0123456789abcdef0123456789abcdef',
        },
      });

      const result = await createAdminInvitation(
        {
          targetEmail: '  Curator@PromiseOfPlanet.org ',
          intendedRole: AdminRole.LibraryCurator,
          ttlMs: 86_400_000,
        },
        createTestDeps({ manageAdminInvitationsCallable: manageCallable })
      );

      expect(manageCallable).toHaveBeenCalledTimes(1);
      expect(manageCallable).toHaveBeenCalledWith({
        action: 'createInvitation',
        targetEmail: 'curator@promiseofplanet.org',
        intendedRole: AdminRole.LibraryCurator,
        ttlMs: 86_400_000,
      });
      expect(result.invitation).toEqual(SAMPLE_PENDING_INVITATION);
      expect(result.auditEventId).toBe(
        'aud_inv_0123456789abcdef0123456789abcdef'
      );
    });

    it('requires matching explicitOwnerRoleGrant when creating an Owner invitation', async () => {
      const manageCallable = vi.fn();

      await expect(
        createAdminInvitation(
          {
            targetEmail: 'co-owner@promiseofplanet.org',
            intendedRole: AdminRole.Owner,
          },
          createTestDeps({ manageAdminInvitationsCallable: manageCallable })
        )
      ).rejects.toMatchObject({
        name: 'AdminIdentityClientError',
        code: 'permission-denied',
      });

      expect(manageCallable).not.toHaveBeenCalled();

      const ownerInvitationDto: SanitizedAdminInvitationDto = {
        ...SAMPLE_PENDING_INVITATION,
        normalizedTargetEmail: 'co-owner@promiseofplanet.org',
        intendedRole: AdminRole.Owner,
      };
      manageCallable.mockResolvedValueOnce({
        data: {
          invitation: ownerInvitationDto,
          auditEventId: 'aud_inv_abcdef0123456789abcdef0123456789',
        },
      });

      const created = await createAdminInvitation(
        {
          targetEmail: 'co-owner@promiseofplanet.org',
          intendedRole: AdminRole.Owner,
          explicitOwnerRoleGrant: {
            confirmedOwnerRoleGrant: true,
            authorizingOwnerUid: 'owner_session_uid_01',
          },
        },
        createTestDeps({ manageAdminInvitationsCallable: manageCallable })
      );

      expect(created.invitation.intendedRole).toBe(AdminRole.Owner);
    });

    it('revokes a pending invitation with optional expectedRevision', async () => {
      const revokedDto: SanitizedAdminInvitationDto = {
        ...SAMPLE_PENDING_INVITATION,
        status: AdminInvitationStatus.Revoked,
        revokedAtIso: '2026-10-26T09:30:00.000Z',
        revokedByOwnerUid: 'owner_session_uid_01',
        revision: 2,
      };

      const manageCallable = vi.fn().mockResolvedValue({
        data: {
          invitation: revokedDto,
          auditEventId: 'aud_inv_99998888777766665555444433332222',
        },
      });

      const result = await revokeAdminInvitation(
        {
          invitationId: SAMPLE_PENDING_INVITATION.invitationId,
          expectedRevision: 1,
        },
        createTestDeps({ manageAdminInvitationsCallable: manageCallable })
      );

      expect(manageCallable).toHaveBeenCalledWith({
        action: 'revokeInvitation',
        invitationId: SAMPLE_PENDING_INVITATION.invitationId,
        expectedRevision: 1,
      });
      expect(result.invitation.status).toBe(AdminInvitationStatus.Revoked);
      expect(result.invitation.revision).toBe(2);
    });

    it('accepts a pending non-Owner invitation using invitationId locator only', async () => {
      const acceptorUid = 'acceptor_uid_99';
      const acceptedDto: SanitizedAdminInvitationDto = {
        ...SAMPLE_PENDING_INVITATION,
        targetUid: acceptorUid,
        status: AdminInvitationStatus.Accepted,
        acceptedAtIso: '2026-10-26T10:15:00.000Z',
        acceptedByUid: acceptorUid,
        revision: 2,
      };

      const activatedAdmin = {
        id: acceptorUid,
        name: 'New Library Curator',
        email: 'curator@promiseofplanet.org',
        role: AdminRole.LibraryCurator,
        isActive: true,
      };

      const manageCallable = vi.fn().mockResolvedValue({
        data: {
          invitation: acceptedDto,
          admin: activatedAdmin,
          auditEventId: 'aud_inv_11112222333344445555666677778888',
        },
      });

      const result = await acceptAdminInvitation(
        {
          invitationId: SAMPLE_PENDING_INVITATION.invitationId,
          expectedRevision: 1,
        },
        createTestDeps({
          getAuthenticatedUid: () => acceptorUid,
          manageAdminInvitationsCallable: manageCallable,
        })
      );

      expect(manageCallable).toHaveBeenCalledWith({
        action: 'acceptInvitation',
        invitationId: SAMPLE_PENDING_INVITATION.invitationId,
        expectedRevision: 1,
      });
      expect(result.admin).toEqual(activatedAdmin);
      expect(result.invitation.acceptedByUid).toBe(acceptorUid);
    });

    it('refuses to activate Owner invitations on acceptance (fail-closed Owner safety)', async () => {
      const acceptorUid = 'acceptor_owner_attempt_uid';
      const ownerAcceptedDto: SanitizedAdminInvitationDto = {
        ...SAMPLE_PENDING_INVITATION,
        intendedRole: AdminRole.Owner,
        targetUid: acceptorUid,
        status: AdminInvitationStatus.Accepted,
        acceptedAtIso: '2026-10-26T10:15:00.000Z',
        acceptedByUid: acceptorUid,
        revision: 2,
      };

      const manageCallable = vi.fn().mockResolvedValue({
        data: {
          invitation: ownerAcceptedDto,
          admin: {
            id: acceptorUid,
            name: 'Forbidden Owner Activation',
            email: 'curator@promiseofplanet.org',
            role: AdminRole.Owner,
            isActive: true,
          },
          auditEventId: 'aud_inv_11112222333344445555666677778888',
        },
      });

      await expect(
        acceptAdminInvitation(
          {
            invitationId: SAMPLE_PENDING_INVITATION.invitationId,
          },
          createTestDeps({
            getAuthenticatedUid: () => acceptorUid,
            manageAdminInvitationsCallable: manageCallable,
          })
        )
      ).rejects.toMatchObject({
        name: 'AdminIdentityClientError',
        code: 'permission-denied',
        reason: 'OWNER_ACTIVATION_FORBIDDEN',
      });
    });

    it('rejects forged privileged or secret fields on invitation requests before calling server', async () => {
      const manageCallable = vi.fn();
      const deps = createTestDeps({
        manageAdminInvitationsCallable: manageCallable,
      });

      const forgedAcceptanceInputs = [
        {
          invitationId: SAMPLE_PENDING_INVITATION.invitationId,
          uid: 'forged_uid',
        },
        {
          invitationId: SAMPLE_PENDING_INVITATION.invitationId,
          callerUid: 'forged_uid',
        },
        {
          invitationId: SAMPLE_PENDING_INVITATION.invitationId,
          intendedRole: AdminRole.Owner,
        },
        {
          invitationId: SAMPLE_PENDING_INVITATION.invitationId,
          role: AdminRole.Owner,
        },
        {
          invitationId: SAMPLE_PENDING_INVITATION.invitationId,
          emailVerified: true,
        },
        {
          invitationId: SAMPLE_PENDING_INVITATION.invitationId,
          invitationToken: 'secret_token_value',
        },
      ];

      for (const badInput of forgedAcceptanceInputs) {
        await expect(
          acceptAdminInvitation(
            badInput as unknown as { invitationId: string },
            deps
          )
        ).rejects.toMatchObject({
          name: 'AdminIdentityClientError',
          code: 'permission-denied',
          reason: 'SPOOFED_AUTHORITY_REJECTED',
        });
      }

      await expect(
        createAdminInvitation(
          {
            targetEmail: 'editor@promiseofplanet.org',
            intendedRole: AdminRole.ContentEditor,
            invitingOwnerUid: 'spoofed_owner_uid',
          } as unknown as Parameters<typeof createAdminInvitation>[0],
          deps
        )
      ).rejects.toMatchObject({
        name: 'AdminIdentityClientError',
        code: 'permission-denied',
        reason: 'SPOOFED_AUTHORITY_REJECTED',
      });

      expect(manageCallable).not.toHaveBeenCalled();
    });

    it('rejects malformed invitation responses and responses containing secret/token fields', async () => {
      const malformedResponses = [
        // Missing auditEventId
        {
          invitation: SAMPLE_PENDING_INVITATION,
        },
        // Leaked secret token field inside invitation DTO
        {
          invitation: {
            ...SAMPLE_PENDING_INVITATION,
            invitationToken: 'secret_bearer_token',
          },
          auditEventId: 'aud_inv_0123456789abcdef0123456789abcdef',
        },
        // Mismatched target email from requested email
        {
          invitation: {
            ...SAMPLE_PENDING_INVITATION,
            normalizedTargetEmail: 'wrong@promiseofplanet.org',
          },
          auditEventId: 'aud_inv_0123456789abcdef0123456789abcdef',
        },
        // Non-UTC ISO timestamp
        {
          invitation: {
            ...SAMPLE_PENDING_INVITATION,
            createdAtIso: '2026-10-26 08:00:00',
          },
          auditEventId: 'aud_inv_0123456789abcdef0123456789abcdef',
        },
      ];

      for (const badResponse of malformedResponses) {
        const manageCallable = vi.fn().mockResolvedValue({ data: badResponse });
        await expect(
          createAdminInvitation(
            {
              targetEmail: 'curator@promiseofplanet.org',
              intendedRole: AdminRole.LibraryCurator,
            },
            createTestDeps({ manageAdminInvitationsCallable: manageCallable })
          )
        ).rejects.toMatchObject({
          name: 'AdminIdentityClientError',
          code: 'internal',
        });
      }
    });
  });

  describe('3. Security, Storage & Session Invariants', () => {
    it('never falls back to mock data when Firebase is unconfigured or unauthenticated', async () => {
      await expect(
        listAdminUsers({
          isBackendConfigured: () => false,
          getAuthenticatedUid: () => 'owner_session_uid_01',
        })
      ).rejects.toMatchObject({
        name: 'AdminIdentityClientError',
        code: 'unavailable',
        reason: 'BACKEND_UNAVAILABLE',
      });

      await expect(
        listAdminUsers({
          isBackendConfigured: () => true,
          getAuthenticatedUid: () => null,
        })
      ).rejects.toMatchObject({
        name: 'AdminIdentityClientError',
        code: 'unauthenticated',
        reason: 'UNAUTHENTICATED_SESSION',
      });
    });

    it('uses the existing Firebase Functions client instance and authenticated session when no overrides are injected', async () => {
      const callableSpy = vi.fn().mockResolvedValue({
        data: {
          admins: [
            {
              id: 'owner_session_uid_01',
              name: 'Session Owner',
              email: 'owner@promiseofplanet.org',
              role: AdminRole.Owner,
              isActive: true,
            },
          ],
        },
      });
      mockHttpsCallable.mockReturnValue(callableSpy);

      const client = new AdminIdentityManagementClient();
      const directory = await client.listAdminUsers();

      expect(mockGetFunctions).toHaveBeenCalledWith(mockFirebaseState.app);
      expect(mockHttpsCallable).toHaveBeenCalledWith(
        { name: 'mock-functions-instance' },
        'listAdminUsers'
      );
      expect(callableSpy).toHaveBeenCalledWith({});
      expect(directory.admins).toHaveLength(1);
    });

    it('does not touch browser storage, cookies, or direct Firestore admins collection operations', () => {
      const sourcePath = resolve(
        __dirname,
        './adminIdentityManagementClient.ts'
      );
      const sourceCode = readFileSync(sourcePath, 'utf8');

      expect(sourceCode).not.toMatch(/firebase\/firestore/);
      expect(sourceCode).not.toMatch(
        /\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/
      );
      expect(sourceCode).not.toMatch(
        /\b(getDocs|setDoc|updateDoc|deleteDoc|addDoc|collection)\b/
      );
    });
  });
});
