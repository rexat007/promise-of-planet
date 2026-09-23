import { doc, getDoc } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from './firebase';
import { AdminRole, isValidAdminRole, type AdminUser } from '../shared/adminContract';

/**
 * Validates runtime AdminUser data against canonical 5-field schema.
 * Returns valid AdminUser or null if malformed or non-canonical.
 */
export function validateAdminUserData(data: any, expectedUid: string): AdminUser | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const { name, email, role, isActive } = data;

  if (typeof name !== 'string' || name.trim() === '') {
    return null;
  }

  if (typeof email !== 'string' || email.trim() === '' || !email.includes('@')) {
    return null;
  }

  if (!isValidAdminRole(role)) {
    return null;
  }

  if (typeof isActive !== 'boolean') {
    return null;
  }

  // Document ID binding: if data.id is present, it must equal expectedUid
  if (data.id !== undefined && data.id !== expectedUid) {
    return null;
  }

  return {
    id: expectedUid,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    role: role as AdminRole,
    isActive,
  };
}

export class AdminReadError extends Error {
  public readonly originalError?: any;

  constructor(message: string, originalError?: any) {
    super(message);
    this.name = 'AdminReadError';
    this.originalError = originalError;
    Object.setPrototypeOf(this, AdminReadError.prototype);
  }
}

export interface AdminIdentityRepository {
  getAdminUser(uid: string): Promise<AdminUser | null>;
}

/**
 * Production Durable Admin Repository backed strictly by Firestore admins/{uid}.
 * Does NOT fall back to in-memory mock storage.
 */
export class FirestoreAdminIdentityRepository implements AdminIdentityRepository {
  protected isConfigured(): boolean {
    return isFirebaseConfigured && !!db;
  }

  async getAdminUser(uid: string): Promise<AdminUser | null> {
    if (!uid || typeof uid !== 'string') {
      return null;
    }

    if (!this.isConfigured()) {
      throw new AdminReadError('ADMIN_READ_FAILURE', new Error('Firebase/Firestore is not configured'));
    }

    try {
      const docRef = doc(db, 'admins', uid);
      const snapshot = await getDoc(docRef);
      if (!snapshot || !snapshot.exists()) {
        return null; // Authoritative missing
      }
      return validateAdminUserData(snapshot.data(), uid); // Returns valid or null (Authoritative malformed/invalid)
    } catch (error) {
      console.error('Firestore getAdminUser error:', error);
      throw new AdminReadError('ADMIN_READ_FAILURE', error);
    }
  }
}

/**
 * Isolated In-Memory Admin Repository for testing only.
 * Must be explicitly injected for testing.
 */
export class InMemoryAdminIdentityRepository implements AdminIdentityRepository {
  private admins = new Map<string, AdminUser>();
  private shouldFail = false;

  async getAdminUser(uid: string): Promise<AdminUser | null> {
    if (this.shouldFail) {
      throw new AdminReadError('ADMIN_READ_FAILURE');
    }
    if (!uid) return null;
    const raw = this.admins.get(uid);
    if (!raw) return null;
    return validateAdminUserData(raw, uid);
  }

  setShouldFail(fail: boolean) {
    this.shouldFail = fail;
  }

  seed(rawAdmin: any) {
    this.admins.set(rawAdmin.id, rawAdmin);
  }

  clear() {
    this.admins.clear();
  }
}

export class AdminIdentityServiceClass {
  private repository: AdminIdentityRepository;

  constructor(repository?: AdminIdentityRepository) {
    this.repository = repository || new FirestoreAdminIdentityRepository();
  }

  setRepository(repository: AdminIdentityRepository) {
    this.repository = repository;
  }

  getRepository(): AdminIdentityRepository {
    return this.repository;
  }

  /**
   * Internal read by explicit UID (primarily for repository/testing delegation).
   */
  async getAdminUserByUid(uid: string): Promise<AdminUser | null> {
    return await this.repository.getAdminUser(uid);
  }

  /**
   * Resolves canonical AdminUser for an authenticated UID emitted by an auth observer event.
   * Binds resolution to the exact supplied UID rather than re-reading auth.currentUser.
   */
  async resolveAdminForAuthenticatedUid(uid: string): Promise<AdminUser | null> {
    if (!uid || typeof uid !== 'string') {
      return null;
    }
    return await this.repository.getAdminUser(uid);
  }

