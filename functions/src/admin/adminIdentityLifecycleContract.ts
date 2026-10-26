import { AdminAuthorizationService } from './adminAuthorizationService';
import {
  AdminPermission,
  AdminRole,
  isValidAdminRole,
  type AdminUser,
} from '../types/admin';
import {
  AuditAction,
  AuditTargetType,
  type AuditChange,
} from '../shared/auditContract';

/**
 * CONCURRENCY & TRANSACTIONAL AUTHORITY NOTICE (AUTH-04A1 -> AUTH-04A2):
 * This module implements a pure, deterministic domain validation contract over
 * point-in-time snapshots. A pure function CANNOT by itself prevent TOCTOU races
 * or concurrent Owner demotion/deactivation across parallel requests.
 *
 * AUTH-04A2 MUST re-read `admins/{uid}` and revalidate both record revisions and
 * the active-Owner invariant inside an atomic Firestore transaction before
 * committing any state mutation or audit log entry.
 */
export const LIFECYCLE_CONCURRENCY_REVALIDATION_NOTICE =
  'PURE_CONTRACT_ONLY: AUTH-04A2 must revalidate target revision and active-Owner invariants inside a Firestore transaction before writing.' as const;

export const TRUSTED_SERVER_OWNER_SNAPSHOT_ORIGIN =
  'SERVER_FIRESTORE_ADMINS_SNAPSHOT' as const;

export const AdminIdentityLifecycleTransitionType = {
  ChangeRole: 'ChangeRole',
  Deactivate: 'Deactivate',
  Reactivate: 'Reactivate',
} as const;

export type AdminIdentityLifecycleTransitionType =
  typeof AdminIdentityLifecycleTransitionType[keyof typeof AdminIdentityLifecycleTransitionType];

export type AdminIdentityLifecycleErrorCode =
  | 'UNAUTHENTICATED_ACTOR'
  | 'UNAUTHORIZED_ACTOR'
  | 'INACTIVE_ACTOR'
  | 'IDENTITY_MISMATCH'
  | 'IDENTITY_OR_PRIVILEGE_SPOOFING_DETECTED'
  | 'TARGET_ADMIN_NOT_FOUND'
  | 'INVALID_ACTOR_ADMIN_RECORD'
  | 'INVALID_TARGET_ADMIN_RECORD'
  | 'INVALID_TARGET_UID'
  | 'TARGET_UID_MISMATCH'
  | 'INVALID_TRANSITION_TYPE'
  | 'INVALID_TRANSITION_INPUT'
  | 'INVALID_TARGET_ROLE'
  | 'NO_OP_TRANSITION'
  | 'ALREADY_INACTIVE'
  | 'ALREADY_ACTIVE'
  | 'SELF_DEACTIVATION_FORBIDDEN'
  | 'SELF_DEMOTION_FORBIDDEN'
  | 'LAST_ACTIVE_OWNER_DEACTIVATION_FORBIDDEN'
  | 'LAST_ACTIVE_OWNER_DEMOTION_FORBIDDEN'
  | 'UNTRUSTED_OWNER_STATE_SNAPSHOT'
  | 'OWNER_PROMOTION_POLICY_NOT_ESTABLISHED'
  | 'INVALID_REVISION'
  | 'REVISION_CONFLICT'
  | 'INVALID_CLOCK_TIMESTAMP';

export class AdminIdentityLifecycleContractError extends Error {
  public readonly code: AdminIdentityLifecycleErrorCode;

  constructor(code: AdminIdentityLifecycleErrorCode, message: string) {
    super(message);
    this.name = 'AdminIdentityLifecycleContractError';
    this.code = code;
  }
}

export type LifecycleClock = () => Date;

export const systemLifecycleClock: LifecycleClock = () => new Date();

export interface VersionedAdminIdentityRecord extends AdminUser {
  readonly revision?: number;
}

/**
 * Trusted server-derived snapshot of active Owner UIDs resolved from `admins/{uid}`.
 * Caller-supplied numbers or untrusted client counts must never be accepted.
 */
