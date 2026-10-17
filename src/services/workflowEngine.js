"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkflowEngine = exports.ALLOWED_TRANSITIONS = void 0;
const admin_1 = require("../types/admin");
const workflow_1 = require("../types/workflow");
const adminAccess_1 = require("./adminAccess");
/**
 * Master list of valid state transitions in the system.
 */
exports.ALLOWED_TRANSITIONS = [
    {
        action: workflow_1.WorkflowAction.SubmitForReview,
        fromState: workflow_1.WorkflowState.Draft,
        toState: workflow_1.WorkflowState.InReview,
        requiredPermission: admin_1.AdminPermission.Create,
        labelAr: 'تقديم للمراجعة',
        labelEn: 'Submit for Review',
        requiresComment: false,
    },
    {
        action: workflow_1.WorkflowAction.RequestChanges,
        fromState: workflow_1.WorkflowState.InReview,
        toState: workflow_1.WorkflowState.ChangesRequested,
        requiredPermission: admin_1.AdminPermission.Review,
        labelAr: 'طلب تعديلات',
        labelEn: 'Request Changes',
        requiresComment: true,
    },
    {
        action: workflow_1.WorkflowAction.Approve,
        fromState: workflow_1.WorkflowState.InReview,
        toState: workflow_1.WorkflowState.Approved,
        requiredPermission: admin_1.AdminPermission.Approve,
        labelAr: 'اعتماد المادة',
        labelEn: 'Approve Content',
        requiresComment: false,
    },
    {
        action: workflow_1.WorkflowAction.ReviseDraft,
        fromState: workflow_1.WorkflowState.ChangesRequested,
        toState: workflow_1.WorkflowState.Draft,
        requiredPermission: admin_1.AdminPermission.Edit,
        labelAr: 'تعديل وإعادة المسودة',
        labelEn: 'Revise & Redraft',
        requiresComment: false,
    },
    {
        action: workflow_1.WorkflowAction.Publish,
        fromState: workflow_1.WorkflowState.Approved,
        toState: workflow_1.WorkflowState.Published,
        requiredPermission: admin_1.AdminPermission.Publish,
        labelAr: 'نشر للمحل والجمهور',
        labelEn: 'Publish Content',
        requiresComment: false,
    },
];
class WorkflowEngine {
    /**
     * Returns all valid transitions possible from a given state, regardless of user permissions.
     */
    static getValidTransitionsFromState(currentState) {
        return exports.ALLOWED_TRANSITIONS.filter(t => t.fromState === currentState);
    }
    /**
     * Returns transitions that are valid for the state AND authorized for the given user.
     */
    static getAuthorizedTransitions(currentState, user) {
        const valid = this.getValidTransitionsFromState(currentState);
        return valid.filter(t => {
            // Check if user has the specific required permission for this action
            if (t.action === workflow_1.WorkflowAction.SubmitForReview) {
                return adminAccess_1.AdminAccessService.hasPermission(user, admin_1.AdminPermission.Create) ||
                    adminAccess_1.AdminAccessService.hasPermission(user, admin_1.AdminPermission.Edit);
            }
            if (t.action === workflow_1.WorkflowAction.ReviseDraft) {
                return adminAccess_1.AdminAccessService.hasPermission(user, admin_1.AdminPermission.Edit) ||
                    adminAccess_1.AdminAccessService.hasPermission(user, admin_1.AdminPermission.Create);
            }
            return adminAccess_1.AdminAccessService.hasPermission(user, t.requiredPermission);
        });
    }
    /**
     * Evaluates if a specific transition from `fromState` to `toState` is valid and authorized for `user`.
     */
    static canExecuteTransition(fromState, toState, user) {
        // 1. Check if state machine allows this step
        const transition = exports.ALLOWED_TRANSITIONS.find(t => t.fromState === fromState && t.toState === toState);
        if (!transition) {
            return {
                allowed: false,
                reason: `State transition from [${fromState}] to [${toState}] is not permitted by the workflow lifecycle rules.`
            };
        }
        // 2. Check RBAC authority
        const isAuthorized = this.getAuthorizedTransitions(fromState, user).some(t => t.toState === toState);
        if (!isAuthorized) {
            return {
                allowed: false,
                reason: `Role (${user.role}) lacks the required permission [${transition.requiredPermission}] to execute action "${transition.labelEn}".`
            };
        }
        return { allowed: true };
    }
    /**
     * Executes a state transition on an item, recording an audit log entry.
     */
    static executeTransition(item, toState, actor, comment) {
        const check = this.canExecuteTransition(item.currentState, toState, actor);
        if (!check.allowed) {
            throw new Error(check.reason || 'Unauthorized transition attempt.');
        }
        const transitionConfig = exports.ALLOWED_TRANSITIONS.find(t => t.fromState === item.currentState && t.toState === toState);
        const transitionRecord = {
            id: `tr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            fromState: item.currentState,
            toState,
            action: transitionConfig.action,
            actorName: actor.name,
            actorRole: actor.role,
            timestamp: new Date().toISOString(),
            comment: comment?.trim() || undefined,
        };
        return {
            ...item,
            currentState: toState,
            updatedAt: new Date().toISOString(),
            history: [transitionRecord, ...item.history],
        };
    }
    /**
     * Seed mock content items demonstrating all 5 states in the lifecycle.
     */
    static getSeedWorkflowItems() {
        const now = new Date().toISOString();
        return [
            {
                id: 'item-101',
                titleAr: 'تقرير رصد الجفاف في ولاية القضارف ومخاطر المحاصيل',
                titleEn: 'Gadarif Drought Observation & Crop Vulnerability Report',
                contentType: 'Report',
                currentState: workflow_1.WorkflowState.InReview,
                authorName: 'Sarah Ahmed',
                createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
                updatedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
                category: 'Climate Impact',
                history: [
                    {
                        id: 'tr-001',
                        fromState: workflow_1.WorkflowState.Draft,
                        toState: workflow_1.WorkflowState.InReview,
                        action: workflow_1.WorkflowAction.SubmitForReview,
                        actorName: 'Sarah Ahmed',
                        actorRole: 'ContentEditor',
                        timestamp: new Date(Date.now() - 3600000 * 4).toISOString(),
                    }
                ]
            },
            {
                id: 'item-102',
                titleAr: 'دليل الإرشاد الحقلي للحد من تلوث مياه البحر الأحمر',
                titleEn: 'Field Guidance for Red Sea Marine Pollution Control',
                contentType: 'LibraryItem',
                currentState: workflow_1.WorkflowState.ChangesRequested,
                authorName: 'Khalid Yousif',
                createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
                updatedAt: new Date(Date.now() - 3600000 * 12).toISOString(),
                category: 'Marine Ecosystems',
                history: [
                    {
                        id: 'tr-002',
                        fromState: workflow_1.WorkflowState.InReview,
                        toState: workflow_1.WorkflowState.ChangesRequested,
                        action: workflow_1.WorkflowAction.RequestChanges,
                        actorName: 'Amna Al-Bashir',
                        actorRole: 'RightsReviewer',
                        timestamp: new Date(Date.now() - 3600000 * 12).toISOString(),
                        comment: 'يرجى تزويد قائمة المراجع العلمية بدراسات جامعة الخرطوم لعام 2025 واعتمد التوثيق الرسمي.'
                    },
                    {
                        id: 'tr-003',
                        fromState: workflow_1.WorkflowState.Draft,
                        toState: workflow_1.WorkflowState.InReview,
                        action: workflow_1.WorkflowAction.SubmitForReview,
                        actorName: 'Khalid Yousif',
                        actorRole: 'LibraryCurator',
                        timestamp: new Date(Date.now() - 86400000 * 2).toISOString(),
                    }
                ]
            },
            {
                id: 'item-103',
                titleAr: 'حقيبة التدريب الاستقصائي على تحليل بيانات المناخ بالـ GIS',
                titleEn: 'Investigative Climate Data Analysis via GIS Training Kit',
                contentType: 'Course',
                currentState: workflow_1.WorkflowState.Approved,
                authorName: 'Mustafa Hassan',
                createdAt: new Date(Date.now() - 86400000 * 7).toISOString(),
                updatedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
                category: 'Capacity Building',
                history: [
                    {
                        id: 'tr-004',
                        fromState: workflow_1.WorkflowState.InReview,
                        toState: workflow_1.WorkflowState.Approved,
                        action: workflow_1.WorkflowAction.Approve,
                        actorName: 'Mustafa Hassan',
                        actorRole: 'TrainingManager',
                        timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
                    },
                    {
                        id: 'tr-005',
                        fromState: workflow_1.WorkflowState.Draft,
                        toState: workflow_1.WorkflowState.InReview,
                        action: workflow_1.WorkflowAction.SubmitForReview,
                        actorName: 'Dr. Tariq Ali',
                        actorRole: 'Trainer',
                        timestamp: new Date(Date.now() - 86400000 * 4).toISOString(),
                    }
                ]
            },
            {
                id: 'item-104',
                titleAr: 'تغطية ميدانية: مبادرات التشجير المجتمعي بولاية سنار',
                titleEn: 'Field Coverage: Community Reforestation in Sennar State',
                contentType: 'News',
                currentState: workflow_1.WorkflowState.Published,
                authorName: 'Abbass Abdelhalim',
                createdAt: new Date(Date.now() - 86400000 * 10).toISOString(),
                updatedAt: new Date(Date.now() - 86400000 * 1).toISOString(),
                category: 'Community News',
                history: [
                    {
                        id: 'tr-006',
                        fromState: workflow_1.WorkflowState.Approved,
                        toState: workflow_1.WorkflowState.Published,
                        action: workflow_1.WorkflowAction.Publish,
                        actorName: 'Abbass Abdelhalim',
                        actorRole: 'Owner',
                        timestamp: new Date(Date.now() - 86400000 * 1).toISOString(),
                    },
                    {
                        id: 'tr-007',
                        fromState: workflow_1.WorkflowState.InReview,
                        toState: workflow_1.WorkflowState.Approved,
                        action: workflow_1.WorkflowAction.Approve,
                        actorName: 'Abbass Abdelhalim',
                        actorRole: 'Owner',
                        timestamp: new Date(Date.now() - 86400000 * 2).toISOString(),
                    },
                    {
                        id: 'tr-008',
                        fromState: workflow_1.WorkflowState.Draft,
                        toState: workflow_1.WorkflowState.InReview,
                        action: workflow_1.WorkflowAction.SubmitForReview,
                        actorName: 'Sarah Ahmed',
                        actorRole: 'ContentEditor',
                        timestamp: new Date(Date.now() - 86400000 * 6).toISOString(),
                    }
                ]
            },
            {
                id: 'item-105',
                titleAr: 'مسودة أولية: تقييم الأثر البيئي للفيضانات الموسمية بالنيل الأزرق',
                titleEn: 'Initial Draft: Blue Nile Seasonal Flood Environmental Assessment',
                contentType: 'News',
                currentState: workflow_1.WorkflowState.Draft,
                authorName: 'Sarah Ahmed',
                createdAt: now,
                updatedAt: now,
                category: 'Environmental Disasters',
                history: []
            }
        ];
    }
}
exports.WorkflowEngine = WorkflowEngine;
//# sourceMappingURL=workflowEngine.js.map