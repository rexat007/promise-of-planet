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
      return null;
    }

    try {
      const docRef = doc(db, 'admins', uid);
      const snapshot = await getDoc(docRef);
      if (!snapshot || !snapshot.exists()) {
        return null;
      }
      return validateAdminUserData(snapshot.data(), uid);
    } catch (error) {
      console.error('Firestore getAdminUser error:', error);
      return null;
    }
  }
}

/**
 * Isolated In-Memory Admin Repository for testing only.
 * Must be explicitly injected for testing.
 */
export class InMemoryAdminIdentityRepository implements AdminIdentityRepository {
  private admins = new Map<string, AdminUser>();

  async getAdminUser(uid: string): Promise<AdminUser | null> {
    if (!uid) return null;
    const raw = this.admins.get(uid);
    if (!raw) return null;
    return validateAdminUserData(raw, uid);
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
