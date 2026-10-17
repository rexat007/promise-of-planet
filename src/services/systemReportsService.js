"use strict";
/**
 * Canonical System Reports Service & Pure Derivations
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. READ-ONLY DERIVED REPORTING: All reports are computed purely on-demand from existing canonical sources.
 * 2. NO PARALLEL STORE: Never maintains a secondary database, report cache, or shadow metrics table.
 * 3. NO DUPLICATE ENUMS: Directly reuses domain enums (WorkflowState, LibraryRightsStatus, AdminRole, etc.).
 * 4. CURRENT-STATE REALITY: All metrics reflect active canonical in-memory state; no fabricated historical analytics.
 * 5. SEPARATION OF CONCERNS:
 *    - Domain Reports: Operational state of current entities (News, Library, Courses, etc.).
 *    - Audit Report: Operational activity of the audit log itself (never substituted for domain state).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SystemReportsService = void 0;
exports.deriveNewsReport = deriveNewsReport;
exports.deriveLibraryReport = deriveLibraryReport;
exports.deriveTrainingReport = deriveTrainingReport;
exports.deriveCommunityReport = deriveCommunityReport;
exports.deriveAIReviewReport = deriveAIReviewReport;
exports.deriveUsersReport = deriveUsersReport;
exports.deriveAuditActivityReport = deriveAuditActivityReport;
exports.deriveSystemOperationalSummary = deriveSystemOperationalSummary;
const library_1 = require("../types/library");
const community_1 = require("../types/community");
const aiReview_1 = require("../types/aiReview");
const admin_1 = require("../types/admin");
const audit_1 = require("../types/audit");
const workflow_1 = require("../types/workflow");
const mockNewsData_1 = require("../data/mockNewsData");
const mockLibraryData_1 = require("../data/mockLibraryData");
const mockTrainingData_1 = require("../data/mockTrainingData");
const mockCommunityData_1 = require("../data/mockCommunityData");
const aiReviewService_1 = require("./aiReviewService");
const adminAccess_1 = require("./adminAccess");
const adminAuditService_1 = require("./adminAuditService");
// ==========================================
// PURE DERIVATION FUNCTIONS
// ==========================================
/**
 * Derives operational report for Environmental News.
 */
function deriveNewsReport(newsList = []) {
    const byWorkflowState = {
        [workflow_1.WorkflowState.Draft]: 0,
        [workflow_1.WorkflowState.InReview]: 0,
        [workflow_1.WorkflowState.ChangesRequested]: 0,
        [workflow_1.WorkflowState.Approved]: 0,
        [workflow_1.WorkflowState.Published]: 0,
    };
    const byCategory = {};
    for (const item of newsList) {
        if (item.workflowState && byWorkflowState[item.workflowState] !== undefined) {
            byWorkflowState[item.workflowState]++;
        }
        if (item.category) {
            byCategory[item.category] = (byCategory[item.category] || 0) + 1;
        }
    }
    return {
        totalCount: newsList.length,
        byWorkflowState,
        byCategory,
    };
}
/**
 * Derives operational report for Knowledge Library.
 */
