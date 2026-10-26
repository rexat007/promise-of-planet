import type { AdminRole, AdminUser } from '../types/admin';

export const DEFAULT_MAX_ADMIN_DIRECTORY_RESULTS = 200 as const;
export const MAX_ADMIN_DIRECTORY_LIMIT = 500 as const;

export interface ListAdminsOptions {
  readonly maxResults?: number;
}

export interface SanitizedAdminDirectoryEntry {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: AdminRole;
  readonly isActive: boolean;
}

export interface VersionedAdminRepositoryRecord extends AdminUser {
  readonly revision?: number;
}

export type AdminDirectoryErrorCode =
  | 'INVALID_ADMIN_RECORD'
  | 'INVALID_ADMIN_REVISION'
  | 'UNSAFE_DIRECT_WRITE_FORBIDDEN'
  | 'DIRECTORY_SIZE_LIMIT_EXCEEDED'
  | 'DIRECTORY_READ_FAILED'
  | 'INVALID_LIST_OPTIONS';

export class AdminDirectoryRepositoryError extends Error {
  public readonly code: AdminDirectoryErrorCode;

  constructor(code: AdminDirectoryErrorCode, message: string) {
    super(message);
    this.name = 'AdminDirectoryRepositoryError';
    this.code = code;
  }
}

export interface AdminRepository {
  /**
   * Resolves a canonical AdminUser identity by Firebase Auth UID from admins/{uid}.
   * Returns null if no canonical AdminUser document exists for the UID.
   * Preserves optional positive integer revision metadata when present on the persisted document.
   */
  getAdminByUid(uid: string): Promise<VersionedAdminRepositoryRecord | null>;

  /**
   * Legacy interface method retained only for InMemoryAdminRepository test-harness seeding.
   * Production FirestoreAdminRepository fails closed on saveAdmin to prevent unguarded writes.
   */
  saveAdmin(admin: AdminUser): Promise<AdminUser>;

  /**
   * Lists canonical AdminUser identities from admins/{uid} in a bounded,
   * read-only manner. Fails closed on malformed records, invalid revisions, or size truncation.
   */
  listAdmins?(options?: ListAdminsOptions): Promise<VersionedAdminRepositoryRecord[]>;
}

export interface AdminDirectoryRepository extends AdminRepository {
  listAdmins(options?: ListAdminsOptions): Promise<VersionedAdminRepositoryRecord[]>;
}

