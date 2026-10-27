import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { AdminRole, isValidAdminRole } from '../types/admin';
import {
  ADMIN_LIFECYCLE_OPERATIONS,
  AdminIdentityLifecycleApplicationService,
  AdminLifecycleApplicationError,
  isValidAdminLifecycleOperation,
  type AdminIdentityLifecycleApplicationServiceDependencies,
  type AdminLifecycleExternalClassification,
  type AdminLifecycleOperation,
  type AdminLifecycleOperationResult,
} from './adminIdentityLifecycleApplicationService';
import {
  AdminIdentityLifecyclePersistenceError,
  type AdminIdentityLifecyclePersistenceErrorCode,
} from './adminIdentityLifecycleRepository';

export interface ManageAdminLifecycleRequestContext {
  readonly auth?: {
    readonly uid: string;
    readonly token?: Record<string, unknown>;
  };
  readonly data?: unknown;
}

export interface ManageAdminLifecycleHandlerDependencies
  extends AdminIdentityLifecycleApplicationServiceDependencies {
  readonly service?: AdminIdentityLifecycleApplicationService;
}

const CHANGE_ROLE_ALLOWED_KEYS = new Set<string>([
  'operation',
  'targetUid',
  'expectedRevision',
  'targetRole',
]);

const DEACTIVATE_ALLOWED_KEYS = new Set<string>([
  'operation',
  'targetUid',
  'expectedRevision',
]);

const REACTIVATE_ALLOWED_KEYS = new Set<string>([
  'operation',
  'targetUid',
  'expectedRevision',
]);

const INITIALIZE_REVISION_ALLOWED_KEYS = new Set<string>([
  'operation',
  'targetUid',
]);

const PROTOTYPE_POLLUTION_KEYS = new Set<string>([
  '__proto__',
  'constructor',
  'prototype',
]);

const FORBIDDEN_AUTHORITY_SPOOF_KEYS = new Set<string>([
  'actorUid',
  'callerUid',
  'uid',
  'actorRole',
  'role',
  'isOwner',
  'isActive',
  'permissions',
  'activeOwnerCount',
  'trustedOwnerState',
  'explicitOwnerPromotionPolicy',
  'token',
  'password',
  'secret',
  'credential',
]);

function validatePlainPayloadObject(
  data: unknown
): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpsError(
      'invalid-argument',
      'Request payload must be a non-null plain JSON object.'
    );
  }
  return data as Record<string, unknown>;
}

function assertNoPrototypePollutionOrSpoofedClaims(
  payload: Record<string, unknown>
): void {
  for (const key of Object.keys(payload)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) {
      throw new HttpsError(
        'invalid-argument',
        'Prototype-pollution property keys are forbidden.'
      );
    }

    if (FORBIDDEN_AUTHORITY_SPOOF_KEYS.has(key)) {
      throw new HttpsError(
        'permission-denied',
        'Caller-supplied authority, identity, or verification claims are forbidden.'
      );
    }
  }
}

function assertExactAllowedPayloadKeys(
  payload: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  operation: AdminLifecycleOperation
): void {
  for (const key of Object.keys(payload)) {
    if (!allowedKeys.has(key)) {
      throw new HttpsError(
        'invalid-argument',
        `Unexpected field '${key}' in ${operation} payload.`
      );
    }
  }
}

export function mapApplicationClassificationToHttpsError(
  classification: AdminLifecycleExternalClassification,
  internalCode: string,
  customMessage?: string
): HttpsError {
  switch (classification) {
    case 'unauthenticated':
      return new HttpsError(
        'unauthenticated',
        'Authentication is required to perform administrative lifecycle operations.'
      );

    case 'permission-denied':
      return new HttpsError(
        'permission-denied',
        customMessage ||
          'Caller is not authorized to execute this administrative lifecycle operation.'
      );

    case 'invalid-argument':
      return new HttpsError(
        'invalid-argument',
        customMessage || 'Invalid administrative lifecycle request arguments.'
      );

    case 'not-found':
      return new HttpsError(
        'not-found',
        'Target administrative identity not found.'
      );

    case 'failed-precondition':
      return new HttpsError(
        'failed-precondition',
        customMessage || 'Administrative lifecycle state precondition failed.'
      );

    case 'conflict':
      // Map non-standard conflict to standard Firebase Functions 'aborted'
      return new HttpsError(
        'aborted',
        'Administrative revision or transaction conflict occurred; retry with the latest revision.'
      );

    case 'internal':
    default:
      return new HttpsError(
        'internal',
        'An internal error occurred while processing the administrative lifecycle operation.'
      );
  }
}

