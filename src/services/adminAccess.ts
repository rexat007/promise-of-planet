import {
  AdminRole,
  AdminPermission,
  type AdminUser,
  getPermissionsForRole,
  hasAdminPermission,
} from '../shared/adminContract';

/**
 * Service class for evaluating permissions based on user roles.
 */
export class AdminAccessService {
  /**
   * Deterministically returns the set of permissions associated with a role.
   */
  public static getPermissionsForRole(role: AdminRole): Set<AdminPermission> {
    return getPermissionsForRole(role);
  }

  /**
   * Checks if a user has a specific permission.
   * Inactive users retain no effective administrative permissions.
   */
  public static hasPermission(user: AdminUser, permission: AdminPermission): boolean {
    return hasAdminPermission(user, permission);
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
        isActive: true,
      },
      {
        id: 'u-2',
        name: 'Sarah Ahmed',
        email: 'editor@promiseofplanet.sd',
        role: AdminRole.ContentEditor,
        isActive: true,
      },
      {
        id: 'u-3',
        name: 'Khalid Yousif',
        email: 'curator@promiseofplanet.sd',
        role: AdminRole.LibraryCurator,
        isActive: true,
      },
      {
        id: 'u-4',
        name: 'Amna Al-Bashir',
        email: 'rights@promiseofplanet.sd',
        role: AdminRole.RightsReviewer,
        isActive: true,
      },
      {
        id: 'u-5',
        name: 'Mustafa Hassan',
        email: 'training.mgr@promiseofplanet.sd',
        role: AdminRole.TrainingManager,
        isActive: true,
      },
      {
        id: 'u-6',
        name: 'Dr. Tariq Ali',
        email: 'trainer@promiseofplanet.sd',
        role: AdminRole.Trainer,
        isActive: true,
      },
      {
        id: 'u-7',
        name: 'Yasmine Omer',
        email: 'moderator@promiseofplanet.sd',
        role: AdminRole.CitizenModerator,
        isActive: true,
      },
      {
        id: 'u-8',
        name: 'Gemini Agent',
        email: 'ai.assistant@promiseofplanet.sd',
        role: AdminRole.AIAssistant,
        isActive: true,
      },
      {
        id: 'u-9',
        name: 'Mona El-Tayeb',
        email: 'viewer@promiseofplanet.sd',
        role: AdminRole.Viewer,
        isActive: true,
      },
    ];
  }
}