function deriveLibraryReport(documents = [], organizations = [], sources = []) {
    const byWorkflowState = {
        [workflow_1.WorkflowState.Draft]: 0,
        [workflow_1.WorkflowState.InReview]: 0,
        [workflow_1.WorkflowState.ChangesRequested]: 0,
        [workflow_1.WorkflowState.Approved]: 0,
        [workflow_1.WorkflowState.Published]: 0,
    };
    const byRightsStatus = {
        [library_1.LibraryRightsStatus.Unknown]: 0,
        [library_1.LibraryRightsStatus.ReviewRequired]: 0,
        [library_1.LibraryRightsStatus.PermissionRequired]: 0,
        [library_1.LibraryRightsStatus.PermissionGranted]: 0,
        [library_1.LibraryRightsStatus.OpenPubliclyAvailable]: 0,
        [library_1.LibraryRightsStatus.Restricted]: 0,
        [library_1.LibraryRightsStatus.NotRedistributable]: 0,
    };
    const byDocumentType = {
        [library_1.LibraryDocumentType.Law]: 0,
        [library_1.LibraryDocumentType.ExecutiveRegulation]: 0,
        [library_1.LibraryDocumentType.Decision]: 0,
        [library_1.LibraryDocumentType.InstitutionalReport]: 0,
        [library_1.LibraryDocumentType.PolicyPaper]: 0,
        [library_1.LibraryDocumentType.ResearchStudy]: 0,
        [library_1.LibraryDocumentType.InternationalAgreement]: 0,
    };
    const byLanguage = {};
    for (const doc of documents) {
        if (doc.workflowState && byWorkflowState[doc.workflowState] !== undefined) {
            byWorkflowState[doc.workflowState]++;
        }
        if (doc.rightsStatus && byRightsStatus[doc.rightsStatus] !== undefined) {
            byRightsStatus[doc.rightsStatus]++;
        }
        if (doc.documentType && byDocumentType[doc.documentType] !== undefined) {
            byDocumentType[doc.documentType]++;
        }
        if (doc.language) {
            byLanguage[doc.language] = (byLanguage[doc.language] || 0) + 1;
        }
    }
    return {
        totalCount: documents.length,
        byWorkflowState,
        byRightsStatus,
        byDocumentType,
        byLanguage,
        totalOrganizationsCount: organizations.length,
        totalSourcesCount: sources.length,
    };
}
/**
 * Derives operational report for Training Courses.
 */
function deriveTrainingReport(courses = []) {
    const byWorkflowState = {
        [workflow_1.WorkflowState.Draft]: 0,
        [workflow_1.WorkflowState.InReview]: 0,
        [workflow_1.WorkflowState.ChangesRequested]: 0,
        [workflow_1.WorkflowState.Approved]: 0,
        [workflow_1.WorkflowState.Published]: 0,
    };
    const byLevel = {
        Beginner: 0,
        Intermediate: 0,
        Advanced: 0,
    };
    const byDeliveryMode = {
        OnlineSelfPaced: 0,
        LiveWorkshop: 0,
        FieldCohort: 0,
    };
    let totalDurationHours = 0;
    for (const course of courses) {
        if (course.workflowState && byWorkflowState[course.workflowState] !== undefined) {
            byWorkflowState[course.workflowState]++;
        }
        if (course.level && byLevel[course.level] !== undefined) {
            byLevel[course.level]++;
        }
        if (course.deliveryMode && byDeliveryMode[course.deliveryMode] !== undefined) {
            byDeliveryMode[course.deliveryMode]++;
        }
        if (typeof course.durationHours === 'number' && !isNaN(course.durationHours)) {
            totalDurationHours += course.durationHours;
        }
    }
    return {
        totalCount: courses.length,
        byWorkflowState,
        byLevel,
        byDeliveryMode,
        totalDurationHours,
    };
}
/**
 * Derives operational report for Community & Citizen Journalism Submissions.
 */
function deriveCommunityReport(submissions = []) {
    const byStatus = {
        [community_1.SubmissionStatus.Received]: 0,
        [community_1.SubmissionStatus.UnderReview]: 0,
        [community_1.SubmissionStatus.AcceptedForEditorial]: 0,
        [community_1.SubmissionStatus.Rejected]: 0,
    };
    const byCategory = {};
    const byLanguage = {};
    let withAttachmentsCount = 0;
    let totalAttachmentsCount = 0;
    for (const sub of submissions) {
        if (sub.status && byStatus[sub.status] !== undefined) {
            byStatus[sub.status]++;
        }
        if (sub.category) {
            byCategory[sub.category] = (byCategory[sub.category] || 0) + 1;
        }
        if (sub.sourceLanguage) {
            byLanguage[sub.sourceLanguage] = (byLanguage[sub.sourceLanguage] || 0) + 1;
        }
        if (sub.attachments && sub.attachments.length > 0) {
            withAttachmentsCount++;
            totalAttachmentsCount += sub.attachments.length;
        }
    }
    return {
        totalCount: submissions.length,
        byStatus,
        byCategory,
        byLanguage,
        withAttachmentsCount,
        totalAttachmentsCount,
    };
}
/**
 * Derives operational report for AI Content Auditor Artifacts.
 */
