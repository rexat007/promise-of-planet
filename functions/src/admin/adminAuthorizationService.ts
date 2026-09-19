import { AdminRole, AdminPermission, type AdminUser } from '../types/admin';

// The canonical server-side permission matrix matching src/services/adminAccess.ts
const ROLE_PERMISSIONS_MAP: Record<AdminRole, Set<AdminPermission>> = {
  [AdminRole.Owner]: new Set([
    AdminPermission.View,
    AdminPermission.Create,
    AdminPermission.Edit,
    AdminPermission.Review,
    AdminPermission.Approve,
    AdminPermission.Publish,
    AdminPermission.ManageRights,
    AdminPermission.ManageUsers,
    AdminPermission.ManageSettings,
    AdminPermission.ViewReports,
  ]),
  [AdminRole.ContentEditor]: new Set([
    AdminPermission.View,
    AdminPermission.Create,
    AdminPermission.Edit,
    AdminPermission.Review,
  ]),
  [AdminRole.LibraryCurator]: new Set([
    AdminPermission.View,
    AdminPermission.Create,
    AdminPermission.Edit,
    AdminPermission.Review,
  ]),
  [AdminRole.RightsReviewer]: new Set([
    AdminPermission.View,
    AdminPermission.Review,
    AdminPermission.ManageRights,
  ]),
  [AdminRole.TrainingManager]: new Set([
    AdminPermission.View,
    AdminPermission.Create,
    AdminPermission.Edit,
    AdminPermission.Review,
    AdminPermission.Approve,
  ]),
  [AdminRole.Trainer]: new Set([
    AdminPermission.View,
    AdminPermission.Create,
    AdminPermission.Edit,
  ]),
  [AdminRole.CitizenModerator]: new Set([
    AdminPermission.View,
    AdminPermission.Review,
  ]),
  [AdminRole.AIAssistant]: new Set([
    AdminPermission.View,
    AdminPermission.Review,
  ]),
  [AdminRole.Viewer]: new Set([
    AdminPermission.View,
    AdminPermission.ViewReports,
  ]),
};

export class AdminAuthorizationService {
  /**
   * Deterministically returns the set of permissions associated with a role.
   */
  public static getPermissionsForRole(role: AdminRole): Set<AdminPermission> {
    return ROLE_PERMISSIONS_MAP[role] || new Set<AdminPermission>();
  }

  /**
   * Checks if an AdminUser has a specific permission.
   * Inactive users retain zero effective administrative permissions.
   */
  public static hasPermission(user: AdminUser | null | undefined, permission: AdminPermission): boolean {
    if (!user || !user.isActive) {
      return false;
    }
    const permissions = this.getPermissionsForRole(user.role);
    return permissions.has(permission);
  }
}
