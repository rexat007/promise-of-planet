import { getFirestore } from 'firebase-admin/firestore';
import {
  AdminIdentityLifecycleTransitionType,
  TRUSTED_SERVER_OWNER_SNAPSHOT_ORIGIN,
  systemLifecycleClock,
  validateAdminIdentityLifecycleTransition,
  validateOwnerLifecycleAuthority,
  type AdminIdentityLifecycleErrorCode,
  type AdminIdentityLifecycleStateSnapshot,
  type TrustedServerOwnerStateSnapshot,
  type UntrustedLifecycleClientClaims,
  type VersionedAdminIdentityRecord,
} from './adminIdentityLifecycleContract';
import {
  ADMINS_COLLECTION,
  ADMIN_AUDIT_LOGS_COLLECTION,
  AdminIdentityLifecyclePersistenceError,
  DEFAULT_MAX_ADMIN_LIFECYCLE_SCAN_LIMIT,
  buildLifecycleTransitionAuditEvent,
  buildRevisionInitializedAuditEvent,
  mapLifecycleContractErrorToPersistenceError,
  resolveLifecyclePersistenceClockIso,
  serializeLifecycleAuditEventForPersistence,
  validateLifecycleAuditEventId,
  type AdminIdentityLifecycleRepository,
  type ChangeAdminRoleAtomicParams,
  type DeactivateAdminAtomicParams,
  type ExecuteAdminLifecycleTransitionAtomicParams,
  type ExecuteAdminLifecycleTransitionAtomicResult,
  type InitializeLegacyAdminRevisionAtomicParams,
  type InitializeLegacyAdminRevisionAtomicResult,
  type ReactivateAdminAtomicParams,
} from './adminIdentityLifecycleRepository';
import { MAX_ADMIN_DIRECTORY_LIMIT } from './adminRepository';
import { AdminRole, isValidAdminRole, type AdminUser } from '../types/admin';