export interface TrustedServerOwnerStateSnapshot {
  readonly origin: typeof TRUSTED_SERVER_OWNER_SNAPSHOT_ORIGIN;
  readonly activeOwnerUids: ReadonlyArray<string>;
  readonly capturedAtIso?: string;
}

/**
 * Optional untrusted client request fields inspected to detect and fail closed
 * on any attempt by a caller to spoof identity, privileges, or Owner counts.
 */
export interface UntrustedLifecycleClientClaims {
  readonly actorUid?: unknown;
  readonly callerUid?: unknown;
  readonly uid?: unknown;
  readonly actorRole?: unknown;
  readonly role?: unknown;
  readonly isOwner?: unknown;
  readonly isActive?: unknown;
  readonly permissions?: unknown;
  readonly activeOwnerCount?: unknown;
  readonly trustedOwnerState?: unknown;
  readonly explicitOwnerPromotionPolicy?: unknown;
}

export interface ValidateAdminIdentityLifecycleTransitionInput {
  readonly authenticatedActorUid: string;
  readonly resolvedActorAdmin: VersionedAdminIdentityRecord | null | undefined;
  readonly targetUid: string;
  readonly resolvedTargetAdmin: VersionedAdminIdentityRecord | null | undefined;
  readonly currentTargetRevision?: number;
  readonly expectedRevision: number;
  readonly transitionType: AdminIdentityLifecycleTransitionType;
  readonly targetRole?: AdminRole;
  readonly trustedOwnerState: TrustedServerOwnerStateSnapshot | null | undefined;
  readonly explicitOwnerPromotionPolicy?: unknown;
  readonly untrustedClientClaims?: UntrustedLifecycleClientClaims;
}

export interface AdminIdentityLifecycleStateSnapshot {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: AdminRole;
  readonly isActive: boolean;
  readonly revision: number;
}

export interface AdminIdentityLifecycleAuditIntent {
  readonly timestamp: string;
  readonly actorUserId: string;
  readonly actorName: string;
  readonly actorRole: AdminRole;
  readonly action: AuditAction;
  readonly targetType: typeof AuditTargetType.AdminUser;
  readonly targetId: string;
  readonly targetTitle: string;
  readonly changes: ReadonlyArray<AuditChange>;
  readonly metadata: Readonly<{
    transitionType: AdminIdentityLifecycleTransitionType;
    targetUid: string;
    previousRole: AdminRole;
    nextRole: AdminRole;
    previousIsActive: boolean;
    nextIsActive: boolean;
    previousRevision: number;
    nextRevision: number;
  }>;
}

export interface ValidatedAdminIdentityLifecycleTransitionIntent {
  readonly transitionType: AdminIdentityLifecycleTransitionType;
  readonly actorUid: string;
  readonly actorRole: AdminRole;
  readonly targetUid: string;
  readonly previousState: AdminIdentityLifecycleStateSnapshot;
  readonly proposedNextState: AdminIdentityLifecycleStateSnapshot;
  readonly expectedRevision: number;
  readonly nextRevision: number;
  readonly validatedAtIso: string;
  readonly verifiedActiveOwnerCountAtValidation: number;
  readonly requiresTransactionalOwnerInvariantRevalidation: true;
  readonly concurrencyNotice: typeof LIFECYCLE_CONCURRENCY_REVALIDATION_NOTICE;
  readonly auditIntent: AdminIdentityLifecycleAuditIntent;
}

const CANONICAL_ADMIN_RECORD_KEYS = new Set<string>([
  'id',
  'name',
  'email',
  'role',
  'isActive',
  'revision',
]);

const FORBIDDEN_SPOOF_OR_SECRET_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /credential/i,
  /privatekey/i,
  /apikey/i,
  /invitationid/i,
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidAdminIdentityLifecycleTransitionType(
  value: unknown
): value is AdminIdentityLifecycleTransitionType {
  if (typeof value !== 'string') {
    return false;
  }
  return Object.values(AdminIdentityLifecycleTransitionType).includes(
    value as AdminIdentityLifecycleTransitionType
  );
}

