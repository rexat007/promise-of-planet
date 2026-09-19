import { AdminRole, AdminPermission } from '../types/admin';
import type { AdminUser } from '../types/admin';
import { AdminAccessService } from './adminAccess';

export interface InvariantEvaluationResult {
  allowed: boolean;
  reasonAr?: string;
  reasonEn?: string;
}

export interface PermissionDiff {
  gained: AdminPermission[];
  lost: AdminPermission[];
  unchanged: AdminPermission[];
}

export class AdminUserManager {
  /**
   * Returns the count of active users with the Owner role.
   */
  public static getActiveOwnerCount(users: AdminUser[]): number {
    return users.filter(u => u.isActive && u.role === AdminRole.Owner).length;
  }

  /**
   * Checks if the given user is the last remaining active Owner in the system.
   */
  public static isLastActiveOwner(targetUser: AdminUser, users: AdminUser[]): boolean {
    if (!targetUser.isActive || targetUser.role !== AdminRole.Owner) {
      return false;
    }
    const remainingActiveOwners = users.filter(
      u => u.isActive && u.role === AdminRole.Owner && u.id !== targetUser.id
    ).length;
    return remainingActiveOwners === 0;
  }

  /**
   * Validates whether a target user can be deactivated.
   * Safety Invariants:
   * 1. Self-deactivation of the active session user is forbidden.
   * 2. Deactivating the last active Owner is strictly forbidden (Owner immortality invariant).
   */
  public static canDeactivateUser(
    targetUser: AdminUser,
    currentSessionUser: AdminUser,
    allUsers: AdminUser[]
  ): InvariantEvaluationResult {
    // 1. Self-deactivation check
    if (targetUser.id === currentSessionUser.id) {
      return {
        allowed: false,
        reasonAr: 'لا يمكن تعطيل حساب المستخدم الحالي للجلسة النشطة لتجنب قفل النظام المفاجئ.',
        reasonEn: 'Self-deactivation of the currently active session identity is strictly prohibited to prevent administrative lockout.',
      };
    }

    // 2. Last active Owner check
    if (this.isLastActiveOwner(targetUser, allUsers)) {
      return {
        allowed: false,
        reasonAr: 'لا يمكن تعطيل المالك الأخير النشط للمنصة. يجب الإبقاء على مالك نشط واحد على الأقل.',
        reasonEn: 'Cannot deactivate the last active platform Owner. At least one active Owner must always remain.',
      };
    }

    return { allowed: true };
  }

  /**
   * Validates whether a user's role can be updated to newRole.
   * Safety Invariants:
   * 1. Changing the role of the current active session user is forbidden to prevent runtime session mutation.
   * 2. Demoting/changing the role of the last active Owner away from Owner is strictly forbidden.
   */
  public static canChangeUserRole(
    targetUser: AdminUser,
    newRole: AdminRole,
    currentSessionUser: AdminUser,
    allUsers: AdminUser[]
  ): InvariantEvaluationResult {
    // If no role change is requested, allow
    if (targetUser.role === newRole) {
      return { allowed: true };
    }

    // 1. Self-role change check
    if (targetUser.id === currentSessionUser.id) {
      return {
        allowed: false,
        reasonAr: 'لا يمكن تغيير دور المستخدم الحالي أثناء الجلسة النشطة لتجنب حدوث طفرات غير متوقعة في صلاحيات الجلسة.',
        reasonEn: 'Changing the role of the current session user is not permitted during an active session to prevent unexpected privilege mutation.',
      };
    }

    // 2. Last active Owner demotion check
    if (targetUser.role === AdminRole.Owner && newRole !== AdminRole.Owner && this.isLastActiveOwner(targetUser, allUsers)) {
      return {
        allowed: false,
        reasonAr: 'لا يمكن تخفيض رتبة المالك الأخير النشط للمنصة. يجب وجود مالك نشط واحد على الأقل بصلاحيات كاملة.',
        reasonEn: 'Cannot demote the last active platform Owner. At least one active Owner must always retain root administrative privileges.',
      };
    }

    return { allowed: true };
  }

  /**
   * Computes the difference in permissions between two roles.
   */
  public static getRolePermissionDiff(currentRole: AdminRole, targetRole: AdminRole): PermissionDiff {
    const currentPerms = AdminAccessService.getPermissionsForRole(currentRole);
    const targetPerms = AdminAccessService.getPermissionsForRole(targetRole);

    const gained: AdminPermission[] = [];
    const lost: AdminPermission[] = [];
    const unchanged: AdminPermission[] = [];

    targetPerms.forEach(p => {
      if (currentPerms.has(p)) {
        unchanged.push(p);
      } else {
        gained.push(p);
      }
    });

    currentPerms.forEach(p => {
      if (!targetPerms.has(p)) {
        lost.push(p);
      }
    });

    return { gained, lost, unchanged };
  }

  /**
   * Basic validation for name and email formatting.
   */
  public static validateUserData(name: string, email: string): InvariantEvaluationResult {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName || trimmedName.length < 2) {
      return {
        allowed: false,
        reasonAr: 'يرجى إدخال اسم صحيح يتكون من حرفين على الأقل.',
        reasonEn: 'Please enter a valid display name (minimum 2 characters).',
      };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!trimmedEmail || !emailRegex.test(trimmedEmail)) {
      return {
        allowed: false,
        reasonAr: 'يرجى إدخال بريد إلكتروني صالح بصيغة صحيحة (example@domain.com).',
        reasonEn: 'Please enter a valid email address (e.g. user@domain.com).',
      };
    }

    return { allowed: true };
  }

  /**
   * Creates a new demo administrative identity for the current session.
   */
  public static createDemoUser(
    data: { name: string; email: string; role: AdminRole },
    existingUsers: AdminUser[]
  ): { success: boolean; user?: AdminUser; errorAr?: string; errorEn?: string } {
    const validation = this.validateUserData(data.name, data.email);
    if (!validation.allowed) {
      return {
        success: false,
        errorAr: validation.reasonAr,
        errorEn: validation.reasonEn,
      };
    }

    // Check duplicate email
    const emailLower = data.email.trim().toLowerCase();
    const emailExists = existingUsers.some(u => u.email.toLowerCase() === emailLower);
    if (emailExists) {
      return {
        success: false,
        errorAr: 'البريد الإلكتروني مسجل مسبقاً لمستخدم إداري آخر.',
        errorEn: 'This email address is already assigned to another administrative identity.',
      };
    }

    const nextId = `u-${Date.now()}`;
    const newUser: AdminUser = {
      id: nextId,
      name: data.name.trim(),
      email: data.email.trim().toLowerCase(),
      role: data.role,
      isActive: true,
    };

    return {
      success: true,
      user: newUser,
    };
  }
}
