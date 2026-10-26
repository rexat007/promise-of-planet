import { getFirestore } from 'firebase-admin/firestore';
import {
  AdminDirectoryRepositoryError,
  DEFAULT_MAX_ADMIN_DIRECTORY_RESULTS,
  MAX_ADMIN_DIRECTORY_LIMIT,
  type AdminDirectoryRepository,
  type ListAdminsOptions,
} from './adminRepository';
import { isValidAdminRole, type AdminUser } from '../types/admin';

export interface FirestoreAdminDocumentSnapshot {
  readonly id: string;
  readonly exists?: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface FirestoreAdminQuerySnapshot {
  readonly docs: ReadonlyArray<FirestoreAdminDocumentSnapshot>;
}

export interface FirestoreAdminCollectionReference {
  doc(id: string): {
    get(): Promise<FirestoreAdminDocumentSnapshot>;
    set(data: Record<string, unknown>, options?: { merge?: boolean }): Promise<unknown>;
  };
  limit?(limit: number): {
    get(): Promise<FirestoreAdminQuerySnapshot>;
  };
  get(): Promise<FirestoreAdminQuerySnapshot>;
}

export interface FirestoreAdminDatabase {
  collection(collectionPath: string): FirestoreAdminCollectionReference;
}

export function compareAdminDirectoryEntries(a: AdminUser, b: AdminUser): number {
  const emailComparison = a.email.toLowerCase().localeCompare(b.email.toLowerCase());
  if (emailComparison !== 0) {
    return emailComparison;
  }
  const nameComparison = a.name.localeCompare(b.name);
  if (nameComparison !== 0) {
    return nameComparison;
  }
  return a.id.localeCompare(b.id);
}

export class FirestoreAdminRepository implements AdminDirectoryRepository {
  private readonly db: FirestoreAdminDatabase;

  constructor(db?: FirestoreAdminDatabase) {
    this.db = db ?? (getFirestore() as unknown as FirestoreAdminDatabase);
  }

  public async getAdminByUid(uid: string): Promise<AdminUser | null> {
    if (!uid || uid.trim() === '') {
      return null;
    }

    try {
      const docRef = this.db.collection('admins').doc(uid.trim());
      const snapshot = await docRef.get();

      if (!snapshot.exists) {
        return null;
      }

      const data = snapshot.data();
      if (!data) {
        return null;
      }

      if (!isValidAdminRole(data.role)) {
        console.error(`Invalid or non-canonical AdminRole (${data.role}) encountered for UID (${uid}). Failing closed.`);
        return null;
      }

      return {
        id: snapshot.id,
        name: (data.name as string) || '',
        email: (data.email as string) || '',
        role: data.role,
        isActive: Boolean(data.isActive),
      };
    } catch (e: any) {
      console.error(`Error resolving AdminUser by UID (${uid}):`, e?.message || e);
      return null;
    }
  }

  public async saveAdmin(admin: AdminUser): Promise<AdminUser> {
    if (!admin.id || admin.id.trim() === '') {
      throw new Error('Cannot save AdminUser: admin.id (UID) is missing');
    }

    if (!isValidAdminRole(admin.role)) {
      throw new Error(`Cannot save AdminUser: invalid AdminRole '${admin.role}'`);
    }

    const targetUid = admin.id.trim();
    const docRef = this.db.collection('admins').doc(targetUid);
    const payload = {
      name: admin.name,
      email: admin.email,
      role: admin.role,
      isActive: Boolean(admin.isActive),
      updatedAt: new Date().toISOString(),
    };

    await docRef.set(payload, { merge: true });

    return {
      id: targetUid,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      isActive: Boolean(admin.isActive),
    };
  }

  public async listAdmins(options?: ListAdminsOptions): Promise<AdminUser[]> {
    const maxResults = options?.maxResults ?? DEFAULT_MAX_ADMIN_DIRECTORY_RESULTS;
    if (
      typeof maxResults !== 'number' ||
      !Number.isInteger(maxResults) ||
      maxResults < 1 ||
      maxResults > MAX_ADMIN_DIRECTORY_LIMIT
    ) {
      throw new AdminDirectoryRepositoryError(
        'INVALID_LIST_OPTIONS',
        `Invalid maxResults (${String(options?.maxResults)}). Must be an integer between 1 and ${MAX_ADMIN_DIRECTORY_LIMIT}.`
      );
    }

    let snapshot: FirestoreAdminQuerySnapshot;
    try {
      const collectionRef = this.db.collection('admins');
      const query =
        typeof collectionRef.limit === 'function'
          ? collectionRef.limit(maxResults + 1)
          : collectionRef;
      snapshot = await query.get();
    } catch (error: any) {
      throw new AdminDirectoryRepositoryError(
        'DIRECTORY_READ_FAILED',
        `Failed to query admins collection: ${error?.message || String(error)}`
      );
    }

    if (!snapshot || !Array.isArray(snapshot.docs)) {
      throw new AdminDirectoryRepositoryError(
        'DIRECTORY_READ_FAILED',
        'Invalid snapshot returned from admins collection query.'
      );
    }

    if (snapshot.docs.length > maxResults) {
      throw new AdminDirectoryRepositoryError(
        'DIRECTORY_SIZE_LIMIT_EXCEEDED',
        `Admin directory exceeds bounded limit of ${maxResults} records; refusing to return truncated results.`
      );
    }

    const admins: AdminUser[] = [];

    for (const doc of snapshot.docs) {
      const canonicalUid = typeof doc?.id === 'string' ? doc.id.trim() : '';
      if (!canonicalUid) {
        throw new AdminDirectoryRepositoryError(
          'INVALID_ADMIN_RECORD',
          'Encountered admin document with missing or empty document UID.'
        );
      }

      const data = typeof doc.data === 'function' ? doc.data() : undefined;
      if (!data || typeof data !== 'object') {
        throw new AdminDirectoryRepositoryError(
          'INVALID_ADMIN_RECORD',
          `Admin document (${canonicalUid}) has missing or non-object data.`
        );
      }

      if (!isValidAdminRole(data.role)) {
        throw new AdminDirectoryRepositoryError(
          'INVALID_ADMIN_RECORD',
          `Invalid or non-canonical AdminRole (${String(data.role)}) encountered for admin document (${canonicalUid}).`
        );
      }

      if (typeof data.isActive !== 'boolean') {
        throw new AdminDirectoryRepositoryError(
          'INVALID_ADMIN_RECORD',
          `Invalid or non-boolean isActive flag encountered for admin document (${canonicalUid}).`
        );
      }

      const rawName = typeof data.name === 'string' ? data.name.trim() : '';
      const rawEmail = typeof data.email === 'string' ? data.email.trim() : '';

      if (!rawName || !rawEmail) {
        throw new AdminDirectoryRepositoryError(
          'INVALID_ADMIN_RECORD',
          `Missing or invalid name/email encountered for admin document (${canonicalUid}).`
        );
      }

      admins.push({
        id: canonicalUid,
        name: rawName,
        email: rawEmail,
        role: data.role,
        isActive: data.isActive,
      });
    }

    admins.sort(compareAdminDirectoryEntries);
    return admins;
  }
}

