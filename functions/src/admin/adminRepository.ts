import type { AdminUser } from '../types/admin';

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
}