function resolveClockIso(clock: LifecycleClock): string {
  if (typeof clock !== 'function') {
    throw new AdminIdentityLifecycleContractError(
      'INVALID_CLOCK_TIMESTAMP',
      'Lifecycle clock must be a callable function returning a valid Date.'
    );
  }
  const date = clock();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new AdminIdentityLifecycleContractError(
      'INVALID_CLOCK_TIMESTAMP',
      'Injected lifecycle clock returned an invalid Date instance.'
    );
  }
  return new Date(date.getTime()).toISOString();
}

function validatePositiveRevision(
  value: unknown,
  fieldLabel: string
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1
  ) {
    throw new AdminIdentityLifecycleContractError(
      'INVALID_REVISION',
      `${fieldLabel} must be a positive integer >= 1.`
    );
  }
  return value;
}

function validateCanonicalAdminRecord(
  raw: unknown,
  kind: 'actor' | 'target'
): {
  readonly admin: AdminUser;
  readonly revision?: number;
} {
  const errorCode: AdminIdentityLifecycleErrorCode =
    kind === 'actor'
      ? 'INVALID_ACTOR_ADMIN_RECORD'
      : 'INVALID_TARGET_ADMIN_RECORD';

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AdminIdentityLifecycleContractError(
      errorCode,
      `Canonical ${kind} AdminUser record must be a non-null object.`
    );
  }

  const record = raw as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (FORBIDDEN_SPOOF_OR_SECRET_PATTERNS.some((pattern) => pattern.test(key))) {
      throw new AdminIdentityLifecycleContractError(
        'IDENTITY_OR_PRIVILEGE_SPOOFING_DETECTED',
        `Forbidden secret or invitation field '${key}' detected on ${kind} record.`
      );
    }
    if (!CANONICAL_ADMIN_RECORD_KEYS.has(key)) {
      throw new AdminIdentityLifecycleContractError(
        errorCode,
        `Unexpected non-canonical property '${key}' found on ${kind} AdminUser record.`
      );
    }
  }

  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!id || id !== record.id) {
    throw new AdminIdentityLifecycleContractError(
      errorCode,
      `Canonical ${kind} AdminUser record must have a non-empty trimmed id.`
    );
  }

  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!name) {
    throw new AdminIdentityLifecycleContractError(
      errorCode,
      `Canonical ${kind} AdminUser record (${id}) must have a non-empty name.`
    );
  }

  const email = typeof record.email === 'string' ? record.email.trim() : '';
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email) || email.includes('..')) {
    throw new AdminIdentityLifecycleContractError(
      errorCode,
      `Canonical ${kind} AdminUser record (${id}) must have a valid email address.`
    );
  }

  if (!isValidAdminRole(record.role)) {
    throw new AdminIdentityLifecycleContractError(
      errorCode,
      `Canonical ${kind} AdminUser record (${id}) has invalid or non-canonical AdminRole (${String(record.role)}).`
    );
  }

  if (typeof record.isActive !== 'boolean') {
    throw new AdminIdentityLifecycleContractError(
      errorCode,
      `Canonical ${kind} AdminUser record (${id}) must have a boolean isActive flag.`
    );
  }

  let revision: number | undefined;
  if (record.revision !== undefined) {
    revision = validatePositiveRevision(
      record.revision,
      `${kind} record revision`
    );
  }

  return {
    admin: {
      id,
      name,
      email,
      role: record.role,
      isActive: record.isActive,
    },
    revision,
  };
}

function rejectUntrustedClientAuthorityClaims(
  claims: UntrustedLifecycleClientClaims | undefined
): void {
  if (claims === undefined) {
    return;
  }

  if (claims === null || typeof claims !== 'object' || Array.isArray(claims)) {
    throw new AdminIdentityLifecycleContractError(
      'IDENTITY_OR_PRIVILEGE_SPOOFING_DETECTED',
      'Untrusted client claims structure is malformed.'
    );
  }

  const forbiddenKeys: Array<keyof UntrustedLifecycleClientClaims> = [
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
  ];

  const rawRecord = claims as Record<string, unknown>;
  for (const key of Object.keys(rawRecord)) {
    if (
      forbiddenKeys.includes(key as keyof UntrustedLifecycleClientClaims) &&
      rawRecord[key] !== undefined
    ) {
      throw new AdminIdentityLifecycleContractError(
        'IDENTITY_OR_PRIVILEGE_SPOOFING_DETECTED',
        `Client-supplied authority or privilege claim '${key}' is forbidden and cannot be used as authorization evidence.`
      );
    }
  }
}

