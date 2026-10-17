"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLE_DOMAINS_MAP = exports.AdminDomain = exports.ROLE_PERMISSIONS_MAP = exports.AdminPermission = exports.AdminRole = void 0;
exports.isValidAdminRole = isValidAdminRole;
exports.isValidAdminPermission = isValidAdminPermission;
exports.getPermissionsForRole = getPermissionsForRole;
exports.hasAdminPermission = hasAdminPermission;
exports.hasDomainResponsibility = hasDomainResponsibility;
exports.isTabAuthorized = isTabAuthorized;
exports.AdminRole = {
    Owner: 'Owner',
    ContentEditor: 'ContentEditor',
    LibraryCurator: 'LibraryCurator',
    RightsReviewer: 'RightsReviewer',
    TrainingManager: 'TrainingManager',
    Trainer: 'Trainer',
    CitizenModerator: 'CitizenModerator',
    AIAssistant: 'AIAssistant',
    Viewer: 'Viewer',
};
exports.AdminPermission = {
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
};
exports.ROLE_PERMISSIONS_MAP = {
    [exports.AdminRole.Owner]: new Set([
        exports.AdminPermission.View,
        exports.AdminPermission.Create,
        exports.AdminPermission.Edit,
        exports.AdminPermission.Review,
        exports.AdminPermission.Approve,
        exports.AdminPermission.Publish,
        exports.AdminPermission.ManageRights,
        exports.AdminPermission.ManageUsers,
        exports.AdminPermission.ManageSettings,
        exports.AdminPermission.ViewReports,
    ]),
    [exports.AdminRole.ContentEditor]: new Set([
        exports.AdminPermission.View,
        exports.AdminPermission.Create,
        exports.AdminPermission.Edit,
        exports.AdminPermission.Review,
    ]),
    [exports.AdminRole.LibraryCurator]: new Set([
        exports.AdminPermission.View,
        exports.AdminPermission.Create,
        exports.AdminPermission.Edit,
        exports.AdminPermission.Review,
    ]),
    [exports.AdminRole.RightsReviewer]: new Set([
        exports.AdminPermission.View,
        exports.AdminPermission.Review,
        exports.AdminPermission.ManageRights,
    ]),
    [exports.AdminRole.TrainingManager]: new Set([
        exports.AdminPermission.View,
        exports.AdminPermission.Create,
        exports.AdminPermission.Edit,
        exports.AdminPermission.Review,
        exports.AdminPermission.Approve,
    ]),
    [exports.AdminRole.Trainer]: new Set([
        exports.AdminPermission.View,
        exports.AdminPermission.Create,
        exports.AdminPermission.Edit,
    ]),
    [exports.AdminRole.CitizenModerator]: new Set([
        exports.AdminPermission.View,
        exports.AdminPermission.Review,
    ]),
    [exports.AdminRole.AIAssistant]: new Set([
        exports.AdminPermission.View,
        exports.AdminPermission.Review,
    ]),
    [exports.AdminRole.Viewer]: new Set([
        exports.AdminPermission.View,
        exports.AdminPermission.ViewReports,
    ]),
};
function isValidAdminRole(role) {
    if (typeof role !== 'string')
        return false;
    return Object.values(exports.AdminRole).includes(role);
}
function isValidAdminPermission(permission) {
    if (typeof permission !== 'string')
        return false;
    return Object.values(exports.AdminPermission).includes(permission);
}
function getPermissionsForRole(role) {
    return exports.ROLE_PERMISSIONS_MAP[role] || new Set();
}
function hasAdminPermission(user, permission) {
    if (!user || !user.isActive) {
        return false;
    }
    const permissions = getPermissionsForRole(user.role);
    return permissions.has(permission);
}
exports.AdminDomain = {
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
};
exports.ROLE_DOMAINS_MAP = {
    [exports.AdminRole.Owner]: new Set([
        exports.AdminDomain.Overview,
        exports.AdminDomain.News,
        exports.AdminDomain.Library,
        exports.AdminDomain.Media,
        exports.AdminDomain.Training,
        exports.AdminDomain.Community,
        exports.AdminDomain.AIReviews,
        exports.AdminDomain.Users,
        exports.AdminDomain.AuditLog,
        exports.AdminDomain.Reports,
        exports.AdminDomain.Settings,
    ]),
    [exports.AdminRole.ContentEditor]: new Set([
        exports.AdminDomain.Overview,
        exports.AdminDomain.News,
        exports.AdminDomain.AIReviews,
    ]),
    [exports.AdminRole.LibraryCurator]: new Set([
        exports.AdminDomain.Overview,
        exports.AdminDomain.Library,
    ]),
    [exports.AdminRole.RightsReviewer]: new Set([
        exports.AdminDomain.Overview,
        exports.AdminDomain.Media,
    ]),
    [exports.AdminRole.TrainingManager]: new Set([
        exports.AdminDomain.Overview,
        exports.AdminDomain.Training,
    ]),
    [exports.AdminRole.Trainer]: new Set([
        exports.AdminDomain.Overview,
        exports.AdminDomain.Training,
    ]),
    [exports.AdminRole.CitizenModerator]: new Set([
        exports.AdminDomain.Overview,
        exports.AdminDomain.Community,
    ]),
    [exports.AdminRole.AIAssistant]: new Set([
        exports.AdminDomain.Overview,
        exports.AdminDomain.AIReviews,
    ]),
    [exports.AdminRole.Viewer]: new Set([
        exports.AdminDomain.Overview,
        exports.AdminDomain.Reports,
    ]),
};
function hasDomainResponsibility(role, domain) {
    const domains = exports.ROLE_DOMAINS_MAP[role];
    return domains ? domains.has(domain) : false;
}
function isTabAuthorized(user, domain, requiredPermission) {
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
//# sourceMappingURL=adminContract.js.map