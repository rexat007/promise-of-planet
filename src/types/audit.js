"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditAction = exports.AuditTargetType = void 0;
/**
 * Canonical Audit Target Types
 * Represents the distinct administrative and content domains present in Promise of Planet.
 */
exports.AuditTargetType = {
    News: 'News',
    LibraryDocument: 'LibraryDocument',
    TrainingCourse: 'TrainingCourse',
    CitizenSubmission: 'CitizenSubmission',
    AdminUser: 'AdminUser',
    AIReviewArtifact: 'AIReviewArtifact',
    GlobalSettings: 'GlobalSettings',
    Media: 'Media',
};
/**
 * Minimal Canonical Audit Action Vocabulary
 * Composed with `targetType` to express domain-specific actions with zero redundant keys.
 */
exports.AuditAction = {
    Created: 'Created',
    Updated: 'Updated',
    WorkflowTransitioned: 'WorkflowTransitioned',
    StatusChanged: 'StatusChanged',
    RoleChanged: 'RoleChanged',
    RightsChanged: 'RightsChanged',
};
//# sourceMappingURL=audit.js.map