export function validateOwnerLifecycleAuthority(
  authenticatedActorUid: unknown,
  resolvedActorAdmin: VersionedAdminIdentityRecord | null | undefined
): AdminUser {
  const actorUid =
    typeof authenticatedActorUid === 'string'
      ? authenticatedActorUid.trim()
      : '';

  if (!actorUid || actorUid !== authenticatedActorUid) {
    throw new AdminIdentityLifecycleContractError(
      'UNAUTHENTICATED_ACTOR',
      'A non-empty, trimmed authenticated Firebase actor UID is required.'
    );
  }

  if (resolvedActorAdmin === null || resolvedActorAdmin === undefined) {
    throw new AdminIdentityLifecycleContractError(
      'UNAUTHORIZED_ACTOR',
      'Authenticated caller does not hold a canonical administrative identity in admins/{uid}.'
    );
  }

  const { admin: actor } = validateCanonicalAdminRecord(
    resolvedActorAdmin,
    'actor'
  );

  if (actor.id !== actorUid) {
    throw new AdminIdentityLifecycleContractError(
      'IDENTITY_MISMATCH',
      `Resolved actor administrative record UID (${actor.id}) does not match authenticated actor UID (${actorUid}).`
    );
  }

  if (actor.isActive !== true) {
    throw new AdminIdentityLifecycleContractError(
      'INACTIVE_ACTOR',
      'Inactive administrative accounts cannot perform administrative lifecycle transitions.'
    );
  }

  if (
    actor.role !== AdminRole.Owner ||
    !AdminAuthorizationService.hasPermission(actor, AdminPermission.ManageUsers)
  ) {
    throw new AdminIdentityLifecycleContractError(
      'UNAUTHORIZED_ACTOR',
      'Only an active canonical Owner with ManageUsers permission is authorized to transition administrative identities.'
    );
  }

  return actor;
}