  /**
   * Resolves the canonical AdminUser profile bound strictly to auth.currentUser.uid.
   * Does NOT allow caller to supply arbitrary UID for self-resolution.
   */
  async getCurrentAdminUser(): Promise<AdminUser | null> {
    if (!isFirebaseConfigured || !auth) {
      return null;
    }
    const currentUser = auth.currentUser;
    if (!currentUser) {
      return null;
    }
    return await this.repository.getAdminUser(currentUser.uid);
  }
}

export const AdminIdentityService = new AdminIdentityServiceClass();

export type AdminGateState = 
  | 'AUTH_LOADING'
  | 'UNAUTHENTICATED'
  | 'ADMIN_RESOLVING'
  | 'ADMIN_AUTHORIZED'
  | 'ADMIN_DENIED';

export interface AdminGateStateSnapshot {
  gateState: AdminGateState;
  firebaseUser: { uid: string; email?: string | null } | null;
  adminUser: AdminUser | null;
  generation: number;
  revalidationError?: string | null;
}

export class AdminGateResolutionController {
  private generation = 0;
  private expectedUid: string | null = null;
  private isMounted = true;
  private snapshot: AdminGateStateSnapshot = {
    gateState: 'AUTH_LOADING',
    firebaseUser: null,
    adminUser: null,
    generation: 0,
    revalidationError: null,
  };
  private listeners = new Set<(snapshot: AdminGateStateSnapshot) => void>();

  public getSnapshot(): AdminGateStateSnapshot {
    return { ...this.snapshot };
  }

  public subscribe(listener: (snapshot: AdminGateStateSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public mount(): void {
    this.isMounted = true;
  }

  public unmount(): void {
    this.isMounted = false;
  }

  private emitState(
    gateState: AdminGateState, 
    firebaseUser: { uid: string; email?: string | null } | null, 
    adminUser: AdminUser | null, 
    gen: number,
    revalidationError: string | null = null
  ) {
    if (!this.isMounted) return;
    this.snapshot = { gateState, firebaseUser, adminUser, generation: gen, revalidationError };
    this.listeners.forEach((l) => l(this.snapshot));
  }

  public async handleAuthEvent(
    user: { uid: string; email?: string | null } | null,
    resolver: (uid: string) => Promise<AdminUser | null>
  ): Promise<void> {
    const currentGen = ++this.generation;

    if (!this.isMounted) return;

    if (!user) {
      this.expectedUid = null;
      this.emitState('UNAUTHENTICATED', null, null, currentGen, null);
      return;
    }

    const uid = user.uid;
    const isSameUidRevalidation =
      this.snapshot.gateState === 'ADMIN_AUTHORIZED' &&
      this.snapshot.adminUser &&
      this.snapshot.adminUser.id === uid;

    this.expectedUid = uid;

    if (!isSameUidRevalidation) {
      // Clear previous adminUser immediately upon starting resolution for new UID / different state
      this.emitState('ADMIN_RESOLVING', user, null, currentGen, null);
    }

    try {
      const resolved = await resolver(uid);

      if (!this.isMounted) return;
      if (this.generation !== currentGen) return;
      if (this.expectedUid !== uid) return;

      if (resolved && resolved.isActive) {
        this.emitState('ADMIN_AUTHORIZED', user, resolved, currentGen, null);
      } else {
        this.emitState('ADMIN_DENIED', user, null, currentGen, null);
      }
    } catch {
      if (!this.isMounted) return;
      if (this.generation !== currentGen) return;
      if (this.expectedUid !== uid) return;

      if (isSameUidRevalidation) {
        // Safe degraded state: preserve ADMIN_AUTHORIZED with existing valid identity, setting the transient read error flag
        this.snapshot = {
          ...this.snapshot,
          revalidationError: 'ADMIN_READ_FAILURE',
        };
        this.listeners.forEach((l) => l(this.snapshot));
      } else {
        // Initial load failure: Fail Closed (prevent authorization and render denied screen with bounded error)
        this.emitState('ADMIN_DENIED', user, null, currentGen, 'ADMIN_READ_FAILURE');
      }
    }
  }
}

