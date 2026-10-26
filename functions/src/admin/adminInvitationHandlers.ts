import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {
  validatePersistedAdminInvitationRecord,
  type AdminInvitationRecord,
  type AdminInvitationStatus,
  type ExplicitOwnerRoleGrantAuthorization,
} from './adminInvitationContract';
import {
  AdminInvitationPersistenceError,
  type AdminInvitationPersistenceErrorCode,
} from './adminInvitationRepository';
import {
  AdminInvitationApplicationService,
  type AdminInvitationApplicationServiceDependencies,
} from './adminInvitationApplicationService';
import { isValidAdminRole, type AdminRole, type AdminUser } from '../types/admin';

export const MANAGE_ADMIN_INVITATION_ACTIONS = [
  'createInvitation',
  'revokeInvitation',
  'acceptInvitation',
] as const;

export type ManageAdminInvitationAction =
  (typeof MANAGE_ADMIN_INVITATION_ACTIONS)[number];

export interface ManageAdminInvitationsRequestContext {
  readonly auth?: {
    readonly uid: string;
    readonly token?: Record<string, unknown>;
  };
  readonly data?: unknown;
}

export interface SanitizedAdminInvitationDto {
  readonly invitationId: string;
  readonly targetUid: string | null;
  readonly normalizedTargetEmail: string;
  readonly intendedRole: AdminRole;
  readonly invitingOwnerUid: string;
  readonly createdAtIso: string;
  readonly expiresAtIso: string;
  readonly status: AdminInvitationStatus;
  readonly acceptedAtIso: string | null;
  readonly acceptedByUid: string | null;
  readonly revokedAtIso: string | null;
  readonly revokedByOwnerUid: string | null;
  readonly expiredAtIso: string | null;
  readonly revision: number;
}

export interface SanitizedActivatedAdminDto {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: AdminRole;
  readonly isActive: boolean;
}

export interface CreateAdminInvitationCallableResponse {
  readonly invitation: SanitizedAdminInvitationDto;
  readonly auditEventId: string;
}

export interface RevokeAdminInvitationCallableResponse {
  readonly invitation: SanitizedAdminInvitationDto;
  readonly auditEventId: string;
}

export interface AcceptAdminInvitationCallableResponse {
  readonly invitation: SanitizedAdminInvitationDto;
  readonly admin: SanitizedActivatedAdminDto;
  readonly auditEventId: string;
}

export type ManageAdminInvitationsCallableResponse =
  | CreateAdminInvitationCallableResponse
  | RevokeAdminInvitationCallableResponse
  | AcceptAdminInvitationCallableResponse;

export interface ManageAdminInvitationsHandlerDependencies
  extends AdminInvitationApplicationServiceDependencies {
  readonly service?: AdminInvitationApplicationService;
}

const CREATE_INVITATION_ALLOWED_KEYS = new Set<string>([
  'action',
  'targetEmail',
  'intendedRole',
  'targetUid',
  'ttlMs',
  'explicitOwnerRoleGrant',
]);

const REVOKE_INVITATION_ALLOWED_KEYS = new Set<string>([
  'action',
  'invitationId',
  'expectedRevision',
]);

const ACCEPT_INVITATION_ALLOWED_KEYS = new Set<string>([
  'action',
  'invitationId',
  'expectedRevision',
]);

const SPOOFED_AUTHORITY_KEYS = new Set<string>([
  'callerUid',
  'uid',
  'invitingOwnerUid',
  'revokedByOwnerUid',
  'acceptedByUid',
  'emailVerified',
  'isOwner',
  'isActive',
  'permissions',
  'admin',
  'role',
  'status',
  'revision',
]);

function isValidManageAdminInvitationAction(
  action: unknown
): action is ManageAdminInvitationAction {
  return (
    typeof action === 'string' &&
    (MANAGE_ADMIN_INVITATION_ACTIONS as readonly string[]).includes(action)
  );
}

function sanitizeInvitationRecordToDto(
  record: AdminInvitationRecord
): SanitizedAdminInvitationDto {
  const validated = validatePersistedAdminInvitationRecord(record);
  return {
    invitationId: validated.invitationId,
    targetUid: validated.targetUid,
    normalizedTargetEmail: validated.normalizedTargetEmail,
    intendedRole: validated.intendedRole,
    invitingOwnerUid: validated.invitingOwnerUid,
    createdAtIso: validated.createdAtIso,
    expiresAtIso: validated.expiresAtIso,
    status: validated.status,
    acceptedAtIso: validated.acceptedAtIso,
    acceptedByUid: validated.acceptedByUid,
    revokedAtIso: validated.revokedAtIso,
    revokedByOwnerUid: validated.revokedByOwnerUid,
    expiredAtIso: validated.expiredAtIso,
    revision: validated.revision,
  };
}