export function validateTrustedServerOwnerStateSnapshot(
  snapshot: unknown,
  actor: AdminUser,
  target: AdminUser
): ReadonlySet<string> {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new AdminIdentityLifecycleContractError(
      'UNTRUSTED_OWNER_STATE_SNAPSHOT',
      'A trusted server-derived active-Owner state snapshot is required.'
    );
  }

  const raw = snapshot as Record<string, unknown>;

  if ('activeOwnerCount' in raw || 'count' in raw) {
    throw new AdminIdentityLifecycleContractError(
      'UNTRUSTED_OWNER_STATE_SNAPSHOT',
      'Raw caller-provided activeOwnerCount values are not accepted as authoritative; provide a server-derived activeOwnerUids snapshot.'
    );
  }

  if (raw.origin !== TRUSTED_SERVER_OWNER_SNAPSHOT_ORIGIN) {
    throw new AdminIdentityLifecycleContractError(
      'UNTRUSTED_OWNER_STATE_SNAPSHOT',
      `Untrusted Owner state snapshot origin (${String(raw.origin)}). Expected '${TRUSTED_SERVER_OWNER_SNAPSHOT_ORIGIN}'.`
    );
  }

  if (!Array.isArray(raw.activeOwnerUids) || raw.activeOwnerUids.length === 0) {
    throw new AdminIdentityLifecycleContractError(
      'UNTRUSTED_OWNER_STATE_SNAPSHOT',
      'Trusted Owner state snapshot must contain a non-empty array of active Owner UIDs.'
    );
  }

  const activeOwnerUidSet = new Set<string>();
  for (const entry of raw.activeOwnerUids) {
    if (typeof entry !== 'string' || entry.trim() === '' || entry.trim() !== entry) {
      throw new AdminIdentityLifecycleContractError(
        'UNTRUSTED_OWNER_STATE_SNAPSHOT',
        'Trusted Owner state snapshot contains an invalid or untrimmed Owner UID.'
      );
    }
    if (activeOwnerUidSet.has(entry)) {
      throw new AdminIdentityLifecycleContractError(
        'UNTRUSTED_OWNER_STATE_SNAPSHOT',
        `Duplicate Owner UID (${entry}) detected in trusted Owner state snapshot.`
      );
    }
    activeOwnerUidSet.add(entry);
  }

  // If target is NOT an active Owner, actor (who is an active Owner) must be in activeOwnerUids,
  // and target must NOT be listed in activeOwnerUids.
  const targetIsActiveOwner =
    target.role === AdminRole.Owner && target.isActive === true;

  if (!targetIsActiveOwner) {
    if (!activeOwnerUidSet.has(actor.id)) {
      throw new AdminIdentityLifecycleContractError(
        'UNTRUSTED_OWNER_STATE_SNAPSHOT',
        `Trusted Owner state snapshot is inconsistent: verified active Owner actor (${actor.id}) is missing from activeOwnerUids.`
      );
    }
    if (activeOwnerUidSet.has(target.id)) {
      throw new AdminIdentityLifecycleContractError(
        'UNTRUSTED_OWNER_STATE_SNAPSHOT',
        `Trusted Owner state snapshot is inconsistent: non-active-Owner target (${target.id}) is listed in activeOwnerUids.`
      );
    }
  } else {
    // Target is an active Owner. At least actor.id or target.id must be present in the snapshot;
    // if > 1 active Owners are listed, both actor.id and target.id must be present.
    if (!activeOwnerUidSet.has(actor.id) && !activeOwnerUidSet.has(target.id)) {
      throw new AdminIdentityLifecycleContractError(
        'UNTRUSTED_OWNER_STATE_SNAPSHOT',
        'Trusted Owner state snapshot is inconsistent: neither active Owner actor nor active Owner target is present in activeOwnerUids.'
      );
    }
    if (
      activeOwnerUidSet.size > 1 &&
      (!activeOwnerUidSet.has(actor.id) || !activeOwnerUidSet.has(target.id))
    ) {
      throw new AdminIdentityLifecycleContractError(
        'UNTRUSTED_OWNER_STATE_SNAPSHOT',
        'Trusted Owner state snapshot is inconsistent: multi-Owner snapshot is missing verified active Owner actor or target UID.'
      );
    }
  }

  return activeOwnerUidSet;
}