function deriveAIReviewReport(artifacts = []) {
    const byExecutionState = {
        [aiReview_1.AIReviewExecutionState.Completed]: 0,
        [aiReview_1.AIReviewExecutionState.Pending]: 0,
        [aiReview_1.AIReviewExecutionState.Failed]: 0,
    };
    const byTargetType = {
        [aiReview_1.AIReviewTargetType.News]: 0,
        [aiReview_1.AIReviewTargetType.LibraryDocument]: 0,
        [aiReview_1.AIReviewTargetType.TrainingCourse]: 0,
        [aiReview_1.AIReviewTargetType.CitizenSubmission]: 0,
    };
    const findingsBySeverity = {
        [aiReview_1.AIReviewSeverity.Info]: 0,
        [aiReview_1.AIReviewSeverity.Warning]: 0,
        [aiReview_1.AIReviewSeverity.ReviewRecommended]: 0,
    };
    const findingsByCategory = {
        [aiReview_1.AIReviewCategory.Completeness]: 0,
        [aiReview_1.AIReviewCategory.Clarity]: 0,
        [aiReview_1.AIReviewCategory.SourceReferenceQuality]: 0,
        [aiReview_1.AIReviewCategory.PossibleInconsistency]: 0,
        [aiReview_1.AIReviewCategory.MetadataCompleteness]: 0,
        [aiReview_1.AIReviewCategory.RightsConcern]: 0,
        [aiReview_1.AIReviewCategory.LanguagePresentation]: 0,
    };
    let totalFindingsCount = 0;
    for (const artifact of artifacts) {
        if (artifact.executionState && byExecutionState[artifact.executionState] !== undefined) {
            byExecutionState[artifact.executionState]++;
        }
        if (artifact.target?.targetType && byTargetType[artifact.target.targetType] !== undefined) {
            byTargetType[artifact.target.targetType]++;
        }
        if (Array.isArray(artifact.findings)) {
            totalFindingsCount += artifact.findings.length;
            for (const finding of artifact.findings) {
                if (finding.severity && findingsBySeverity[finding.severity] !== undefined) {
                    findingsBySeverity[finding.severity]++;
                }
                if (finding.category && findingsByCategory[finding.category] !== undefined) {
                    findingsByCategory[finding.category]++;
                }
            }
        }
    }
    return {
        totalArtifactsCount: artifacts.length,
        byExecutionState,
        byTargetType,
        totalFindingsCount,
        findingsBySeverity,
        findingsByCategory,
    };
}
/**
 * Derives operational report for Users & RBAC.
 */
function deriveUsersReport(users = []) {
    const byRole = {
        [admin_1.AdminRole.Owner]: 0,
        [admin_1.AdminRole.ContentEditor]: 0,
        [admin_1.AdminRole.LibraryCurator]: 0,
        [admin_1.AdminRole.RightsReviewer]: 0,
        [admin_1.AdminRole.TrainingManager]: 0,
        [admin_1.AdminRole.Trainer]: 0,
        [admin_1.AdminRole.CitizenModerator]: 0,
        [admin_1.AdminRole.AIAssistant]: 0,
        [admin_1.AdminRole.Viewer]: 0,
    };
    let activeUsersCount = 0;
    let inactiveUsersCount = 0;
    let activeOwnerCount = 0;
    for (const user of users) {
        if (user.role && byRole[user.role] !== undefined) {
            byRole[user.role]++;
        }
        if (user.isActive) {
            activeUsersCount++;
            if (user.role === admin_1.AdminRole.Owner) {
                activeOwnerCount++;
            }
        }
        else {
            inactiveUsersCount++;
        }
    }
    return {
        totalUsersCount: users.length,
        activeUsersCount,
        inactiveUsersCount,
        byRole,
        activeOwnerCount,
    };
}
/**
 * Derives operational report for Platform Audit Activity.
 */