export interface AdminLifecycleFirestoreDocumentSnapshot {
  readonly id: string;
  readonly exists: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface AdminLifecycleFirestoreQuerySnapshot {
  readonly docs: ReadonlyArray<AdminLifecycleFirestoreDocumentSnapshot>;
  readonly truncated?: boolean;
}

export interface AdminLifecycleFirestoreDocumentRef {
  readonly id: string;
  get(): Promise<AdminLifecycleFirestoreDocumentSnapshot>;
}

export interface AdminLifecycleFirestoreQuery {
  get(): Promise<AdminLifecycleFirestoreQuerySnapshot>;
}

export interface AdminLifecycleFirestoreCollectionRef
  extends AdminLifecycleFirestoreQuery {
  doc(documentId: string): AdminLifecycleFirestoreDocumentRef;
  limit?(limit: number): AdminLifecycleFirestoreQuery;
}

/**
 * Structural Firestore transaction interface for administrative identity lifecycle mutations.
 * - Requires transactional document reads (`tx.get(docRef)`) and transactional collection/query
 *   reads (`tx.get(query)`) so the entire administrative Owner set is bound into the
 *   Firestore transaction read set.
 * - Intentionally omits `{ merge: true }` on `set()` so administrative records are always
 *   written via full validated document replacement.
 */
export interface AdminLifecycleFirestoreTransaction {
  get(
    target: AdminLifecycleFirestoreDocumentRef
  ): Promise<AdminLifecycleFirestoreDocumentSnapshot>;
  get(
    target: AdminLifecycleFirestoreQuery
  ): Promise<AdminLifecycleFirestoreQuerySnapshot>;
  create(
    docRef: AdminLifecycleFirestoreDocumentRef,
    data: Record<string, unknown>
  ): AdminLifecycleFirestoreTransaction | void;
  set(
    docRef: AdminLifecycleFirestoreDocumentRef,
    data: Record<string, unknown>
  ): AdminLifecycleFirestoreTransaction | void;
}

export interface AdminLifecycleFirestoreDatabase {
  collection(collectionName: string): AdminLifecycleFirestoreCollectionRef;
  runTransaction<T>(
    updateFunction: (
      transaction: AdminLifecycleFirestoreTransaction
    ) => Promise<T>
  ): Promise<T>;
}

export interface FirestoreAdminIdentityLifecycleRepositoryOptions {
  readonly maxAdminScanLimit?: number;
}

const ALLOWED_PERSISTED_ADMIN_PROVENANCE_KEYS = new Set<string>([
  'createdAt',
  'updatedAt',
  'provisionedViaInvitationId',
]);

const ALLOWED_PERSISTED_ADMIN_CANONICAL_KEYS = new Set<string>([
  'id',
  'name',
  'email',
  'role',
  'isActive',
  'revision',
]);

const FORBIDDEN_SECRET_KEY_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /credential/i,
  /privatekey/i,
  /apikey/i,
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ParsedPersistedAdminDocument {
  readonly canonicalRecord: VersionedAdminIdentityRecord;
  readonly admin: AdminUser;
  readonly revision?: number;
  readonly provenanceFields: Readonly<Record<string, unknown>>;
}

function rejectUntrustedClientClaimsAtBoundary(
  claims: UntrustedLifecycleClientClaims | undefined
): void {
  if (claims === undefined) {
    return;
  }

  if (claims === null || typeof claims !== 'object' || Array.isArray(claims)) {
    throw new AdminIdentityLifecyclePersistenceError(
      'IDENTITY_OR_PRIVILEGE_SPOOFING_DETECTED',
      'Untrusted client claims structure is malformed.'
    );
  }

  const forbiddenKeys: ReadonlyArray<keyof UntrustedLifecycleClientClaims> = [
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
      throw new AdminIdentityLifecyclePersistenceError(
        'IDENTITY_OR_PRIVILEGE_SPOOFING_DETECTED',
        `Client-supplied authority or privilege claim '${key}' is forbidden.`
      );
    }
  }
}