export function mapLifecycleErrorToHttpsError(error: unknown): HttpsError {
  if (error instanceof HttpsError) {
    return error;
  }

  if (error instanceof AdminLifecycleApplicationError) {
    return mapApplicationClassificationToHttpsError(
      error.classification,
      error.internalCode,
      error.message
    );
  }

  if (error instanceof AdminIdentityLifecyclePersistenceError) {
    const code: AdminIdentityLifecyclePersistenceErrorCode = error.code;
    switch (code) {
      case 'UNAUTHENTICATED_ACTOR':
        return new HttpsError(
          'unauthenticated',
          'Authentication is required to perform administrative lifecycle operations.'
        );

      case 'UNAUTHORIZED_ACTOR':
      case 'INACTIVE_ACTOR':
      case 'IDENTITY_MISMATCH':
      case 'IDENTITY_OR_PRIVILEGE_SPOOFING_DETECTED':
      case 'SELF_DEACTIVATION_FORBIDDEN':
      case 'SELF_DEMOTION_FORBIDDEN':
      case 'LAST_ACTIVE_OWNER_DEACTIVATION_FORBIDDEN':
      case 'LAST_ACTIVE_OWNER_DEMOTION_FORBIDDEN':
      case 'OWNER_PROMOTION_POLICY_NOT_ESTABLISHED':
        return new HttpsError(
          'permission-denied',
          'Caller is not authorized to execute this administrative lifecycle operation.'
        );

      case 'INVALID_TARGET_UID':
      case 'INVALID_TARGET_ROLE':
      case 'INVALID_REVISION':
      case 'INVALID_TRANSITION_TYPE':
      case 'INVALID_TRANSITION_INPUT':
      case 'TARGET_UID_MISMATCH':
      case 'INVALID_CLOCK_TIMESTAMP':
        return new HttpsError(
          'invalid-argument',
          'Invalid administrative lifecycle request arguments.'
        );

      case 'TARGET_ADMIN_NOT_FOUND':
        return new HttpsError(
          'not-found',
          'Target administrative identity not found.'
        );

      case 'NO_OP_TRANSITION':
      case 'ALREADY_INACTIVE':
      case 'ALREADY_ACTIVE':
      case 'REVISION_ALREADY_INITIALIZED':
        return new HttpsError(
          'failed-precondition',
          'Administrative lifecycle state precondition failed.'
        );

      case 'REVISION_CONFLICT':
      case 'TRANSACTION_CONFLICT_EXHAUSTED':
        return new HttpsError(
          'aborted',
          'Administrative revision or transaction conflict occurred; retry with the latest revision.'
        );

      case 'INCOMPLETE_OWNER_SNAPSHOT':
      case 'UNTRUSTED_OWNER_STATE_SNAPSHOT':
      case 'INVALID_ACTOR_ADMIN_RECORD':
      case 'INVALID_TARGET_ADMIN_RECORD':
      case 'AUDIT_EVENT_CONFLICT':
      case 'UNTRUSTED_ID_GENERATOR':
      case 'READ_AFTER_WRITE_FORBIDDEN':
      case 'PERSISTENCE_FAILURE':
      default:
        return new HttpsError(
          'internal',
          'An internal error occurred while processing administrative lifecycle persistence.'
        );
    }
  }

  return new HttpsError(
    'internal',
    'An internal error occurred while processing the administrative lifecycle operation.'
  );
}

