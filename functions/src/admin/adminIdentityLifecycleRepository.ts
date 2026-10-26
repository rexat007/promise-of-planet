import {
  AdminIdentityLifecycleContractError,
  AdminIdentityLifecycleTransitionType,
  systemLifecycleClock,
  type AdminIdentityLifecycleErrorCode,
  type AdminIdentityLifecycleStateSnapshot,
  type LifecycleClock,
  type UntrustedLifecycleClientClaims,
  type ValidatedAdminIdentityLifecycleTransitionIntent,
} from './adminIdentityLifecycleContract';
import type { AdminRole, AdminUser } from '../types/admin';
import {
  AuditAction,
  AuditTargetType,
  type AuditChange,
  type AuditEvent,
} from '../shared/auditContract';

export const ADMINS_COLLECTION = 'admins' as const;
export const ADMIN_AUDIT_LOGS_COLLECTION = 'audit_logs' as const;
export const DEFAULT_MAX_ADMIN_LIFECYCLE_SCAN_LIMIT = 500 as const;

export const AdminIdentityLifecycleAuditEventType = {
  ChangeRole: 'AdminRoleChanged',
  Deactivate: 'AdminDeactivated',
  Reactivate: 'AdminReactivated',
  InitializeRevision: 'AdminRevisionInitialized',
} as const;

export type AdminIdentityLifecycleAuditEventType =
  typeof AdminIdentityLifecycleAuditEventType[keyof typeof AdminIdentityLifecycleAuditEventType];

export type AdminIdentityLifecycleOperationType =
  | AdminIdentityLifecycleTransitionType
  | 'InitializeRevision';

export type AdminIdentityLifecyclePersistenceErrorCode =
  | AdminIdentityLifecycleErrorCode
  | 'REVISION_ALREADY_INITIALIZED'
  | 'INCOMPLETE_OWNER_SNAPSHOT'
  | 'AUDIT_EVENT_CONFLICT'
  | 'UNTRUSTED_ID_GENERATOR'
  | 'READ_AFTER_WRITE_FORBIDDEN'
  | 'TRANSACTION_CONFLICT_EXHAUSTED'
  | 'PERSISTENCE_FAILURE';

export class AdminIdentityLifecyclePersistenceError extends Error {
  public readonly code: AdminIdentityLifecyclePersistenceErrorCode;

  constructor(
    code: AdminIdentityLifecyclePersistenceErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AdminIdentityLifecyclePersistenceError';
    this.code = code;
  }
}

export interface AdminIdentityLifecycleAuditMetadata
  extends Readonly<Record<string, string | number | boolean | null>> {
  readonly eventType: AdminIdentityLifecycleAuditEventType;
  readonly transitionType: AdminIdentityLifecycleOperationType;
  readonly targetUid: string;
  readonly previousRole: AdminRole;
  readonly nextRole: AdminRole;
  readonly previousIsActive: boolean;
  readonly nextIsActive: boolean;
  readonly previousRevision: number | null;
  readonly nextRevision: number;
}

export interface AdminIdentityLifecycleAuditEvent extends AuditEvent {
  readonly targetType: typeof AuditTargetType.AdminUser;
  readonly changes: AuditChange[];
  readonly metadata: AdminIdentityLifecycleAuditMetadata;
}

export interface ExecuteAdminLifecycleTransitionAtomicParams {
  readonly auditEventId: string;
  readonly authenticatedActorUid: string;
  readonly targetUid: string;
  readonly expectedRevision: number;
  readonly transitionType: AdminIdentityLifecycleTransitionType;
  readonly targetRole?: AdminRole;
  readonly explicitOwnerPromotionPolicy?: unknown;
  readonly untrustedClientClaims?: UntrustedLifecycleClientClaims;
  readonly clock?: LifecycleClock;
}

export interface ChangeAdminRoleAtomicParams {
  readonly auditEventId: string;
  readonly authenticatedActorUid: string;
  readonly targetUid: string;
  readonly expectedRevision: number;
  readonly targetRole: AdminRole;
  readonly explicitOwnerPromotionPolicy?: unknown;
  readonly untrustedClientClaims?: UntrustedLifecycleClientClaims;
  readonly clock?: LifecycleClock;
}

export interface DeactivateAdminAtomicParams {
  readonly auditEventId: string;
  readonly authenticatedActorUid: string;
  readonly targetUid: string;
  readonly expectedRevision: number;
  readonly untrustedClientClaims?: UntrustedLifecycleClientClaims;
  readonly clock?: LifecycleClock;
}

export interface ReactivateAdminAtomicParams {
  readonly auditEventId: string;
  readonly authenticatedActorUid: string;
  readonly targetUid: string;
  readonly expectedRevision: number;
  readonly untrustedClientClaims?: UntrustedLifecycleClientClaims;
  readonly clock?: LifecycleClock;
}

