"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminAccessService = void 0;
const adminContract_1 = require("../shared/adminContract");
/**
 * Service class for evaluating permissions based on user roles.
 */
class AdminAccessService {
    /**
     * Deterministically returns the set of permissions associated with a role.
     */
    static getPermissionsForRole(role) {
        return (0, adminContract_1.getPermissionsForRole)(role);
    }
    /**
     * Checks if a user has a specific permission.
     * Inactive users retain no effective administrative permissions.
     */
    static hasPermission(user, permission) {
        return (0, adminContract_1.hasAdminPermission)(user, permission);
    }
    /**
     * List of all pre-configured mock users for demoing and testing RBAC in the UI.
     */
    static getMockUsers() {
        return [
            {
                id: 'u-1',
                name: 'Abbass Abdelhalim',
                email: 'owner@promiseofplanet.sd',
                role: adminContract_1.AdminRole.Owner,
                isActive: true,
            },
            {
                id: 'u-2',
                name: 'Sarah Ahmed',
                email: 'editor@promiseofplanet.sd',
                role: adminContract_1.AdminRole.ContentEditor,
                isActive: true,
            },
            {
                id: 'u-3',
                name: 'Khalid Yousif',
                email: 'curator@promiseofplanet.sd',
                role: adminContract_1.AdminRole.LibraryCurator,
                isActive: true,
            },
            {
                id: 'u-4',
                name: 'Amna Al-Bashir',
                email: 'rights@promiseofplanet.sd',
                role: adminContract_1.AdminRole.RightsReviewer,
                isActive: true,
            },
            {
                id: 'u-5',
                name: 'Mustafa Hassan',
                email: 'training.mgr@promiseofplanet.sd',
                role: adminContract_1.AdminRole.TrainingManager,
                isActive: true,
            },
            {
                id: 'u-6',
                name: 'Dr. Tariq Ali',
                email: 'trainer@promiseofplanet.sd',
                role: adminContract_1.AdminRole.Trainer,
                isActive: true,
            },
            {
                id: 'u-7',
                name: 'Yasmine Omer',
                email: 'moderator@promiseofplanet.sd',
                role: adminContract_1.AdminRole.CitizenModerator,
                isActive: true,
            },
            {
                id: 'u-8',
                name: 'Gemini Agent',
                email: 'ai.assistant@promiseofplanet.sd',
                role: adminContract_1.AdminRole.AIAssistant,
                isActive: true,
            },
            {
                id: 'u-9',
                name: 'Mona El-Tayeb',
                email: 'viewer@promiseofplanet.sd',
                role: adminContract_1.AdminRole.Viewer,
                isActive: true,
            },
        ];
    }
}
exports.AdminAccessService = AdminAccessService;
//# sourceMappingURL=adminAccess.js.map