function parsePersistedAdminDocumentSnapshot(
  snapshot: AdminLifecycleFirestoreDocumentSnapshot | null | undefined,
  kind: 'actor' | 'target' | 'directory',
  options?: {
    readonly rejectAnyPresentRevisionForInitialization?: boolean;
  }
): ParsedPersistedAdminDocument | null {
  if (!snapshot || !snapshot.exists) {
    return null;
  }

  const recordErrorCode: AdminIdentityLifecycleErrorCode =
    kind === 'actor'
      ? 'INVALID_ACTOR_ADMIN_RECORD'
      : 'INVALID_TARGET_ADMIN_RECORD';

  const docId = typeof snapshot.id === 'string' ? snapshot.id.trim() : '';
  if (!docId || docId !== snapshot.id) {
    throw new AdminIdentityLifecyclePersistenceError(
      recordErrorCode,
      `Persisted ${kind} admin snapshot has a missing or untrimmed document ID.`
    );
  }

  const data = typeof snapshot.data === 'function' ? snapshot.data() : undefined;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new AdminIdentityLifecyclePersistenceError(
      recordErrorCode,
      `Persisted ${kind} admin document (${docId}) has missing or non-object data.`
    );
  }

  const provenanceFields: Record<string, unknown> = {};

  for (const key of Object.keys(data)) {
    if (ALLOWED_PERSISTED_ADMIN_PROVENANCE_KEYS.has(key)) {
      const value = data[key];
      if (value !== undefined) {
        if (typeof value !== 'string' || value.trim() === '') {
          throw new AdminIdentityLifecyclePersistenceError(
            recordErrorCode,
            `Persisted ${kind} admin document (${docId}) has invalid provenance field '${key}'.`
          );
        }
        provenanceFields[key] = value;
      }
      continue;
    }

    if (FORBIDDEN_SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      throw new AdminIdentityLifecyclePersistenceError(
        'IDENTITY_OR_PRIVILEGE_SPOOFING_DETECTED',
        `Forbidden secret or credential property '${key}' detected on ${kind} admin document (${docId}).`
      );
    }

    if (/invitationid/i.test(key)) {
      throw new AdminIdentityLifecyclePersistenceError(
        'IDENTITY_OR_PRIVILEGE_SPOOFING_DETECTED',
        `Forbidden non-canonical invitation property '${key}' detected on ${kind} admin document (${docId}).`
      );
    }

    if (!ALLOWED_PERSISTED_ADMIN_CANONICAL_KEYS.has(key)) {
      throw new AdminIdentityLifecyclePersistenceError(
        recordErrorCode,
        `Unexpected non-canonical property '${key}' encountered on ${kind} admin document (${docId}).`
      );
    }
  }

  const internalId = typeof data.id === 'string' ? data.id.trim() : '';
  if (!internalId || internalId !== data.id) {
    throw new AdminIdentityLifecyclePersistenceError(
      recordErrorCode,
      `Persisted ${kind} admin document (${docId}) is missing a valid canonical id field.`
    );
  }

  if (internalId !== docId) {
    throw new AdminIdentityLifecyclePersistenceError(
      kind === 'target' ? 'TARGET_UID_MISMATCH' : recordErrorCode,
      `Persisted ${kind} admin document ID (${docId}) does not match internal id (${internalId}).`
    );
  }

  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) {
    throw new AdminIdentityLifecyclePersistenceError(
      recordErrorCode,
      `Persisted ${kind} admin document (${docId}) must have a non-empty name.`
    );
  }

  const email = typeof data.email === 'string' ? data.email.trim() : '';
  if (
    !email ||
    email.length > 254 ||
    !EMAIL_PATTERN.test(email) ||
    email.includes('..')
  ) {
    throw new AdminIdentityLifecyclePersistenceError(
      recordErrorCode,
      `Persisted ${kind} admin document (${docId}) must have a valid email address.`
    );
  }

  if (!isValidAdminRole(data.role)) {
    throw new AdminIdentityLifecyclePersistenceError(
      kind === 'actor' ? 'UNAUTHORIZED_ACTOR' : recordErrorCode,
      `Persisted ${kind} admin document (${docId}) has invalid or non-canonical AdminRole (${String(data.role)}).`
    );
  }

  if (typeof data.isActive !== 'boolean') {
    throw new AdminIdentityLifecyclePersistenceError(
      recordErrorCode,
      `Persisted ${kind} admin document (${docId}) must have a boolean isActive flag.`
    );
  }

  let revision: number | undefined;
  const hasRevisionProperty =
    Object.prototype.hasOwnProperty.call(data, 'revision') &&
    data.revision !== undefined;

  if (hasRevisionProperty) {
    const rawRev = data.revision;
    const isValidPositiveInt =
      typeof rawRev === 'number' &&
      Number.isInteger(rawRev) &&
      Number.isSafeInteger(rawRev) &&
      rawRev >= 1;

    if (!isValidPositiveInt) {
      throw new AdminIdentityLifecyclePersistenceError(
        'INVALID_REVISION',
        `Persisted ${kind} admin document (${docId}) has an invalid or malformed revision (${String(rawRev)}).`
      );
    }

    if (options?.rejectAnyPresentRevisionForInitialization) {
      throw new AdminIdentityLifecyclePersistenceError(
        'REVISION_ALREADY_INITIALIZED',
        `Target administrative identity (${docId}) already has an initialized revision (${rawRev}).`
      );
    }

    revision = rawRev;
  }

  const admin: AdminUser = Object.freeze({
    id: docId,
    name,
    email,
    role: data.role,
    isActive: data.isActive,
  });

  const canonicalRecord: VersionedAdminIdentityRecord = Object.freeze({
    id: docId,
    name,
    email,
    role: data.role,
    isActive: data.isActive,
    ...(revision !== undefined ? { revision } : {}),
  });

  return {
    canonicalRecord,
    admin,
    revision,
    provenanceFields: Object.freeze(provenanceFields),
  };
}

