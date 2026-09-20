export const AdminRole = {
  Owner: 'Owner',
  ContentEditor: 'ContentEditor',
  LibraryCurator: 'LibraryCurator',
  RightsReviewer: 'RightsReviewer',
  TrainingManager: 'TrainingManager',
  Trainer: 'Trainer',
  CitizenModerator: 'CitizenModerator',
  AIAssistant: 'AIAssistant',
  Viewer: 'Viewer',
} as const;

export type AdminRole = typeof AdminRole[keyof typeof AdminRole];

export const AdminPermission = {
  View: 'view',
  Create: 'create',
  Edit: 'edit',
  Review: 'review',
  Approve: 'approve',
  Publish: 'publish',
  ManageRights: 'manageRights',
  ManageUsers: 'manageUsers',
  ManageSettings: 'manageSettings',
  ViewReports: 'viewReports',
} as const;

export type AdminPermission = typeof AdminPermission[keyof typeof AdminPermission];

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  isActive: boolean;
}

export const ROLE_PERMISSIONS_MAP: Record<AdminRole, Set<AdminPermission>> = {
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

export function isValidAdminRole(role: unknown): role is AdminRole {
  if (typeof role !== 'string') return false;
  return Object.values(AdminRole).includes(role as AdminRole);
}

export function isValidAdminPermission(permission: unknown): permission is AdminPermission {
  if (typeof permission !== 'string') return false;
  return Object.values(AdminPermission).includes(permission as AdminPermission);
}

export function getPermissionsForRole(role: AdminRole): Set<AdminPermission> {
  return ROLE_PERMISSIONS_MAP[role] || new Set<AdminPermission>();
}

export function hasAdminPermission(user: AdminUser | null | undefined, permission: AdminPermission): boolean {
  if (!user || !user.isActive) {
    return false;
  }
  const permissions = getPermissionsForRole(user.role);
  return permissions.has(permission);
}

export const AdminDomain = {
  Overview: 'overview',
  News: 'news',
  Library: 'library',
  Media: 'media',
  Training: 'training',
  Community: 'community',
  AIReviews: 'aiReviews',
  Users: 'users',
  AuditLog: 'auditLog',
  Reports: 'reports',
  Settings: 'settings',
} as const;

export type AdminDomain = typeof AdminDomain[keyof typeof AdminDomain];

export const ROLE_DOMAINS_MAP: Record<AdminRole, Set<AdminDomain>> = {
  [AdminRole.Owner]: new Set([
    AdminDomain.Overview,
    AdminDomain.News,
    AdminDomain.Library,
    AdminDomain.Media,
    AdminDomain.Training,
    AdminDomain.Community,
    AdminDomain.AIReviews,
    AdminDomain.Users,
    AdminDomain.AuditLog,
    AdminDomain.Reports,
    AdminDomain.Settings,
  ]),
  [AdminRole.ContentEditor]: new Set([
    AdminDomain.Overview,
    AdminDomain.News,
    AdminDomain.AIReviews,
  ]),
  [AdminRole.LibraryCurator]: new Set([
    AdminDomain.Overview,
    AdminDomain.Library,
  ]),
  [AdminRole.RightsReviewer]: new Set([
    AdminDomain.Overview,
    AdminDomain.Media,
  ]),
  [AdminRole.TrainingManager]: new Set([
    AdminDomain.Overview,
    AdminDomain.Training,
  ]),
  [AdminRole.Trainer]: new Set([
    AdminDomain.Overview,
    AdminDomain.Training,
  ]),
  [AdminRole.CitizenModerator]: new Set([
    AdminDomain.Overview,
    AdminDomain.Community,
  ]),
  [AdminRole.AIAssistant]: new Set([
    AdminDomain.Overview,
    AdminDomain.AIReviews,
  ]),
  [AdminRole.Viewer]: new Set([
    AdminDomain.Overview,
    AdminDomain.Reports,
  ]),
};

export function hasDomainResponsibility(role: AdminRole, domain: AdminDomain): boolean {
  const domains = ROLE_DOMAINS_MAP[role];
  return domains ? domains.has(domain) : false;
}

export function isTabAuthorized(
  user: AdminUser | null | undefined,
  domain: AdminDomain,
  requiredPermission?: AdminPermission
): boolean {
  if (!user || !user.isActive) {
    return false;
  }
  if (!hasDomainResponsibility(user.role, domain)) {
    return false;
  }
  if (requiredPermission && !hasAdminPermission(user, requiredPermission)) {
    return false;
  }
  return true;
}