function deriveAuditActivityReport(events = []) {
    const byTargetType = {
        [audit_1.AuditTargetType.News]: 0,
        [audit_1.AuditTargetType.LibraryDocument]: 0,
        [audit_1.AuditTargetType.TrainingCourse]: 0,
        [audit_1.AuditTargetType.CitizenSubmission]: 0,
        [audit_1.AuditTargetType.AdminUser]: 0,
        [audit_1.AuditTargetType.AIReviewArtifact]: 0,
        [audit_1.AuditTargetType.GlobalSettings]: 0,
        [audit_1.AuditTargetType.Media]: 0,
    };
    const byAction = {
        [audit_1.AuditAction.Created]: 0,
        [audit_1.AuditAction.Updated]: 0,
        [audit_1.AuditAction.WorkflowTransitioned]: 0,
        [audit_1.AuditAction.StatusChanged]: 0,
        [audit_1.AuditAction.RoleChanged]: 0,
        [audit_1.AuditAction.RightsChanged]: 0,
    };
    for (const event of events) {
        if (event.targetType && byTargetType[event.targetType] !== undefined) {
            byTargetType[event.targetType]++;
        }
        if (event.action && byAction[event.action] !== undefined) {
            byAction[event.action]++;
        }
    }
    return {
        totalEventsCount: events.length,
        byTargetType,
        byAction,
    };
}
/**
 * Derives the complete unified operational summary.
 */
function deriveSystemOperationalSummary(context) {
    const news = deriveNewsReport(context?.news ?? mockNewsData_1.INITIAL_MOCK_NEWS);
    const library = deriveLibraryReport(context?.documents ?? mockLibraryData_1.MOCK_LIBRARY_DOCUMENTS, context?.organizations ?? mockLibraryData_1.MOCK_ORGANIZATIONS, context?.sources ?? mockLibraryData_1.MOCK_SOURCES);
    const training = deriveTrainingReport(context?.courses ?? mockTrainingData_1.MOCK_TRAINING_COURSES);
    const community = deriveCommunityReport(context?.submissions ?? mockCommunityData_1.MOCK_CITIZEN_SUBMISSIONS);
    const aiReview = deriveAIReviewReport(context?.artifacts ?? aiReviewService_1.AIReviewService.getAllReviews());
    const users = deriveUsersReport(context?.users ?? adminAccess_1.AdminAccessService.getMockUsers());
    const auditActivity = deriveAuditActivityReport(context?.events ?? adminAuditService_1.AdminAuditService.getEvents());
    return {
        generatedAt: context?.timestamp ?? new Date().toISOString(),
        dataScope: 'in-memory-operational-snapshot',
        news,
        library,
        training,
        community,
        aiReview,
        users,
        auditActivity,
    };
}
// ==========================================
// READ-ONLY REPORTING SERVICE FACADE
// ==========================================
class SystemReportsService {
    /**
     * Generates operational report for News.
     */
    static getNewsReport(customNews) {
        return deriveNewsReport(customNews ?? mockNewsData_1.INITIAL_MOCK_NEWS);
    }
    /**
     * Generates operational report for Knowledge Library.
     */
    static getLibraryReport(customDocs, customOrgs, customSources) {
        return deriveLibraryReport(customDocs ?? mockLibraryData_1.MOCK_LIBRARY_DOCUMENTS, customOrgs ?? mockLibraryData_1.MOCK_ORGANIZATIONS, customSources ?? mockLibraryData_1.MOCK_SOURCES);
    }
    /**
     * Generates operational report for Training Courses.
     */
    static getTrainingReport(customCourses) {
        return deriveTrainingReport(customCourses ?? mockTrainingData_1.MOCK_TRAINING_COURSES);
    }
    /**
     * Generates operational report for Citizen Submissions.
     */
    static getCommunityReport(customSubmissions) {
        return deriveCommunityReport(customSubmissions ?? mockCommunityData_1.MOCK_CITIZEN_SUBMISSIONS);
    }
    /**
     * Generates operational report for AI Review Artifacts.
     */
    static getAIReviewReport(customArtifacts) {
        return deriveAIReviewReport(customArtifacts ?? aiReviewService_1.AIReviewService.getAllReviews());
    }
    /**
     * Generates operational report for Users & RBAC.
     */
    static getUsersReport(customUsers) {
        return deriveUsersReport(customUsers ?? adminAccess_1.AdminAccessService.getMockUsers());
    }
    /**
     * Generates operational report for Audit Activity.
     */
    static getAuditActivityReport(customEvents) {
        return deriveAuditActivityReport(customEvents ?? adminAuditService_1.AdminAuditService.getEvents());
    }
    /**
     * Generates the comprehensive operational platform summary.
     */
    static getSystemSummary(context) {
        return deriveSystemOperationalSummary(context);
    }
}
exports.SystemReportsService = SystemReportsService;
//# sourceMappingURL=systemReportsService.js.map