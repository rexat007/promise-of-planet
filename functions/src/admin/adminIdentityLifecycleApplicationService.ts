import { AdminRole, isValidAdminRole } from '../types/admin';
import {
  AdminIdentityLifecyclePersistenceError,
  generateCryptographicLifecycleAuditEventId,
  type AdminIdentityLifecycleAuditEvent,
  type AdminIdentityLifecyclePersistenceErrorCode,
  type AdminIdentityLifecycleRepository,
  type ExecuteAdminLifecycleTransitionAtomicResult,
  type InitializeLegacyAdminRevisionAtomicResult,
} from './adminIdentityLifecycleRepository';
import { FirestoreAdminIdentityLifecycleRepository } from './firestoreAdminIdentityLifecycleRepository';
import {
  systemLifecycleClock,
  type LifecycleClock,
} from './adminIdentityLifecycleContract';

export const ADMIN_LIFECYCLE_OPERATIONS = [
  'ChangeRole',
  'Deactivate',
  'Reactivate',
  'InitializeRevision',
] as const;

export type AdminLifecycleOperation =
  (typeof ADMIN_LIFECYCLE_OPERATIONS)[number];

export function isValidAdminLifecycleOperation(
  op: unknown
): op is AdminLifecycleOperation {
  return (
    typeof op === 'string' &&
    (ADMIN_LIFECYCLE_OPERATIONS as readonly string[]).includes(op)
  );
}

export type AdminLifecycleExternalClassification =
  | 'unauthenticated'
  | 'permission-denied'
  | 'invalid-argument'
  | 'not-found'
  | 'failed-precondition'
  | 'conflict'
  | 'internal';

export class AdminLifecycleApplicationError extends Error {
  public readonly classification: AdminLifecycleExternalClassification;
  public readonly internalCode: string;

  constructor(
    classification: AdminLifecycleExternalClassification,
    internalCode: string,
    message: string
  ) {
    super(message);
    this.name = 'AdminLifecycleApplicationError';
    this.classification = classification;
    this.internalCode = internalCode;
  }
}

export interface SanitizedAdminIdentityStateDto {
  readonly id: string;
  readonly role: AdminRole;
  readonly isActive: boolean;
  readonly revision: number;
}

export interface SanitizedLifecycleAuditReceiptDto {
  readonly auditEventId: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly timestamp: string;
}

export interface AdminLifecycleOperationResult {
  readonly operation: AdminLifecycleOperation;
  readonly targetUid: string;
  readonly previousRevision: number | null;
  readonly currentRevision: number;
  readonly committedAtIso: string;
  readonly admin: SanitizedAdminIdentityStateDto;
  readonly auditReceipt: SanitizedLifecycleAuditReceiptDto;
}

export interface ChangeAdminRoleCommand {
  readonly authenticatedActorUid: string;
  readonly targetUid: string;
  readonly expectedRevision: number;
  readonly targetRole: AdminRole;
  readonly untrustedClientPayload?: Record<string, unknown>;
}

export interface DeactivateAdminCommand {
  readonly authenticatedActorUid: string;
  readonly targetUid: string;
  readonly expectedRevision: number;
  readonly untrustedClientPayload?: Record<string, unknown>;
}

export interface ReactivateAdminCommand {
  readonly authenticatedActorUid: string;
  readonly targetUid: string;
  readonly expectedRevision: number;
  readonly untrustedClientPayload?: Record<string, unknown>;
}

export interface InitializeLegacyRevisionCommand {
  readonly authenticatedActorUid: string;
  readonly targetUid: string;
  readonly untrustedClientPayload?: Record<string, unknown>;
}

export interface ExecuteLifecycleOperationCommand {
  readonly authenticatedActorUid: string;
  readonly operation: AdminLifecycleOperation;
  readonly targetUid: string;
  readonly expectedRevision?: number;
  readonly targetRole?: AdminRole;
  readonly untrustedClientPayload?: Record<string, unknown>;
}