function sanitizeActivatedAdminToDto(
  admin: AdminUser
): SanitizedActivatedAdminDto {
  if (
    !admin ||
    typeof admin !== 'object' ||
    typeof admin.id !== 'string' ||
    !admin.id.trim() ||
    typeof admin.name !== 'string' ||
    !admin.name.trim() ||
    typeof admin.email !== 'string' ||
    !admin.email.trim() ||
    !isValidAdminRole(admin.role) ||
    typeof admin.isActive !== 'boolean'
  ) {
    throw new HttpsError(
      'internal',
      'Activated administrative identity failed output validation.'
    );
  }

  return {
    id: admin.id.trim(),
    name: admin.name.trim(),
    email: admin.email.trim(),
    role: admin.role,
    isActive: admin.isActive,
  };
}

function assertAllowedPayloadKeys(
  payload: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  action: ManageAdminInvitationAction
): void {
  for (const key of Object.keys(payload)) {
    if (allowedKeys.has(key)) {
      continue;
    }

    if (
      SPOOFED_AUTHORITY_KEYS.has(key) ||
      (action === 'acceptInvitation' &&
        (key === 'email' || key === 'intendedRole' || key === 'targetUid'))
    ) {
      throw new HttpsError(
        'permission-denied',
        'Caller-supplied authority, identity, or verification claims are forbidden.'
      );
    }

    throw new HttpsError(
      'invalid-argument',
      `Unexpected field '${key}' in ${action} request payload.`
    );
  }
}

function parseOptionalExpectedRevision(rawRevision: unknown): number | undefined {
  if (rawRevision === undefined) {
    return undefined;
  }
  if (
    typeof rawRevision !== 'number' ||
    !Number.isInteger(rawRevision) ||
    rawRevision < 1
  ) {
    throw new HttpsError(
      'invalid-argument',
      'expectedRevision must be a positive integer.'
    );
  }
  return rawRevision;
}

function parseOptionalExplicitOwnerGrant(
  rawGrant: unknown
): ExplicitOwnerRoleGrantAuthorization | undefined {
  if (rawGrant === undefined) {
    return undefined;
  }
  if (!rawGrant || typeof rawGrant !== 'object' || Array.isArray(rawGrant)) {
    throw new HttpsError(
      'invalid-argument',
      'explicitOwnerRoleGrant must be an object when provided.'
    );
  }
  const grantObj = rawGrant as Record<string, unknown>;
  const keys = Object.keys(grantObj);
  if (
    keys.some(
      (k) => k !== 'confirmedOwnerRoleGrant' && k !== 'authorizingOwnerUid'
    )
  ) {
    throw new HttpsError(
      'invalid-argument',
      'explicitOwnerRoleGrant contains unexpected properties.'
    );
  }
  if (
    grantObj.confirmedOwnerRoleGrant !== true ||
    typeof grantObj.authorizingOwnerUid !== 'string' ||
    !grantObj.authorizingOwnerUid.trim()
  ) {
    throw new HttpsError(
      'permission-denied',
      'Invalid explicit Owner role grant confirmation.'
    );
  }
  return {
    confirmedOwnerRoleGrant: true,
    authorizingOwnerUid: grantObj.authorizingOwnerUid.trim(),
  };
}

export function mapInvitationErrorToHttpsError(error: unknown): HttpsError {
  if (error instanceof HttpsError) {
    return error;
  }

  if (error instanceof AdminInvitationPersistenceError) {
    const code: AdminInvitationPersistenceErrorCode = error.code;

    switch (code) {
      case 'UNAUTHENTICATED_CALLER':
        return new HttpsError(
          'unauthenticated',
          'Authentication is required to perform this administrative invitation operation.'
        );

      case 'UNAUTHORIZED_INVITER':
      case 'INACTIVE_INVITER':
      case 'IDENTITY_MISMATCH':
      case 'EMAIL_MISMATCH':
      case 'OWNER_ROLE_ASSIGNMENT_REQUIRES_EXPLICIT_AUTHORIZATION':
      case 'OWNER_ACTIVATION_FORBIDDEN':
        return new HttpsError(
          'permission-denied',
          'Caller is not authorized to perform this administrative invitation operation.'
        );

      case 'INVALID_INVITATION_ID':
      case 'INVALID_TARGET_EMAIL':
      case 'INVALID_TARGET_UID':
      case 'INVALID_INTENDED_ROLE':
      case 'INVALID_TIMESTAMPS':
        return new HttpsError(
          'invalid-argument',
          'Invalid administrative invitation request parameters.'
        );

      case 'UNVERIFIED_TARGET_EMAIL':
      case 'EXISTING_ADMIN_CONFLICT':
      case 'INVITATION_NOT_FOUND':
      case 'INVITATION_ALREADY_EXISTS':
      case 'INVITATION_EXPIRED':
      case 'INVITATION_REVOKED':
      case 'INVITATION_ALREADY_ACCEPTED':
      case 'INVALID_STATE_TRANSITION':
      case 'CONCURRENT_MODIFICATION_CONFLICT':
      case 'INVALID_INVITATION_RECORD':
      case 'FORBIDDEN_SECRET_FIELD_DETECTED':
        return new HttpsError(
          'failed-precondition',
          'Administrative invitation precondition failed.'
        );

      case 'UNTRUSTED_ID_GENERATOR':
      case 'TRANSACTION_ABORTED':
      case 'PERSISTENCE_FAILURE':
      default:
        return new HttpsError(
          'internal',
          'An internal error occurred while processing the administrative invitation.'
        );
    }
  }

  return new HttpsError(
    'internal',
    'An internal error occurred while processing the administrative invitation.'
  );
}

