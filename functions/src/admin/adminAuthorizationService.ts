import {
  AdminRole,
  AdminPermission,
  type AdminUser,
  getPermissionsForRole,
  hasAdminPermission,
} from '../../../src/shared/adminContract';

export class AdminAuthorizationService {
  /**
   * Deterministically returns the set of permissions associated with a role.
   */
  public static getPermissionsForRole(role: AdminRole): Set<AdminPermission> {
    return getPermissionsForRole(role);
  }

  /**
   * Checks if an AdminUser has a specific permission.
   * Inactive users retain zero effective administrative permissions.
   */
  public static hasPermission(user: AdminUser | null | undefined, permission: AdminPermission): boolean {
    return hasAdminPermission(user, permission);
  }
}
