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

export type AdminDirectoryErrorCode =
  | 'INVALID_ADMIN_RECORD'
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
   */
  getAdminByUid(uid: string): Promise<AdminUser | null>;

  /**
   * Saves or updates a canonical AdminUser document at admins/{uid}.
   * Intended for backend administration and test harness setup.
   */
  saveAdmin(admin: AdminUser): Promise<AdminUser>;

  /**
   * Lists canonical AdminUser identities from admins/{uid} in a bounded,
   * read-only manner. Fails closed on malformed records or size truncation.
   */
  listAdmins?(options?: ListAdminsOptions): Promise<AdminUser[]>;
}

export interface AdminDirectoryRepository extends AdminRepository {
  listAdmins(options?: ListAdminsOptions): Promise<AdminUser[]>;
}

