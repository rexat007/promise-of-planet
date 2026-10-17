"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INITIAL_MOCK_AUDIT_EVENTS = void 0;
const admin_1 = require("../types/admin");
const audit_1 = require("../types/audit");
/**
 * Canonical Seed Audit Events
 * Represents realistic administrative events across all back-office domains in session/demo mode.
 */
exports.INITIAL_MOCK_AUDIT_EVENTS = [
    // 1. News Domain: Publication of news-sudan-101
    {
        id: 'audit-evt-101',
        timestamp: '2026-09-14T11:20:00Z',
        actorUserId: 'u-1',
        actorName: 'Abbass Abdelhalim',
        actorRole: admin_1.AdminRole.Owner,
        action: audit_1.AuditAction.WorkflowTransitioned,
        targetType: audit_1.AuditTargetType.News,
        targetId: 'news-sudan-101',
        targetTitle: 'ارتفاع مناسيب النيل الأزرق وتنبيهات لمزارعي ولاية سنار',
        changes: [
            { field: 'workflowState', previousValue: 'Approved', newValue: 'Published' },
        ],
        metadata: {
            actionLabel: 'Publish',
            comment: 'تم الاعتماد النهائي والنشر للمنصة العامة.',
        },
    },
    // 2. Library Domain: Rights Clearance change for doc-201
    {
        id: 'audit-evt-102',
        timestamp: '2026-09-15T09:30:00Z',
        actorUserId: 'u-4',
        actorName: 'Amna Al-Bashir',
        actorRole: admin_1.AdminRole.RightsReviewer,
        action: audit_1.AuditAction.RightsChanged,
        targetType: audit_1.AuditTargetType.LibraryDocument,
        targetId: 'doc-201',
        targetTitle: 'قانون حماية البيئة والموارد الطبيعية لعام 2001',
        changes: [
            { field: 'rightsStatus', previousValue: 'ReviewRequired', newValue: 'PermissionGranted' },
        ],
        metadata: {
            rightsNotes: 'تم استلام خطاب رسمي من وزارة العدل يسمح بإعادة النشر للأغراض البحثية.',
        },
    },
    // 3. Training Domain: Course Creation for course-01
    {
        id: 'audit-evt-103',
        timestamp: '2026-09-10T14:00:00Z',
        actorUserId: 'u-6',
        actorName: 'Dr. Tariq Ali',
        actorRole: admin_1.AdminRole.Trainer,
        action: audit_1.AuditAction.Created,
        targetType: audit_1.AuditTargetType.TrainingCourse,
        targetId: 'course-01',
        targetTitle: 'مبادئ الإدارة المتكاملة للنفايات الصلبة في المناطق الحضرية',
        changes: [
            { field: 'workflowState', previousValue: null, newValue: 'Draft' },
            { field: 'level', previousValue: null, newValue: 'Beginner' },
            { field: 'deliveryMode', previousValue: null, newValue: 'OnlineSelfPaced' },
        ],
    },
    // 4. Community Domain: Moderation status change for sub-001
    {
        id: 'audit-evt-104',
        timestamp: '2026-09-16T10:00:00Z',
        actorUserId: 'u-7',
        actorName: 'Yasmine Omer',
        actorRole: admin_1.AdminRole.CitizenModerator,
        action: audit_1.AuditAction.StatusChanged,
        targetType: audit_1.AuditTargetType.CitizenSubmission,
        targetId: 'sub-001',
        targetTitle: 'ملاحظة تراجع منسوب النيل الأبيض وتأثيره على صغار الصيادين',
        changes: [
            { field: 'status', previousValue: 'Received', newValue: 'UnderReview' },
        ],
        metadata: {
            moderatorNotes: 'تم استلام التقرير الميداني وتحويله للفريق الصحفي للتحقق.',
        },
    },
    // 5. Users & Permissions Domain: Role change for u-2
    {
        id: 'audit-evt-105',
        timestamp: '2026-09-12T16:45:00Z',
        actorUserId: 'u-1',
        actorName: 'Abbass Abdelhalim',
        actorRole: admin_1.AdminRole.Owner,
        action: audit_1.AuditAction.RoleChanged,
        targetType: audit_1.AuditTargetType.AdminUser,
        targetId: 'u-2',
        targetTitle: 'Sarah Ahmed (editor@promiseofplanet.sd)',
        changes: [
            { field: 'role', previousValue: 'Viewer', newValue: 'ContentEditor' },
        ],
    },
    // 6. Users & Permissions Domain: Demo identity creation
    {
        id: 'audit-evt-106',
        timestamp: '2026-09-11T09:15:00Z',
        actorUserId: 'u-1',
        actorName: 'Abbass Abdelhalim',
        actorRole: admin_1.AdminRole.Owner,
        action: audit_1.AuditAction.Created,
        targetType: audit_1.AuditTargetType.AdminUser,
        targetId: 'u-9',
        targetTitle: 'Mona El-Tayeb (viewer@promiseofplanet.sd)',
        changes: [
            { field: 'role', previousValue: null, newValue: 'Viewer' },
            { field: 'isActive', previousValue: null, newValue: true },
        ],
    },
    // 7. AI Content Auditor Domain: Advisory Review Artifact Generated
    {
        id: 'audit-evt-107',
        timestamp: '2026-09-14T11:25:00Z',
        actorUserId: 'u-8',
        actorName: 'Gemini Agent',
        actorRole: admin_1.AdminRole.AIAssistant,
        action: audit_1.AuditAction.Created,
        targetType: audit_1.AuditTargetType.AIReviewArtifact,
        targetId: 'ai-rev-news-101',
        targetTitle: 'Advisory Review for news-sudan-101',
        changes: [
            { field: 'executionState', previousValue: null, newValue: 'Completed' },
            { field: 'findingsCount', previousValue: null, newValue: 2 },
        ],
        metadata: {
            isAdvisoryOnly: true,
            providerId: 'mock-audit-engine',
        },
    },
];
//# sourceMappingURL=mockAuditData.js.map