export async function executeManageAdminLifecycle(
  request: ManageAdminLifecycleRequestContext,
  deps?: ManageAdminLifecycleHandlerDependencies
): Promise<AdminLifecycleOperationResult> {
  try {
    const rawCallerUid = request?.auth?.uid;
    const callerUid =
      typeof rawCallerUid === 'string' ? rawCallerUid.trim() : '';

    if (!callerUid || callerUid !== rawCallerUid) {
      throw new HttpsError(
        'unauthenticated',
        'Authentication is required to perform administrative lifecycle operations.'
      );
    }

    const payload = validatePlainPayloadObject(request?.data);
    assertNoPrototypePollutionOrSpoofedClaims(payload);

    const rawOperation = payload.operation;
    if (!isValidAdminLifecycleOperation(rawOperation)) {
      throw new HttpsError(
        'invalid-argument',
        `Unknown administrative lifecycle operation: ${String(rawOperation)}`
      );
    }

    const operation: AdminLifecycleOperation = rawOperation;

    const rawTargetUid = payload.targetUid;
    const targetUid =
      typeof rawTargetUid === 'string' ? rawTargetUid.trim() : '';
    if (!targetUid || targetUid !== rawTargetUid) {
      throw new HttpsError(
        'invalid-argument',
        'targetUid must be a non-empty trimmed string.'
      );
    }

    const service =
      deps?.service ?? new AdminIdentityLifecycleApplicationService(deps);

    switch (operation) {
      case 'ChangeRole': {
        assertExactAllowedPayloadKeys(
          payload,
          CHANGE_ROLE_ALLOWED_KEYS,
          operation
        );

        const rawExpectedRev = payload.expectedRevision;
        if (
          typeof rawExpectedRev !== 'number' ||
          !Number.isInteger(rawExpectedRev) ||
          !Number.isSafeInteger(rawExpectedRev) ||
          rawExpectedRev < 1
        ) {
          throw new HttpsError(
            'invalid-argument',
            'expectedRevision must be a positive integer >= 1.'
          );
        }

        const rawTargetRole = payload.targetRole;
        if (!isValidAdminRole(rawTargetRole)) {
          throw new HttpsError(
            'invalid-argument',
            `Invalid or non-canonical targetRole: ${String(rawTargetRole)}`
          );
        }

        if (rawTargetRole === AdminRole.Owner) {
          throw new HttpsError(
            'permission-denied',
            'Promotion to Owner is forbidden; no Owner promotion policy is established.'
          );
        }

        return await service.changeAdminRole({
          authenticatedActorUid: callerUid,
          targetUid,
          expectedRevision: rawExpectedRev,
          targetRole: rawTargetRole,
          untrustedClientPayload: payload,
        });
      }

      case 'Deactivate': {
        assertExactAllowedPayloadKeys(
          payload,
          DEACTIVATE_ALLOWED_KEYS,
          operation
        );

        const rawExpectedRev = payload.expectedRevision;
        if (
          typeof rawExpectedRev !== 'number' ||
          !Number.isInteger(rawExpectedRev) ||
          !Number.isSafeInteger(rawExpectedRev) ||
          rawExpectedRev < 1
        ) {
          throw new HttpsError(
            'invalid-argument',
            'expectedRevision must be a positive integer >= 1.'
          );
        }

        return await service.deactivateAdmin({
          authenticatedActorUid: callerUid,
          targetUid,
          expectedRevision: rawExpectedRev,
          untrustedClientPayload: payload,
        });
      }

      case 'Reactivate': {
        assertExactAllowedPayloadKeys(
          payload,
          REACTIVATE_ALLOWED_KEYS,
          operation
        );

        const rawExpectedRev = payload.expectedRevision;
        if (
          typeof rawExpectedRev !== 'number' ||
          !Number.isInteger(rawExpectedRev) ||
          !Number.isSafeInteger(rawExpectedRev) ||
          rawExpectedRev < 1
        ) {
          throw new HttpsError(
            'invalid-argument',
            'expectedRevision must be a positive integer >= 1.'
          );
        }

        return await service.reactivateAdmin({
          authenticatedActorUid: callerUid,
          targetUid,
          expectedRevision: rawExpectedRev,
          untrustedClientPayload: payload,
        });
      }

      case 'InitializeRevision': {
        assertExactAllowedPayloadKeys(
          payload,
          INITIALIZE_REVISION_ALLOWED_KEYS,
          operation
        );

        return await service.initializeLegacyRevision({
          authenticatedActorUid: callerUid,
          targetUid,
          untrustedClientPayload: payload,
        });
      }
    }
  } catch (error: unknown) {
    throw mapLifecycleErrorToHttpsError(error);
  }
}

export const manageAdminLifecycle = onCall(
  {
    enforceAppCheck: false,
  },
  async (request) => {
    return executeManageAdminLifecycle(request);
  }
);