export interface ExecuteAdminLifecycleTransitionAtomicResult {
  readonly transitionType: AdminIdentityLifecycleTransitionType;
  readonly actorUid: string;
  readonly targetUid: string;
  readonly previousState: AdminIdentityLifecycleStateSnapshot;
  readonly currentState: AdminIdentityLifecycleStateSnapshot;
  readonly previousRevision: number;
  readonly currentRevision: number;
  readonly verifiedActiveOwnerCount: number;
  readonly committedAtIso: string;
  readonly auditEvent: AdminIdentityLifecycleAuditEvent;
}

export interface InitializeLegacyAdminRevisionAtomicParams {
  readonly auditEventId: string;
  readonly authenticatedActorUid: string;
  readonly targetUid: string;
  readonly untrustedClientClaims?: UntrustedLifecycleClientClaims;
  readonly clock?: LifecycleClock;
}

export interface InitializeLegacyAdminRevisionAtomicResult {
  readonly transitionType: 'InitializeRevision';
  readonly actorUid: string;
  readonly targetUid: string;
  readonly initializedState: AdminIdentityLifecycleStateSnapshot;
  readonly previousRevision: null;
  readonly currentRevision: 1;
  readonly committedAtIso: string;
  readonly auditEvent: AdminIdentityLifecycleAuditEvent;
}

export interface AdminIdentityLifecycleRepository {
  executeLifecycleTransitionAtomic(
    params: ExecuteAdminLifecycleTransitionAtomicParams
  ): Promise<ExecuteAdminLifecycleTransitionAtomicResult>;

  changeAdminRoleAtomic(
    params: ChangeAdminRoleAtomicParams
  ): Promise<ExecuteAdminLifecycleTransitionAtomicResult>;

  deactivateAdminAtomic(
    params: DeactivateAdminAtomicParams
  ): Promise<ExecuteAdminLifecycleTransitionAtomicResult>;

  reactivateAdminAtomic(
    params: ReactivateAdminAtomicParams
  ): Promise<ExecuteAdminLifecycleTransitionAtomicResult>;

  initializeLegacyAdminRevisionAtomic(
    params: InitializeLegacyAdminRevisionAtomicParams
  ): Promise<InitializeLegacyAdminRevisionAtomicResult>;
}

const VALID_LOCATOR_ID_REGEX = /^[A-Za-z0-9_-]{8,128}$/;
const WEAK_SEQUENTIAL_OR_TIMESTAMP_ID_REGEX = /^(?:aud_)?\d{8,}$/;

function generateCsprngHex(byteLength: number): string {
  const cryptoObj = (
    globalThis as unknown as {
      crypto?: { getRandomValues?: (buf: Uint8Array) => Uint8Array };
    }
  ).crypto;

  if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') {
    throw new AdminIdentityLifecyclePersistenceError(
      'UNTRUSTED_ID_GENERATOR',
      'Cryptographically secure random number generator (globalThis.crypto.getRandomValues) is unavailable.'
    );
  }

  const bytes = new Uint8Array(byteLength);
  cryptoObj.getRandomValues(bytes);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function generateCryptographicLifecycleAuditEventId(): string {
  return `aud_adm_${generateCsprngHex(16)}`;
}

export function validateLifecycleAuditEventId(
  rawId: unknown,
  label = 'Audit event ID'
): string {
  const trimmed = typeof rawId === 'string' ? rawId.trim() : '';
  if (
    !trimmed ||
    trimmed !== rawId ||
    !VALID_LOCATOR_ID_REGEX.test(trimmed)
  ) {
    throw new AdminIdentityLifecyclePersistenceError(
      'UNTRUSTED_ID_GENERATOR',
      `${label} must be a non-empty, trimmed alphanumeric locator between 8 and 128 characters.`
    );
  }

  if (WEAK_SEQUENTIAL_OR_TIMESTAMP_ID_REGEX.test(trimmed)) {
    throw new AdminIdentityLifecyclePersistenceError(
      'UNTRUSTED_ID_GENERATOR',
      `${label} (${trimmed}) appears to be a sequential or timestamp identifier rather than a unique locator.`
    );
  }

  return trimmed;
}

export function resolveLifecyclePersistenceClockIso(
  clock: LifecycleClock = systemLifecycleClock
): string {
  if (typeof clock !== 'function') {
    throw new AdminIdentityLifecyclePersistenceError(
      'INVALID_CLOCK_TIMESTAMP',
      'Lifecycle clock must be a callable function returning a valid Date.'
    );
  }
  const now = clock();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new AdminIdentityLifecyclePersistenceError(
      'INVALID_CLOCK_TIMESTAMP',
      'Injected lifecycle clock returned an invalid Date instance.'
    );
  }
  return new Date(now.getTime()).toISOString();
}