export function validateAdminIdentityLifecycleTransition(
  input: ValidateAdminIdentityLifecycleTransitionInput,
  clock: LifecycleClock = systemLifecycleClock
): ValidatedAdminIdentityLifecycleTransitionIntent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AdminIdentityLifecycleContractError(
      'INVALID_TRANSITION_INPUT',
      'Transition validation input must be a non-null object.'
    );
  }

  rejectUntrustedClientAuthorityClaims(input.untrustedClientClaims);

  const validatedAtIso = resolveClockIso(clock);

  const actor = validateOwnerLifecycleAuthority(
    input.authenticatedActorUid,
    input.resolvedActorAdmin
  );

  const requestedTargetUid =
    typeof input.targetUid === 'string' ? input.targetUid.trim() : '';
  if (!requestedTargetUid || requestedTargetUid !== input.targetUid) {
    throw new AdminIdentityLifecycleContractError(
      'INVALID_TARGET_UID',
      'targetUid must be a non-empty, trimmed Firebase Auth UID string.'
    );
  }

  if (
    input.resolvedTargetAdmin === null ||
    input.resolvedTargetAdmin === undefined
  ) {
    throw new AdminIdentityLifecycleContractError(
      'TARGET_ADMIN_NOT_FOUND',
      `Target administrative identity (${requestedTargetUid}) does not exist in admins/{uid}. This contract cannot create new identities.`
    );
  }

  const { admin: target, revision: recordRevision } =
    validateCanonicalAdminRecord(input.resolvedTargetAdmin, 'target');

  if (target.id !== requestedTargetUid) {
    throw new AdminIdentityLifecycleContractError(
      'TARGET_UID_MISMATCH',
      `Requested targetUid (${requestedTargetUid}) does not match resolved target AdminUser record UID (${target.id}).`
    );
  }

  const expectedRevision = validatePositiveRevision(
    input.expectedRevision,
    'expectedRevision'
  );

  const resolvedCurrentRevision =
    input.currentTargetRevision !== undefined
      ? validatePositiveRevision(
          input.currentTargetRevision,
          'currentTargetRevision'
        )
      : recordRevision !== undefined
        ? recordRevision
        : undefined;

  if (resolvedCurrentRevision === undefined) {
    throw new AdminIdentityLifecycleContractError(
      'INVALID_REVISION',
      'Server-resolved currentTargetRevision (or target.revision) is required to verify optimistic concurrency.'
    );
  }

  if (
    recordRevision !== undefined &&
    input.currentTargetRevision !== undefined &&
    recordRevision !== input.currentTargetRevision
  ) {
    throw new AdminIdentityLifecycleContractError(
      'INVALID_REVISION',
      `Inconsistent target revision inputs: target.revision (${recordRevision}) !== currentTargetRevision (${input.currentTargetRevision}).`
    );
  }

  if (expectedRevision !== resolvedCurrentRevision) {
    throw new AdminIdentityLifecycleContractError(
      'REVISION_CONFLICT',
      `Expected target revision ${expectedRevision}, but current revision is ${resolvedCurrentRevision}.`
    );
  }

  if (!isValidAdminIdentityLifecycleTransitionType(input.transitionType)) {
    throw new AdminIdentityLifecycleContractError(
      'INVALID_TRANSITION_TYPE',
      `Invalid administrative lifecycle transition type (${String(input.transitionType)}).`
    );
  }

  if (input.explicitOwnerPromotionPolicy !== undefined) {
    throw new AdminIdentityLifecycleContractError(
      'OWNER_PROMOTION_POLICY_NOT_ESTABLISHED',
      'An explicit Owner promotion authorization policy is not established in this contract.'
    );
  }

  const activeOwnerUids = validateTrustedServerOwnerStateSnapshot(
    input.trustedOwnerState,
    actor,
    target
  );

  const transitionType = input.transitionType;
  let nextRole: AdminRole = target.role;
  let nextIsActive: boolean = target.isActive;
  let auditAction: AuditAction;
  let auditChanges: ReadonlyArray<AuditChange>;

  if (transitionType === AdminIdentityLifecycleTransitionType.ChangeRole) {
    if (!isValidAdminRole(input.targetRole)) {
      throw new AdminIdentityLifecycleContractError(
        'INVALID_TARGET_ROLE',
        `Invalid or non-canonical targetRole (${String(input.targetRole)}) for ChangeRole transition.`
      );
    }

    const requestedRole = input.targetRole;

    if (requestedRole === target.role) {
      throw new AdminIdentityLifecycleContractError(
        'NO_OP_TRANSITION',
        `Target administrator (${target.id}) already holds role '${target.role}'.`
      );
    }

    if (requestedRole === AdminRole.Owner) {
      throw new AdminIdentityLifecycleContractError(
        'OWNER_PROMOTION_POLICY_NOT_ESTABLISHED',
        'Promotion to Owner is forbidden: no explicit Owner promotion authorization policy is established.'
      );
    }

    if (target.id === actor.id) {
      throw new AdminIdentityLifecycleContractError(
        'SELF_DEMOTION_FORBIDDEN',
        'An Owner cannot demote or change their own administrative role.'
      );
    }

    if (target.role === AdminRole.Owner) {
      const remainingActiveOwners = Array.from(activeOwnerUids).filter(
        (uid) => uid !== target.id
      );
      if (activeOwnerUids.size <= 1 || remainingActiveOwners.length < 1) {
        throw new AdminIdentityLifecycleContractError(
          'LAST_ACTIVE_OWNER_DEMOTION_FORBIDDEN',
          `Cannot demote Owner (${target.id}) because at least one active Owner must remain.`
        );
      }
    }

    nextRole = requestedRole;
    auditAction = AuditAction.RoleChanged;
    auditChanges = Object.freeze([
      Object.freeze({
        field: 'role',
        previousValue: target.role,
        newValue: nextRole,
      }),
    ]);
  } else if (
    transitionType === AdminIdentityLifecycleTransitionType.Deactivate
  ) {
    if (input.targetRole !== undefined) {
      throw new AdminIdentityLifecycleContractError(
        'INVALID_TRANSITION_INPUT',
        'Deactivate transition must not specify a targetRole.'
      );
    }

    if (target.id === actor.id) {
      throw new AdminIdentityLifecycleContractError(
        'SELF_DEACTIVATION_FORBIDDEN',
        'An Owner cannot deactivate their own administrative account.'
      );
    }

    if (target.isActive === false) {
      throw new AdminIdentityLifecycleContractError(
        'ALREADY_INACTIVE',
        `Target administrator (${target.id}) is already inactive.`
      );
    }

    if (target.role === AdminRole.Owner) {
      const remainingActiveOwners = Array.from(activeOwnerUids).filter(
        (uid) => uid !== target.id
      );
      if (activeOwnerUids.size <= 1 || remainingActiveOwners.length < 1) {
        throw new AdminIdentityLifecycleContractError(
          'LAST_ACTIVE_OWNER_DEACTIVATION_FORBIDDEN',
          `Cannot deactivate Owner (${target.id}) because at least one active Owner must remain.`
        );
      }
    }

    nextIsActive = false;
    auditAction = AuditAction.StatusChanged;
    auditChanges = Object.freeze([
      Object.freeze({
        field: 'isActive',
        previousValue: true,
        newValue: false,
      }),
    ]);
  } else {
    // Reactivate
    if (input.targetRole !== undefined) {
      throw new AdminIdentityLifecycleContractError(
        'INVALID_TRANSITION_INPUT',
        'Reactivate transition must not specify a targetRole.'
      );
    }

    if (target.isActive === true) {
      throw new AdminIdentityLifecycleContractError(
        'ALREADY_ACTIVE',
        `Target administrator (${target.id}) is already active.`
      );
    }

    if (target.role === AdminRole.Owner) {
      throw new AdminIdentityLifecycleContractError(
        'OWNER_PROMOTION_POLICY_NOT_ESTABLISHED',
        'Reactivating an Owner identity requires an explicit Owner authorization policy that is not established in this contract.'
      );
    }

    nextIsActive = true;
    auditAction = AuditAction.StatusChanged;
    auditChanges = Object.freeze([
      Object.freeze({
        field: 'isActive',
        previousValue: false,
        newValue: true,
      }),
    ]);
  }

  const nextRevision = resolvedCurrentRevision + 1;

  const previousState: AdminIdentityLifecycleStateSnapshot = Object.freeze({
    id: target.id,
    name: target.name,
    email: target.email,
    role: target.role,
    isActive: target.isActive,
    revision: resolvedCurrentRevision,
  });

  const proposedNextState: AdminIdentityLifecycleStateSnapshot = Object.freeze({
    id: target.id,
    name: target.name,
    email: target.email,
    role: nextRole,
    isActive: nextIsActive,
    revision: nextRevision,
  });

  const auditMetadata = Object.freeze({
    transitionType,
    targetUid: target.id,
    previousRole: target.role,
    nextRole,
    previousIsActive: target.isActive,
    nextIsActive,
    previousRevision: resolvedCurrentRevision,
    nextRevision,
  });

  const auditIntent: AdminIdentityLifecycleAuditIntent = Object.freeze({
    timestamp: validatedAtIso,
    actorUserId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    action: auditAction,
    targetType: AuditTargetType.AdminUser,
    targetId: target.id,
    targetTitle: `${target.email} (${nextRole})`,
    changes: auditChanges,
    metadata: auditMetadata,
  });

  return Object.freeze({
    transitionType,
    actorUid: actor.id,
    actorRole: actor.role,
    targetUid: target.id,
    previousState,
    proposedNextState,
    expectedRevision,
    nextRevision,
    validatedAtIso,
    verifiedActiveOwnerCountAtValidation: activeOwnerUids.size,
    requiresTransactionalOwnerInvariantRevalidation: true,
    concurrencyNotice: LIFECYCLE_CONCURRENCY_REVALIDATION_NOTICE,
    auditIntent,
  });
}