export async function executeManageAdminInvitations(
  request: ManageAdminInvitationsRequestContext,
  deps?: ManageAdminInvitationsHandlerDependencies
): Promise<ManageAdminInvitationsCallableResponse> {
  try {
    const rawCallerUid = request?.auth?.uid;
    const callerUid =
      typeof rawCallerUid === 'string' ? rawCallerUid.trim() : '';

    if (!callerUid) {
      throw new HttpsError(
        'unauthenticated',
        'Authentication is required to manage or accept administrative invitations.'
      );
    }

    const rawData = request?.data;
    if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) {
      throw new HttpsError(
        'invalid-argument',
        'Request data must be a non-null JSON object.'
      );
    }

    const payload = rawData as Record<string, unknown>;
    const action = payload.action;

    if (!isValidManageAdminInvitationAction(action)) {
      throw new HttpsError(
        'invalid-argument',
        'Unsupported or missing administrative invitation action.'
      );
    }

    const service =
      deps?.service ?? new AdminInvitationApplicationService(deps);

    if (action === 'createInvitation') {
      assertAllowedPayloadKeys(payload, CREATE_INVITATION_ALLOWED_KEYS, action);

      if (typeof payload.targetEmail !== 'string') {
        throw new HttpsError(
          'invalid-argument',
          'targetEmail must be a string.'
        );
      }

      if (!isValidAdminRole(payload.intendedRole)) {
        throw new HttpsError(
          'invalid-argument',
          'intendedRole must be a canonical AdminRole.'
        );
      }

      let targetUid: string | null | undefined;
      if (payload.targetUid !== undefined && payload.targetUid !== null) {
        if (
          typeof payload.targetUid !== 'string' ||
          payload.targetUid.trim() === ''
        ) {
          throw new HttpsError(
            'invalid-argument',
            'targetUid must be null or a non-empty string.'
          );
        }
        targetUid = payload.targetUid.trim();
      } else if (payload.targetUid === null) {
        targetUid = null;
      }

      let ttlMs: number | undefined;
      if (payload.ttlMs !== undefined) {
        if (typeof payload.ttlMs !== 'number' || !Number.isInteger(payload.ttlMs)) {
          throw new HttpsError(
            'invalid-argument',
            'ttlMs must be an integer when provided.'
          );
        }
        ttlMs = payload.ttlMs;
      }

      const explicitOwnerRoleGrant = parseOptionalExplicitOwnerGrant(
        payload.explicitOwnerRoleGrant
      );

      const created = await service.createPendingInvitation({
        authenticatedCallerUid: callerUid,
        targetEmail: payload.targetEmail,
        intendedRole: payload.intendedRole,
        targetUid,
        ttlMs,
        explicitOwnerRoleGrant,
      });

      return {
        invitation: sanitizeInvitationRecordToDto(created.invitation),
        auditEventId: created.auditEvent.id,
      };
    }

    if (action === 'revokeInvitation') {
      assertAllowedPayloadKeys(payload, REVOKE_INVITATION_ALLOWED_KEYS, action);

      if (typeof payload.invitationId !== 'string') {
        throw new HttpsError(
          'invalid-argument',
          'invitationId must be a string.'
        );
      }

      const expectedRevision = parseOptionalExpectedRevision(
        payload.expectedRevision
      );

      const revoked = await service.revokePendingInvitation({
        authenticatedCallerUid: callerUid,
        invitationId: payload.invitationId,
        expectedRevision,
      });

      return {
        invitation: sanitizeInvitationRecordToDto(revoked.invitation),
        auditEventId: revoked.auditEvent.id,
      };
    }

    // action === 'acceptInvitation'
    assertAllowedPayloadKeys(payload, ACCEPT_INVITATION_ALLOWED_KEYS, action);

    if (typeof payload.invitationId !== 'string') {
      throw new HttpsError(
        'invalid-argument',
        'invitationId must be a string.'
      );
    }

    const expectedRevision = parseOptionalExpectedRevision(
      payload.expectedRevision
    );

    const accepted = await service.acceptPendingInvitation({
      authenticatedCallerUid: callerUid,
      invitationId: payload.invitationId,
      expectedRevision,
    });

    return {
      invitation: sanitizeInvitationRecordToDto(accepted.invitation),
      admin: sanitizeActivatedAdminToDto(accepted.activatedAdmin),
      auditEventId: accepted.auditEvent.id,
    };
  } catch (error: unknown) {
    throw mapInvitationErrorToHttpsError(error);
  }
}

export const manageAdminInvitations = onCall(
  { cors: true },
  async (request: ManageAdminInvitationsRequestContext) => {
    return executeManageAdminInvitations(request);
  }
);