function assertSnapshotsConsistent(
  directParsed: ParsedPersistedAdminDocument,
  directoryParsed: ParsedPersistedAdminDocument | undefined,
  label: 'actor' | 'target' | 'owner'
): void {
  if (!directoryParsed) {
    throw new AdminIdentityLifecyclePersistenceError(
      'INCOMPLETE_OWNER_SNAPSHOT',
      `Transactional admins collection snapshot is incomplete or truncated: verified ${label} document (${directParsed.admin.id}) is missing from collection snapshot.`
    );
  }

  if (
    directoryParsed.admin.id !== directParsed.admin.id ||
    directoryParsed.admin.role !== directParsed.admin.role ||
    directoryParsed.admin.isActive !== directParsed.admin.isActive ||
    directoryParsed.revision !== directParsed.revision
  ) {
    throw new AdminIdentityLifecyclePersistenceError(
      'INCOMPLETE_OWNER_SNAPSHOT',
      `Transactional admins collection snapshot is inconsistent with direct transactional read for ${label} document (${directParsed.admin.id}).`
    );
  }
}

export class FirestoreAdminIdentityLifecycleRepository
  implements AdminIdentityLifecycleRepository
{
  private readonly db: AdminLifecycleFirestoreDatabase;
  private readonly maxAdminScanLimit: number;

  constructor(
    db?: AdminLifecycleFirestoreDatabase,
    options?: FirestoreAdminIdentityLifecycleRepositoryOptions
  ) {
    this.db =
      db ?? (getFirestore() as unknown as AdminLifecycleFirestoreDatabase);
    const requestedLimit =
      options?.maxAdminScanLimit ?? DEFAULT_MAX_ADMIN_LIFECYCLE_SCAN_LIMIT;

    if (
      typeof requestedLimit !== 'number' ||
      !Number.isInteger(requestedLimit) ||
      requestedLimit < 1 ||
      requestedLimit > MAX_ADMIN_DIRECTORY_LIMIT
    ) {
      throw new AdminIdentityLifecyclePersistenceError(
        'INCOMPLETE_OWNER_SNAPSHOT',
        `Invalid maxAdminScanLimit (${String(requestedLimit)}). Must be an integer between 1 and ${MAX_ADMIN_DIRECTORY_LIMIT}.`
      );
    }

    this.maxAdminScanLimit = requestedLimit;
  }

  public async executeLifecycleTransitionAtomic(
    params: ExecuteAdminLifecycleTransitionAtomicParams
  ): Promise<ExecuteAdminLifecycleTransitionAtomicResult> {
    try {
      if (!params || typeof params !== 'object' || Array.isArray(params)) {
        throw new AdminIdentityLifecyclePersistenceError(
          'INVALID_TRANSITION_INPUT',
          'Lifecycle transition parameters must be a non-null object.'
        );
      }

      rejectUntrustedClientClaimsAtBoundary(params.untrustedClientClaims);

      const clock = params.clock ?? systemLifecycleClock;
      const capturedAtIso = resolveLifecyclePersistenceClockIso(clock);
      const auditEventId = validateLifecycleAuditEventId(
        params.auditEventId,
        'Audit event ID'
      );

      const actorUid =
        typeof params.authenticatedActorUid === 'string'
          ? params.authenticatedActorUid.trim()
          : '';
      if (!actorUid || actorUid !== params.authenticatedActorUid) {
        throw new AdminIdentityLifecyclePersistenceError(
          'UNAUTHENTICATED_ACTOR',
          'A non-empty, trimmed authenticated Firebase actor UID is required.'
        );
      }

      const targetUid =
        typeof params.targetUid === 'string' ? params.targetUid.trim() : '';
      if (!targetUid || targetUid !== params.targetUid) {
        throw new AdminIdentityLifecyclePersistenceError(
          'INVALID_TARGET_UID',
          'targetUid must be a non-empty, trimmed Firebase Auth UID string.'
        );
      }

      if (
        typeof params.expectedRevision !== 'number' ||
        !Number.isInteger(params.expectedRevision) ||
        params.expectedRevision < 1
      ) {
        throw new AdminIdentityLifecyclePersistenceError(
          'INVALID_REVISION',
          'expectedRevision must be a positive integer >= 1.'
        );
      }

      return await this.db.runTransaction(async (tx) => {
        const adminsCol = this.db.collection(ADMINS_COLLECTION);
        const auditLogsCol = this.db.collection(ADMIN_AUDIT_LOGS_COLLECTION);

        // PHASE 1: ALL TRANSACTIONAL READS BEFORE ANY WRITES
        // 1. Read canonical actor record transactionally
        const actorDocRef = adminsCol.doc(actorUid);
        const actorSnap = await tx.get(actorDocRef);

        // 2. Read canonical target record transactionally
        const targetDocRef =
          targetUid === actorUid ? actorDocRef : adminsCol.doc(targetUid);
        const targetSnap =
          targetUid === actorUid ? actorSnap : await tx.get(targetDocRef);

        // 3. Read complete admins collection snapshot transactionally
        const adminsQuery: AdminLifecycleFirestoreQuery =
          typeof adminsCol.limit === 'function'
            ? adminsCol.limit(this.maxAdminScanLimit + 1)
            : adminsCol;
        const adminsQuerySnap = await tx.get(adminsQuery);

        if (
          !adminsQuerySnap ||
          typeof adminsQuerySnap !== 'object' ||
          !Array.isArray(adminsQuerySnap.docs)
        ) {
          throw new AdminIdentityLifecyclePersistenceError(
            'INCOMPLETE_OWNER_SNAPSHOT',
            'Transactional query on admins collection failed to return a valid QuerySnapshot.'
          );
        }

        if (
          adminsQuerySnap.truncated === true ||
          adminsQuerySnap.docs.length > this.maxAdminScanLimit
        ) {
          throw new AdminIdentityLifecyclePersistenceError(
            'INCOMPLETE_OWNER_SNAPSHOT',
            `Transactional admins collection snapshot exceeds bounded limit of ${this.maxAdminScanLimit} records or was truncated; refusing to evaluate Owner invariant on a partial snapshot.`
          );
        }

        // Parse and validate every document in the transactional collection snapshot
        const directoryParsedMap = new Map<
          string,
          ParsedPersistedAdminDocument
        >();
        const activeOwnerUids: string[] = [];

        for (const docSnap of adminsQuerySnap.docs) {
          const parsedDoc = parsePersistedAdminDocumentSnapshot(
            docSnap,
            'directory'
          );
          if (!parsedDoc) {
            throw new AdminIdentityLifecyclePersistenceError(
              'INCOMPLETE_OWNER_SNAPSHOT',
              'Transactional admins collection snapshot contained a non-existent document entry.'
            );
          }
          if (directoryParsedMap.has(parsedDoc.admin.id)) {
            throw new AdminIdentityLifecyclePersistenceError(
              'INCOMPLETE_OWNER_SNAPSHOT',
              `Duplicate admin UID (${parsedDoc.admin.id}) encountered in transactional admins snapshot.`
            );
          }
          directoryParsedMap.set(parsedDoc.admin.id, parsedDoc);

          if (
            parsedDoc.admin.role === AdminRole.Owner &&
            parsedDoc.admin.isActive === true
          ) {
            activeOwnerUids.push(parsedDoc.admin.id);
          }
        }

        // 4. Explicitly lock every Owner document in the transaction's document read-set
        for (const [uid, parsedEntry] of directoryParsedMap.entries()) {
          if (
            parsedEntry.admin.role === AdminRole.Owner &&
            uid !== actorUid &&
            uid !== targetUid
          ) {
            const ownerDocSnap = await tx.get(adminsCol.doc(uid));
            const parsedOwnerDirect = parsePersistedAdminDocumentSnapshot(
              ownerDocSnap,
              'directory'
            );
            if (!parsedOwnerDirect) {
              throw new AdminIdentityLifecyclePersistenceError(
                'INCOMPLETE_OWNER_SNAPSHOT',
                `Transactional Owner read mismatch: Owner (${uid}) disappeared during transactional read validation.`
              );
            }
            assertSnapshotsConsistent(
              parsedOwnerDirect,
              parsedEntry,
              'owner'
            );
          }
        }

        // PHASE 2: AUTHORIZATION & CONTRACT VALIDATION
        const parsedActor = parsePersistedAdminDocumentSnapshot(
          actorSnap,
          'actor'
        );

        // Verify active Owner + ManageUsers authority first
        validateOwnerLifecycleAuthority(
          actorUid,
          parsedActor?.canonicalRecord ?? null
        );

        if (!parsedActor) {
          throw new AdminIdentityLifecyclePersistenceError(
            'UNAUTHORIZED_ACTOR',
            'Authenticated caller does not hold a canonical administrative identity.'
          );
        }

        // Cross-check actor presence and consistency in transactional collection snapshot
        assertSnapshotsConsistent(
          parsedActor,
          directoryParsedMap.get(actorUid),
          'actor'
        );

        const parsedTarget = parsePersistedAdminDocumentSnapshot(
          targetSnap,
          'target'
        );

        if (!parsedTarget) {
          throw new AdminIdentityLifecyclePersistenceError(
            'TARGET_ADMIN_NOT_FOUND',
            `Target administrative identity (${targetUid}) does not exist in admins/${targetUid}.`
          );
        }

        // Cross-check target presence and consistency in transactional collection snapshot
        assertSnapshotsConsistent(
          parsedTarget,
          directoryParsedMap.get(targetUid),
          'target'
        );

        const trustedOwnerState: TrustedServerOwnerStateSnapshot =
          Object.freeze({
            origin: TRUSTED_SERVER_OWNER_SNAPSHOT_ORIGIN,
            activeOwnerUids: Object.freeze([...activeOwnerUids]),
            capturedAtIso,
          });

        const validatedIntent = validateAdminIdentityLifecycleTransition(
          {
            authenticatedActorUid: actorUid,
            resolvedActorAdmin: parsedActor.canonicalRecord,
            targetUid,
            resolvedTargetAdmin: parsedTarget.canonicalRecord,
            currentTargetRevision: parsedTarget.revision,
            expectedRevision: params.expectedRevision,
            transitionType: params.transitionType,
            targetRole: params.targetRole,
            trustedOwnerState,
            explicitOwnerPromotionPolicy: params.explicitOwnerPromotionPolicy,
            untrustedClientClaims: params.untrustedClientClaims,
          },
          clock
        );

        // PHASE 3: ATOMIC TRANSACTION WRITES (full replacement, no merge)
        const nextPersistedTargetDoc: Record<string, unknown> = {
          ...parsedTarget.provenanceFields,
          id: validatedIntent.proposedNextState.id,
          name: validatedIntent.proposedNextState.name,
          email: validatedIntent.proposedNextState.email,
          role: validatedIntent.proposedNextState.role,
          isActive: validatedIntent.proposedNextState.isActive,
          revision: validatedIntent.proposedNextState.revision,
          updatedAt: validatedIntent.validatedAtIso,
        };

        const auditEvent = buildLifecycleTransitionAuditEvent({
          auditEventId,
          intent: validatedIntent,
        });

        const auditDocRef = auditLogsCol.doc(auditEvent.id);

        tx.set(targetDocRef, nextPersistedTargetDoc);
        tx.create(
          auditDocRef,
          serializeLifecycleAuditEventForPersistence(auditEvent)
        );

        return Object.freeze({
          transitionType: validatedIntent.transitionType,
          actorUid: validatedIntent.actorUid,
          targetUid: validatedIntent.targetUid,
          previousState: validatedIntent.previousState,
          currentState: validatedIntent.proposedNextState,
          previousRevision: validatedIntent.expectedRevision,
          currentRevision: validatedIntent.nextRevision,
          verifiedActiveOwnerCount:
            validatedIntent.verifiedActiveOwnerCountAtValidation,
          committedAtIso: validatedIntent.validatedAtIso,
          auditEvent,
        });
      });
    } catch (error: unknown) {
      throw mapLifecycleContractErrorToPersistenceError(error);
    }
  }

  public async changeAdminRoleAtomic(
    params: ChangeAdminRoleAtomicParams
  ): Promise<ExecuteAdminLifecycleTransitionAtomicResult> {
    return this.executeLifecycleTransitionAtomic({
      auditEventId: params.auditEventId,
      authenticatedActorUid: params.authenticatedActorUid,
      targetUid: params.targetUid,
      expectedRevision: params.expectedRevision,
      transitionType: AdminIdentityLifecycleTransitionType.ChangeRole,
      targetRole: params.targetRole,
      explicitOwnerPromotionPolicy: params.explicitOwnerPromotionPolicy,
      untrustedClientClaims: params.untrustedClientClaims,
      clock: params.clock,
    });
  }

  public async deactivateAdminAtomic(
    params: DeactivateAdminAtomicParams
  ): Promise<ExecuteAdminLifecycleTransitionAtomicResult> {
    return this.executeLifecycleTransitionAtomic({
      auditEventId: params.auditEventId,
      authenticatedActorUid: params.authenticatedActorUid,
      targetUid: params.targetUid,
      expectedRevision: params.expectedRevision,
      transitionType: AdminIdentityLifecycleTransitionType.Deactivate,
      untrustedClientClaims: params.untrustedClientClaims,
      clock: params.clock,
    });
  }

  public async reactivateAdminAtomic(
    params: ReactivateAdminAtomicParams
  ): Promise<ExecuteAdminLifecycleTransitionAtomicResult> {
    return this.executeLifecycleTransitionAtomic({
      auditEventId: params.auditEventId,
      authenticatedActorUid: params.authenticatedActorUid,
      targetUid: params.targetUid,
      expectedRevision: params.expectedRevision,
      transitionType: AdminIdentityLifecycleTransitionType.Reactivate,
      untrustedClientClaims: params.untrustedClientClaims,
      clock: params.clock,
    });
  }

  public async initializeLegacyAdminRevisionAtomic(
    params: InitializeLegacyAdminRevisionAtomicParams
  ): Promise<InitializeLegacyAdminRevisionAtomicResult> {
    try {
      if (!params || typeof params !== 'object' || Array.isArray(params)) {
        throw new AdminIdentityLifecyclePersistenceError(
          'INVALID_TRANSITION_INPUT',
          'Revision initialization parameters must be a non-null object.'
        );
      }

      rejectUntrustedClientClaimsAtBoundary(params.untrustedClientClaims);

      const clock = params.clock ?? systemLifecycleClock;
      const initializedAtIso = resolveLifecyclePersistenceClockIso(clock);
      const auditEventId = validateLifecycleAuditEventId(
        params.auditEventId,
        'Audit event ID'
      );

      const actorUid =
        typeof params.authenticatedActorUid === 'string'
          ? params.authenticatedActorUid.trim()
          : '';
      if (!actorUid || actorUid !== params.authenticatedActorUid) {
        throw new AdminIdentityLifecyclePersistenceError(
          'UNAUTHENTICATED_ACTOR',
          'A non-empty, trimmed authenticated Firebase actor UID is required.'
        );
      }

      const targetUid =
        typeof params.targetUid === 'string' ? params.targetUid.trim() : '';
      if (!targetUid || targetUid !== params.targetUid) {
        throw new AdminIdentityLifecyclePersistenceError(
          'INVALID_TARGET_UID',
          'targetUid must be a non-empty, trimmed single Firebase Auth UID string.'
        );
      }

      return await this.db.runTransaction(async (tx) => {
        const adminsCol = this.db.collection(ADMINS_COLLECTION);
        const auditLogsCol = this.db.collection(ADMIN_AUDIT_LOGS_COLLECTION);

        // PHASE 1: ALL TRANSACTIONAL READS BEFORE ANY WRITES
        const actorDocRef = adminsCol.doc(actorUid);
        const actorSnap = await tx.get(actorDocRef);

        const targetDocRef =
          targetUid === actorUid ? actorDocRef : adminsCol.doc(targetUid);
        const targetSnap =
          targetUid === actorUid ? actorSnap : await tx.get(targetDocRef);

        // PHASE 2: VALIDATE ACTOR AUTHORITY & LEGACY TARGET RECORD
        const parsedActor = parsePersistedAdminDocumentSnapshot(
          actorSnap,
          'actor'
        );

        const authorizedOwner = validateOwnerLifecycleAuthority(
          actorUid,
          parsedActor?.canonicalRecord ?? null
        );

        if (!targetSnap || !targetSnap.exists) {
          throw new AdminIdentityLifecyclePersistenceError(
            'TARGET_ADMIN_NOT_FOUND',
            `Target administrative identity (${targetUid}) does not exist in admins/${targetUid}.`
          );
        }

        const parsedTarget = parsePersistedAdminDocumentSnapshot(
          targetSnap,
          'target',
          {
            rejectAnyPresentRevisionForInitialization: true,
          }
        );

        if (!parsedTarget || parsedTarget.revision !== undefined) {
          throw new AdminIdentityLifecyclePersistenceError(
            'REVISION_ALREADY_INITIALIZED',
            `Target administrative identity (${targetUid}) already has an initialized revision.`
          );
        }

        // Preserve existing identity, role, isActive, and provenance fields; add revision: 1 only
        const initializedDocData: Record<string, unknown> = {
          ...parsedTarget.provenanceFields,
          id: parsedTarget.admin.id,
          name: parsedTarget.admin.name,
          email: parsedTarget.admin.email,
          role: parsedTarget.admin.role,
          isActive: parsedTarget.admin.isActive,
          revision: 1,
        };

        const initializedState: AdminIdentityLifecycleStateSnapshot =
          Object.freeze({
            id: parsedTarget.admin.id,
            name: parsedTarget.admin.name,
            email: parsedTarget.admin.email,
            role: parsedTarget.admin.role,
            isActive: parsedTarget.admin.isActive,
            revision: 1,
          });

        const auditEvent = buildRevisionInitializedAuditEvent({
          auditEventId,
          timestamp: initializedAtIso,
          actor: authorizedOwner,
          target: parsedTarget.admin,
        });

        const auditDocRef = auditLogsCol.doc(auditEvent.id);

        // PHASE 3: ATOMIC TRANSACTION WRITES (full replacement, no merge)
        tx.set(targetDocRef, initializedDocData);
        tx.create(
          auditDocRef,
          serializeLifecycleAuditEventForPersistence(auditEvent)
        );

        return Object.freeze({
          transitionType: 'InitializeRevision' as const,
          actorUid: authorizedOwner.id,
          targetUid: parsedTarget.admin.id,
          initializedState,
          previousRevision: null,
          currentRevision: 1 as const,
          committedAtIso: initializedAtIso,
          auditEvent,
        });
      });
    } catch (error: unknown) {
      throw mapLifecycleContractErrorToPersistenceError(error);
    }
  }
}