export interface AdminIdentityLifecycleApplicationServiceDependencies {
  readonly repository?: AdminIdentityLifecycleRepository;
  readonly clock?: LifecycleClock;
  readonly generateAuditEventId?: () => string;
}

const CHANGE_ROLE_ALLOWED_KEYS = new Set<string>([
  'operation',
  'action',
  'targetUid',
  'expectedRevision',
  'targetRole',
]);

const DEACTIVATE_ALLOWED_KEYS = new Set<string>([
  'operation',
  'action',
  'targetUid',
  'expectedRevision',
]);

const REACTIVATE_ALLOWED_KEYS = new Set<string>([
  'operation',
  'action',
  'targetUid',
  'expectedRevision',
]);

const INITIALIZE_REVISION_ALLOWED_KEYS = new Set<string>([
  'operation',
  'action',
  'targetUid',
]);

const FORBIDDEN_SPOOFED_KEYS = new Set<string>([
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

function validateAndTrimActorUid(rawUid: unknown): string {
  const actorUid = typeof rawUid === 'string' ? rawUid.trim() : '';
  if (!actorUid || actorUid !== rawUid) {
    throw new AdminLifecycleApplicationError(
      'unauthenticated',
      'UNAUTHENTICATED_ACTOR',
      'An authenticated Firebase actor UID is required.'
    );
  }
  return actorUid;
}

function validateAndTrimTargetUid(rawUid: unknown): string {
  const targetUid = typeof rawUid === 'string' ? rawUid.trim() : '';
  if (!targetUid || targetUid !== rawUid) {
    throw new AdminLifecycleApplicationError(
      'invalid-argument',
      'INVALID_TARGET_UID',
      'targetUid must be a non-empty, trimmed Firebase UID string.'
    );
  }
  return targetUid;
}

function validateExpectedRevision(rawRev: unknown): number {
  if (
    typeof rawRev !== 'number' ||
    !Number.isInteger(rawRev) ||
    !Number.isSafeInteger(rawRev) ||
    rawRev < 1
  ) {
    throw new AdminLifecycleApplicationError(
      'invalid-argument',
      'INVALID_REVISION',
      'expectedRevision must be a positive integer >= 1.'
    );
  }
  return rawRev;
}

function assertNoSpoofedOrUnexpectedFields(
  payload: Record<string, unknown> | undefined,
  allowedKeys: ReadonlySet<string>,
  operation: AdminLifecycleOperation
): void {
  if (payload === undefined) {
    return;
  }

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AdminLifecycleApplicationError(
      'invalid-argument',
      'INVALID_TRANSITION_INPUT',
      'Request payload must be a non-null object.'
    );
  }

  for (const key of Object.keys(payload)) {
    if (FORBIDDEN_SPOOFED_KEYS.has(key)) {
      throw new AdminLifecycleApplicationError(
        'permission-denied',
        'IDENTITY_OR_PRIVILEGE_SPOOFING_DETECTED',
        `Client-supplied authority or credential claim '${key}' is forbidden.`
      );
    }

    if (!allowedKeys.has(key)) {
      throw new AdminLifecycleApplicationError(
        'invalid-argument',
        'UNEXPECTED_PAYLOAD_FIELD',
        `Unexpected property '${key}' in ${operation} payload.`
      );
    }
  }
}

function sanitizeAuditReceipt(
  event: AdminIdentityLifecycleAuditEvent
): SanitizedLifecycleAuditReceiptDto {
  return {
    auditEventId: event.id,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    timestamp: event.timestamp,
  };
}

export function mapPersistenceErrorToApplicationError(
  err: unknown
): AdminLifecycleApplicationError {
  if (err instanceof AdminLifecycleApplicationError) {
    return err;
  }

  if (err instanceof AdminIdentityLifecyclePersistenceError) {
    const code: AdminIdentityLifecyclePersistenceErrorCode = err.code;

    switch (code) {
      case 'UNAUTHENTICATED_ACTOR':
        return new AdminLifecycleApplicationError(
          'unauthenticated',
          code,
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
        return new AdminLifecycleApplicationError(
          'permission-denied',
          code,
          'Caller is not authorized to execute this administrative lifecycle operation.'
        );

      case 'INVALID_TARGET_UID':
      case 'INVALID_TARGET_ROLE':
      case 'INVALID_REVISION':
      case 'INVALID_TRANSITION_TYPE':
      case 'INVALID_TRANSITION_INPUT':
      case 'TARGET_UID_MISMATCH':
      case 'INVALID_CLOCK_TIMESTAMP':
        return new AdminLifecycleApplicationError(
          'invalid-argument',
          code,
          'Invalid administrative lifecycle request arguments.'
        );

      case 'TARGET_ADMIN_NOT_FOUND':
        return new AdminLifecycleApplicationError(
          'not-found',
          code,
          'Target administrative identity not found.'
        );

      case 'NO_OP_TRANSITION':
      case 'ALREADY_INACTIVE':
      case 'ALREADY_ACTIVE':
      case 'REVISION_ALREADY_INITIALIZED':
        return new AdminLifecycleApplicationError(
          'failed-precondition',
          code,
          'Administrative lifecycle state precondition failed.'
        );

      case 'REVISION_CONFLICT':
      case 'TRANSACTION_CONFLICT_EXHAUSTED':
        return new AdminLifecycleApplicationError(
          'conflict',
          code,
          'Administrative revision or transaction conflict occurred; retry with latest revision.'
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
        return new AdminLifecycleApplicationError(
          'internal',
          code,
          'An internal error occurred while processing administrative lifecycle persistence.'
        );
    }
  }

  const message =
    err instanceof Error
      ? err.message
      : 'Unexpected administrative lifecycle application failure.';
  return new AdminLifecycleApplicationError(
    'internal',
    'INTERNAL_ERROR',
    message
  );
}

export class AdminIdentityLifecycleApplicationService {
  private readonly repository: AdminIdentityLifecycleRepository;
  private readonly clock: LifecycleClock;
  private readonly generateAuditEventId: () => string;

  constructor(deps?: AdminIdentityLifecycleApplicationServiceDependencies) {
    this.repository =
      deps?.repository ?? new FirestoreAdminIdentityLifecycleRepository();
    this.clock = deps?.clock ?? systemLifecycleClock;
    this.generateAuditEventId =
      deps?.generateAuditEventId ?? generateCryptographicLifecycleAuditEventId;
  }

  public async changeAdminRole(
    command: ChangeAdminRoleCommand
  ): Promise<AdminLifecycleOperationResult> {
    try {
      if (!command || typeof command !== 'object' || Array.isArray(command)) {
        throw new AdminLifecycleApplicationError(
          'invalid-argument',
          'INVALID_TRANSITION_INPUT',
          'Command parameters must be a non-null object.'
        );
      }

      const actorUid = validateAndTrimActorUid(command.authenticatedActorUid);
      assertNoSpoofedOrUnexpectedFields(
        command.untrustedClientPayload,
        CHANGE_ROLE_ALLOWED_KEYS,
        'ChangeRole'
      );

      const targetUid = validateAndTrimTargetUid(command.targetUid);
      const expectedRevision = validateExpectedRevision(
        command.expectedRevision
      );

      if (!isValidAdminRole(command.targetRole)) {
        throw new AdminLifecycleApplicationError(
          'invalid-argument',
          'INVALID_TARGET_ROLE',
          `Invalid or non-canonical targetRole (${String(command.targetRole)}).`
        );
      }

      if (command.targetRole === AdminRole.Owner) {
        throw new AdminLifecycleApplicationError(
          'permission-denied',
          'OWNER_PROMOTION_POLICY_NOT_ESTABLISHED',
          'Promotion to Owner is forbidden; no Owner promotion policy is established.'
        );
      }

      const auditEventId = this.generateAuditEventId();

      const result: ExecuteAdminLifecycleTransitionAtomicResult =
        await this.repository.changeAdminRoleAtomic({
          auditEventId,
          authenticatedActorUid: actorUid,
          targetUid,
          expectedRevision,
          targetRole: command.targetRole,
          clock: this.clock,
        });

      return {
        operation: 'ChangeRole',
        targetUid: result.targetUid,
        previousRevision: result.previousRevision,
        currentRevision: result.currentRevision,
        committedAtIso: result.committedAtIso,
        admin: {
          id: result.currentState.id,
          role: result.currentState.role,
          isActive: result.currentState.isActive,
          revision: result.currentState.revision,
        },
        auditReceipt: sanitizeAuditReceipt(result.auditEvent),
      };
    } catch (err: unknown) {
      throw mapPersistenceErrorToApplicationError(err);
    }
  }

  public async deactivateAdmin(
    command: DeactivateAdminCommand
  ): Promise<AdminLifecycleOperationResult> {
    try {
      if (!command || typeof command !== 'object' || Array.isArray(command)) {
        throw new AdminLifecycleApplicationError(
          'invalid-argument',
          'INVALID_TRANSITION_INPUT',
          'Command parameters must be a non-null object.'
        );
      }

      const actorUid = validateAndTrimActorUid(command.authenticatedActorUid);
      assertNoSpoofedOrUnexpectedFields(
        command.untrustedClientPayload,
        DEACTIVATE_ALLOWED_KEYS,
        'Deactivate'
      );

      const targetUid = validateAndTrimTargetUid(command.targetUid);
      const expectedRevision = validateExpectedRevision(
        command.expectedRevision
      );

      const auditEventId = this.generateAuditEventId();

      const result: ExecuteAdminLifecycleTransitionAtomicResult =
        await this.repository.deactivateAdminAtomic({
          auditEventId,
          authenticatedActorUid: actorUid,
          targetUid,
          expectedRevision,
          clock: this.clock,
        });

      return {
        operation: 'Deactivate',
        targetUid: result.targetUid,
        previousRevision: result.previousRevision,
        currentRevision: result.currentRevision,
        committedAtIso: result.committedAtIso,
        admin: {
          id: result.currentState.id,
          role: result.currentState.role,
          isActive: result.currentState.isActive,
          revision: result.currentState.revision,
        },
        auditReceipt: sanitizeAuditReceipt(result.auditEvent),
      };
    } catch (err: unknown) {
      throw mapPersistenceErrorToApplicationError(err);
    }
  }

  public async reactivateAdmin(
    command: ReactivateAdminCommand
  ): Promise<AdminLifecycleOperationResult> {
    try {
      if (!command || typeof command !== 'object' || Array.isArray(command)) {
        throw new AdminLifecycleApplicationError(
          'invalid-argument',
          'INVALID_TRANSITION_INPUT',
          'Command parameters must be a non-null object.'
        );
      }

      const actorUid = validateAndTrimActorUid(command.authenticatedActorUid);
      assertNoSpoofedOrUnexpectedFields(
        command.untrustedClientPayload,
        REACTIVATE_ALLOWED_KEYS,
        'Reactivate'
      );

      const targetUid = validateAndTrimTargetUid(command.targetUid);
      const expectedRevision = validateExpectedRevision(
        command.expectedRevision
      );

      const auditEventId = this.generateAuditEventId();

      const result: ExecuteAdminLifecycleTransitionAtomicResult =
        await this.repository.reactivateAdminAtomic({
          auditEventId,
          authenticatedActorUid: actorUid,
          targetUid,
          expectedRevision,
          clock: this.clock,
        });

      return {
        operation: 'Reactivate',
        targetUid: result.targetUid,
        previousRevision: result.previousRevision,
        currentRevision: result.currentRevision,
        committedAtIso: result.committedAtIso,
        admin: {
          id: result.currentState.id,
          role: result.currentState.role,
          isActive: result.currentState.isActive,
          revision: result.currentState.revision,
        },
        auditReceipt: sanitizeAuditReceipt(result.auditEvent),
      };
    } catch (err: unknown) {
      throw mapPersistenceErrorToApplicationError(err);
    }
  }

  public async initializeLegacyRevision(
    command: InitializeLegacyRevisionCommand
  ): Promise<AdminLifecycleOperationResult> {
    try {
      if (!command || typeof command !== 'object' || Array.isArray(command)) {
        throw new AdminLifecycleApplicationError(
          'invalid-argument',
          'INVALID_TRANSITION_INPUT',
          'Command parameters must be a non-null object.'
        );
      }

      const actorUid = validateAndTrimActorUid(command.authenticatedActorUid);
      assertNoSpoofedOrUnexpectedFields(
        command.untrustedClientPayload,
        INITIALIZE_REVISION_ALLOWED_KEYS,
        'InitializeRevision'
      );

      const targetUid = validateAndTrimTargetUid(command.targetUid);
      const auditEventId = this.generateAuditEventId();

      const result: InitializeLegacyAdminRevisionAtomicResult =
        await this.repository.initializeLegacyAdminRevisionAtomic({
          auditEventId,
          authenticatedActorUid: actorUid,
          targetUid,
          clock: this.clock,
        });

      return {
        operation: 'InitializeRevision',
        targetUid: result.targetUid,
        previousRevision: null,
        currentRevision: 1,
        committedAtIso: result.committedAtIso,
        admin: {
          id: result.initializedState.id,
          role: result.initializedState.role,
          isActive: result.initializedState.isActive,
          revision: 1,
        },
        auditReceipt: sanitizeAuditReceipt(result.auditEvent),
      };
    } catch (err: unknown) {
      throw mapPersistenceErrorToApplicationError(err);
    }
  }

  public async executeOperation(
    command: ExecuteLifecycleOperationCommand
  ): Promise<AdminLifecycleOperationResult> {
    if (!command || typeof command !== 'object' || Array.isArray(command)) {
      throw new AdminLifecycleApplicationError(
        'invalid-argument',
        'INVALID_TRANSITION_INPUT',
        'Command parameters must be a non-null object.'
      );
    }

    if (!isValidAdminLifecycleOperation(command.operation)) {
      throw new AdminLifecycleApplicationError(
        'invalid-argument',
        'UNKNOWN_OPERATION',
        `Unknown administrative lifecycle operation: ${String(command.operation)}`
      );
    }

    switch (command.operation) {
      case 'ChangeRole':
        if (command.expectedRevision === undefined) {
          throw new AdminLifecycleApplicationError(
            'invalid-argument',
            'INVALID_REVISION',
            'expectedRevision is required for ChangeRole operation.'
          );
        }
        if (command.targetRole === undefined) {
          throw new AdminLifecycleApplicationError(
            'invalid-argument',
            'INVALID_TARGET_ROLE',
            'targetRole is required for ChangeRole operation.'
          );
        }
        return this.changeAdminRole({
          authenticatedActorUid: command.authenticatedActorUid,
          targetUid: command.targetUid,
          expectedRevision: command.expectedRevision,
          targetRole: command.targetRole,
          untrustedClientPayload: command.untrustedClientPayload,
        });

      case 'Deactivate':
        if (command.expectedRevision === undefined) {
          throw new AdminLifecycleApplicationError(
            'invalid-argument',
            'INVALID_REVISION',
            'expectedRevision is required for Deactivate operation.'
          );
        }
        return this.deactivateAdmin({
          authenticatedActorUid: command.authenticatedActorUid,
          targetUid: command.targetUid,
          expectedRevision: command.expectedRevision,
          untrustedClientPayload: command.untrustedClientPayload,
        });

      case 'Reactivate':
        if (command.expectedRevision === undefined) {
          throw new AdminLifecycleApplicationError(
            'invalid-argument',
            'INVALID_REVISION',
            'expectedRevision is required for Reactivate operation.'
          );
        }
        return this.reactivateAdmin({
          authenticatedActorUid: command.authenticatedActorUid,
          targetUid: command.targetUid,
          expectedRevision: command.expectedRevision,
          untrustedClientPayload: command.untrustedClientPayload,
        });

      case 'InitializeRevision':
        return this.initializeLegacyRevision({
          authenticatedActorUid: command.authenticatedActorUid,
          targetUid: command.targetUid,
          untrustedClientPayload: command.untrustedClientPayload,
        });
    }
  }
}
