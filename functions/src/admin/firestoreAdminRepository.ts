import { getFirestore } from 'firebase-admin/firestore';
import {
  AdminDirectoryRepositoryError,
  DEFAULT_MAX_ADMIN_DIRECTORY_RESULTS,
  MAX_ADMIN_DIRECTORY_LIMIT,
  type AdminDirectoryRepository,
  type ListAdminsOptions,
  type VersionedAdminRepositoryRecord,
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

function parseOptionalAdminRevision(
  rawRevision: unknown,
  uid: string
): { readonly valid: true; readonly revision?: number } | { readonly valid: false; readonly message: string } {
  if (rawRevision === undefined) {
    return { valid: true, revision: undefined };
  }
  if (
    typeof rawRevision !== 'number' ||
    !Number.isInteger(rawRevision) ||
    rawRevision < 1
  ) {
    return {
      valid: false,
      message: `Invalid or non-positive-integer revision (${String(rawRevision)}) encountered for admin document (${uid}).`,
    };
  }
  return { valid: true, revision: rawRevision };
}

export class FirestoreAdminRepository implements AdminDirectoryRepository {
  private readonly db: FirestoreAdminDatabase;

  constructor(db?: FirestoreAdminDatabase) {
    this.db = db ?? (getFirestore() as unknown as FirestoreAdminDatabase);
  }

  public async getAdminByUid(uid: string): Promise<VersionedAdminRepositoryRecord | null> {
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

      const revisionCheck = parseOptionalAdminRevision(data.revision, snapshot.id);
      if (!revisionCheck.valid) {
        console.error(`${revisionCheck.message} Failing closed.`);
        return null;
      }

      const baseRecord: VersionedAdminRepositoryRecord = {
        id: snapshot.id,
        name: (data.name as string) || '',
        email: (data.email as string) || '',
        role: data.role,
        isActive: Boolean(data.isActive),
      };

      if (revisionCheck.revision !== undefined) {
        return {
          ...baseRecord,
          revision: revisionCheck.revision,
        };
      }

      return baseRecord;
    } catch (e: any) {
      console.error(`Error resolving AdminUser by UID (${uid}):`, e?.message || e);
      return null;
    }
  }

  public async saveAdmin(_admin: AdminUser): Promise<AdminUser> {
    throw new AdminDirectoryRepositoryError(
      'UNSAFE_DIRECT_WRITE_FORBIDDEN',
      'Direct saveAdmin writes to admins/{uid} are forbidden on FirestoreAdminRepository; administrative identity mutations must execute through the guarded transactional lifecycle repository.'
    );
  }

  public async listAdmins(options?: ListAdminsOptions): Promise<VersionedAdminRepositoryRecord[]> {
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

    const admins: VersionedAdminRepositoryRecord[] = [];

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

      const revisionCheck = parseOptionalAdminRevision(data.revision, canonicalUid);
      if (!revisionCheck.valid) {
        throw new AdminDirectoryRepositoryError(
          'INVALID_ADMIN_RECORD',
          revisionCheck.message
        );
      }

      const entry: VersionedAdminRepositoryRecord = {
        id: canonicalUid,
        name: rawName,
        email: rawEmail,
        role: data.role,
        isActive: data.isActive,
        ...(revisionCheck.revision !== undefined
          ? { revision: revisionCheck.revision }
          : {}),
      };

      admins.push(entry);
    }

    admins.sort(compareAdminDirectoryEntries);
    return admins;
  }
}

