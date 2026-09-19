import { AdminRole, AdminPermission } from '../types/admin';
import type { AdminUser } from '../types/admin';

// The Permission Matrix representing our role-based authorization model
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

/**
 * Service class for evaluating permissions based on user roles.
 */
export class AdminAccessService {
  /**
   * Deterministically returns the set of permissions associated with a role.
   */
  public static getPermissionsForRole(role: AdminRole): Set<AdminPermission> {
    return ROLE_PERMISSIONS_MAP[role] || new Set<AdminPermission>();
  }

  /**
   * Checks if a user has a specific permission.
   */
  public static hasPermission(user: AdminUser, permission: AdminPermission): boolean {
    const permissions = this.getPermissionsForRole(user.role);
    return permissions.has(permission);
  }

  /**
   * List of all pre-configured mock users for demoing and testing RBAC in the UI.
   */
  public static getMockUsers(): AdminUser[] {
    return [
      {
        id: 'u-1',
        name: 'Abbass Abdelhalim',
        email: 'owner@promiseofplanet.sd',
        role: AdminRole.Owner,
      },
      {
        id: 'u-2',
        name: 'Sarah Ahmed',
        email: 'editor@promiseofplanet.sd',
        role: AdminRole.ContentEditor,
      },
      {
        id: 'u-3',
        name: 'Khalid Yousif',
        email: 'curator@promiseofplanet.sd',
        role: AdminRole.LibraryCurator,
      },
      {
        id: 'u-4',
        name: 'Amna Al-Bashir',
        email: 'rights@promiseofplanet.sd',
        role: AdminRole.RightsReviewer,
      },
      {
        id: 'u-5',
        name: 'Mustafa Hassan',
        email: 'training.mgr@promiseofplanet.sd',
        role: AdminRole.TrainingManager,
      },
      {
        id: 'u-6',
        name: 'Dr. Tariq Ali',
        email: 'trainer@promiseofplanet.sd',
        role: AdminRole.Trainer,
      },
      {
        id: 'u-7',
        name: 'Yasmine Omer',
        email: 'moderator@promiseofplanet.sd',
        role: AdminRole.CitizenModerator,
      },
      {
        id: 'u-8',
        name: 'Gemini Agent',
        email: 'ai.assistant@promiseofplanet.sd',
        role: AdminRole.AIAssistant,
      },
      {
        id: 'u-9',
        name: 'Mona El-Tayeb',
        email: 'viewer@promiseofplanet.sd',
        role: AdminRole.Viewer,
      },
    ];
  }
}
