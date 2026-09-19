"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLE_PERMISSIONS_MAP = exports.AdminPermission = exports.AdminRole = void 0;
exports.isValidAdminRole = isValidAdminRole;
exports.isValidAdminPermission = isValidAdminPermission;
exports.getPermissionsForRole = getPermissionsForRole;
exports.hasAdminPermission = hasAdminPermission;
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
//# sourceMappingURL=adminContract.js.map