export function buildLifecycleTransitionAuditEvent(params: {
  readonly auditEventId: string;
  readonly intent: ValidatedAdminIdentityLifecycleTransitionIntent;
}): AdminIdentityLifecycleAuditEvent {
  const validatedId = validateLifecycleAuditEventId(
    params.auditEventId,
    'Audit event ID'
  );
  const { intent } = params;
  const { auditIntent } = intent;

  const eventType: AdminIdentityLifecycleAuditEventType =
    intent.transitionType === AdminIdentityLifecycleTransitionType.ChangeRole
      ? AdminIdentityLifecycleAuditEventType.ChangeRole
      : intent.transitionType ===
          AdminIdentityLifecycleTransitionType.Deactivate
        ? AdminIdentityLifecycleAuditEventType.Deactivate
        : AdminIdentityLifecycleAuditEventType.Reactivate;

  const changes: AuditChange[] = auditIntent.changes.map((change) => ({
    field: change.field,
    previousValue: change.previousValue ?? null,
    newValue: change.newValue ?? null,
  }));

  const metadata: AdminIdentityLifecycleAuditMetadata = Object.freeze({
    eventType,
    transitionType: auditIntent.metadata.transitionType,
    targetUid: auditIntent.metadata.targetUid,
    previousRole: auditIntent.metadata.previousRole,
    nextRole: auditIntent.metadata.nextRole,
    previousIsActive: auditIntent.metadata.previousIsActive,
    nextIsActive: auditIntent.metadata.nextIsActive,
    previousRevision: auditIntent.metadata.previousRevision,
    nextRevision: auditIntent.metadata.nextRevision,
  });

  return Object.freeze({
    id: validatedId,
    timestamp: auditIntent.timestamp,
    actorUserId: auditIntent.actorUserId,
    actorName: auditIntent.actorName,
    actorRole: auditIntent.actorRole,
    action: auditIntent.action,
    targetType: AuditTargetType.AdminUser,
    targetId: auditIntent.targetId,
    targetTitle: auditIntent.targetTitle,
    changes,
    metadata,
  });
}

export function buildRevisionInitializedAuditEvent(params: {
  readonly auditEventId: string;
  readonly timestamp: string;
  readonly actor: AdminUser;
  readonly target: AdminUser;
}): AdminIdentityLifecycleAuditEvent {
  const validatedId = validateLifecycleAuditEventId(
    params.auditEventId,
    'Audit event ID'
  );
  const { timestamp, actor, target } = params;

  const changes: AuditChange[] = [
    {
      field: 'revision',
      previousValue: null,
      newValue: 1,
    },
  ];

  const metadata: AdminIdentityLifecycleAuditMetadata = Object.freeze({
    eventType: AdminIdentityLifecycleAuditEventType.InitializeRevision,
    transitionType: 'InitializeRevision',
    targetUid: target.id,
    previousRole: target.role,
    nextRole: target.role,
    previousIsActive: target.isActive,
    nextIsActive: target.isActive,
    previousRevision: null,
    nextRevision: 1,
  });

  return Object.freeze({
    id: validatedId,
    timestamp,
    actorUserId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    action: AuditAction.Updated,
    targetType: AuditTargetType.AdminUser,
    targetId: target.id,
    targetTitle: `${target.email} (${target.role})`,
    changes,
    metadata,
  });
}

export function serializeLifecycleAuditEventForPersistence(
  event: AdminIdentityLifecycleAuditEvent
): Record<string, unknown> {
  return {
    id: event.id,
    timestamp: event.timestamp,
    actorUserId: event.actorUserId,
    actorName: event.actorName,
    actorRole: event.actorRole,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    targetTitle: event.targetTitle ?? null,
    changes: event.changes.map((c) => ({
      field: c.field,
      previousValue: c.previousValue ?? null,
      newValue: c.newValue ?? null,
    })),
    metadata: {
      eventType: event.metadata.eventType,
      transitionType: event.metadata.transitionType,
      targetUid: event.metadata.targetUid,
      previousRole: event.metadata.previousRole,
      nextRole: event.metadata.nextRole,
      previousIsActive: event.metadata.previousIsActive,
      nextIsActive: event.metadata.nextIsActive,
      previousRevision: event.metadata.previousRevision,
      nextRevision: event.metadata.nextRevision,
    },
  };
}

export function mapLifecycleContractErrorToPersistenceError(
  error: unknown
): AdminIdentityLifecyclePersistenceError {
  if (error instanceof AdminIdentityLifecyclePersistenceError) {
    return error;
  }
  if (error instanceof AdminIdentityLifecycleContractError) {
    return new AdminIdentityLifecyclePersistenceError(
      error.code,
      error.message
    );
  }
  const code = (error as { code?: string } | null)?.code;
  if (code === 'ALREADY_EXISTS') {
    return new AdminIdentityLifecyclePersistenceError(
      'AUDIT_EVENT_CONFLICT',
      error instanceof Error
        ? error.message
        : 'Audit event document ID already exists.'
    );
  }
  if (code === 'ABORTED') {
    return new AdminIdentityLifecyclePersistenceError(
      'TRANSACTION_CONFLICT_EXHAUSTED',
      error instanceof Error
        ? error.message
        : 'Firestore transaction aborted after exhausting conflict retries.'
    );
  }
  const message =
    error instanceof Error
      ? error.message
      : 'Unexpected administrative identity lifecycle persistence error.';
  return new AdminIdentityLifecyclePersistenceError(
    'PERSISTENCE_FAILURE',
    message
  );
}
