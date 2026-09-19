"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminAuthorizationService = void 0;
const adminContract_1 = require("../../../src/shared/adminContract");
class AdminAuthorizationService {
    /**
     * Deterministically returns the set of permissions associated with a role.
     */
    static getPermissionsForRole(role) {
        return (0, adminContract_1.getPermissionsForRole)(role);
    }
    /**
     * Checks if an AdminUser has a specific permission.
     * Inactive users retain zero effective administrative permissions.
     */
    static hasPermission(user, permission) {
        return (0, adminContract_1.hasAdminPermission)(user, permission);
    }
}
exports.AdminAuthorizationService = AdminAuthorizationService;
//# sourceMappingURL=adminAuthorizationService.js.map