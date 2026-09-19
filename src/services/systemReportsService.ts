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

import type { NewsItem } from '../types/news';
import type { 
  LibraryDocument, 
  LibraryOrganization, 
  LibrarySource 
} from '../types/library';
import { 
  LibraryRightsStatus, 
  LibraryDocumentType 
} from '../types/library';
import type { TrainingCourse, TrainingLevel, DeliveryMode } from '../types/training';
import type { CitizenSubmission } from '../types/community';
import { SubmissionStatus } from '../types/community';
import type { AIReviewArtifact } from '../types/aiReview';
import { 
  AIReviewExecutionState, 
  AIReviewSeverity, 
  AIReviewCategory, 
  AIReviewTargetType 
} from '../types/aiReview';
import type { AdminUser } from '../types/admin';
import { AdminRole } from '../types/admin';
import type { AuditEvent } from '../types/audit';
import { AuditTargetType, AuditAction } from '../types/audit';
import { WorkflowState } from '../types/workflow';

import type {
  NewsOperationalReport,
  LibraryOperationalReport,
  TrainingOperationalReport,
  CommunityOperationalReport,
  AIReviewOperationalReport,
  UsersOperationalReport,
  AuditActivityOperationalReport,
  SystemOperationalSummary,
} from '../types/reports';

import { INITIAL_MOCK_NEWS } from '../data/mockNewsData';
import { 
  MOCK_LIBRARY_DOCUMENTS, 
  MOCK_ORGANIZATIONS, 
  MOCK_SOURCES 
} from '../data/mockLibraryData';
import { MOCK_TRAINING_COURSES } from '../data/mockTrainingData';
import { MOCK_CITIZEN_SUBMISSIONS } from '../data/mockCommunityData';
import { AIReviewService } from './aiReviewService';
import { AdminAccessService } from './adminAccess';
import { AdminAuditService } from './adminAuditService';

// ==========================================
// PURE DERIVATION FUNCTIONS
// ==========================================

/**
 * Derives operational report for Environmental News.
 */
export function deriveNewsReport(newsList: NewsItem[] = []): NewsOperationalReport {
  const byWorkflowState: Record<WorkflowState, number> = {
    [WorkflowState.Draft]: 0,
    [WorkflowState.InReview]: 0,
    [WorkflowState.ChangesRequested]: 0,
    [WorkflowState.Approved]: 0,
    [WorkflowState.Published]: 0,
  };

  const byCategory: Record<string, number> = {};

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
export function deriveLibraryReport(
  documents: LibraryDocument[] = [],
  organizations: LibraryOrganization[] = [],
  sources: LibrarySource[] = []
): LibraryOperationalReport {
  const byWorkflowState: Record<WorkflowState, number> = {
    [WorkflowState.Draft]: 0,
    [WorkflowState.InReview]: 0,
    [WorkflowState.ChangesRequested]: 0,
    [WorkflowState.Approved]: 0,
    [WorkflowState.Published]: 0,
  };

  const byRightsStatus: Record<LibraryRightsStatus, number> = {
    [LibraryRightsStatus.Unknown]: 0,
    [LibraryRightsStatus.ReviewRequired]: 0,
    [LibraryRightsStatus.PermissionRequired]: 0,
    [LibraryRightsStatus.PermissionGranted]: 0,
    [LibraryRightsStatus.OpenPubliclyAvailable]: 0,
    [LibraryRightsStatus.Restricted]: 0,
    [LibraryRightsStatus.NotRedistributable]: 0,
  };

  const byDocumentType: Record<LibraryDocumentType, number> = {
    [LibraryDocumentType.Law]: 0,
    [LibraryDocumentType.ExecutiveRegulation]: 0,
    [LibraryDocumentType.Decision]: 0,
    [LibraryDocumentType.InstitutionalReport]: 0,
    [LibraryDocumentType.PolicyPaper]: 0,
    [LibraryDocumentType.ResearchStudy]: 0,
    [LibraryDocumentType.InternationalAgreement]: 0,
  };

  const byLanguage: Record<string, number> = {};

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
export function deriveTrainingReport(courses: TrainingCourse[] = []): TrainingOperationalReport {
  const byWorkflowState: Record<WorkflowState, number> = {
    [WorkflowState.Draft]: 0,
    [WorkflowState.InReview]: 0,
    [WorkflowState.ChangesRequested]: 0,
    [WorkflowState.Approved]: 0,
    [WorkflowState.Published]: 0,
  };

  const byLevel: Record<TrainingLevel, number> = {
    Beginner: 0,
    Intermediate: 0,
    Advanced: 0,
  };

  const byDeliveryMode: Record<DeliveryMode, number> = {
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
export function deriveCommunityReport(submissions: CitizenSubmission[] = []): CommunityOperationalReport {
  const byStatus: Record<SubmissionStatus, number> = {
    [SubmissionStatus.Received]: 0,
    [SubmissionStatus.UnderReview]: 0,
    [SubmissionStatus.AcceptedForEditorial]: 0,
    [SubmissionStatus.Rejected]: 0,
  };

  const byCategory: Record<string, number> = {};
  const byLanguage: Record<string, number> = {};
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
export function deriveAIReviewReport(artifacts: AIReviewArtifact[] = []): AIReviewOperationalReport {
  const byExecutionState: Record<AIReviewExecutionState, number> = {
    [AIReviewExecutionState.Completed]: 0,
    [AIReviewExecutionState.Pending]: 0,
    [AIReviewExecutionState.Failed]: 0,
  };

  const byTargetType: Record<AIReviewTargetType, number> = {
    [AIReviewTargetType.News]: 0,
    [AIReviewTargetType.LibraryDocument]: 0,
    [AIReviewTargetType.TrainingCourse]: 0,
    [AIReviewTargetType.CitizenSubmission]: 0,
  };

  const findingsBySeverity: Record<AIReviewSeverity, number> = {
    [AIReviewSeverity.Info]: 0,
    [AIReviewSeverity.Warning]: 0,
    [AIReviewSeverity.ReviewRecommended]: 0,
  };

  const findingsByCategory: Record<AIReviewCategory, number> = {
    [AIReviewCategory.Completeness]: 0,
    [AIReviewCategory.Clarity]: 0,
    [AIReviewCategory.SourceReferenceQuality]: 0,
    [AIReviewCategory.PossibleInconsistency]: 0,
    [AIReviewCategory.MetadataCompleteness]: 0,
    [AIReviewCategory.RightsConcern]: 0,
    [AIReviewCategory.LanguagePresentation]: 0,
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
export function deriveUsersReport(users: AdminUser[] = []): UsersOperationalReport {
  const byRole: Record<AdminRole, number> = {
    [AdminRole.Owner]: 0,
    [AdminRole.ContentEditor]: 0,
    [AdminRole.LibraryCurator]: 0,
    [AdminRole.RightsReviewer]: 0,
    [AdminRole.TrainingManager]: 0,
    [AdminRole.Trainer]: 0,
    [AdminRole.CitizenModerator]: 0,
    [AdminRole.AIAssistant]: 0,
    [AdminRole.Viewer]: 0,
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
      if (user.role === AdminRole.Owner) {
        activeOwnerCount++;
      }
    } else {
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
export function deriveAuditActivityReport(events: AuditEvent[] = []): AuditActivityOperationalReport {
  const byTargetType: Record<AuditTargetType, number> = {
    [AuditTargetType.News]: 0,
    [AuditTargetType.LibraryDocument]: 0,
    [AuditTargetType.TrainingCourse]: 0,
    [AuditTargetType.CitizenSubmission]: 0,
    [AuditTargetType.AdminUser]: 0,
    [AuditTargetType.AIReviewArtifact]: 0,
    [AuditTargetType.GlobalSettings]: 0,
    [AuditTargetType.Media]: 0,
  };

  const byAction: Record<AuditAction, number> = {
    [AuditAction.Created]: 0,
    [AuditAction.Updated]: 0,
    [AuditAction.WorkflowTransitioned]: 0,
    [AuditAction.StatusChanged]: 0,
    [AuditAction.RoleChanged]: 0,
    [AuditAction.RightsChanged]: 0,
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
export function deriveSystemOperationalSummary(context?: {
  news?: NewsItem[];
  documents?: LibraryDocument[];
  organizations?: LibraryOrganization[];
  sources?: LibrarySource[];
  courses?: TrainingCourse[];
  submissions?: CitizenSubmission[];
  artifacts?: AIReviewArtifact[];
  users?: AdminUser[];
  events?: AuditEvent[];
  timestamp?: string;
}): SystemOperationalSummary {
  const news = deriveNewsReport(context?.news ?? INITIAL_MOCK_NEWS);
  const library = deriveLibraryReport(
    context?.documents ?? MOCK_LIBRARY_DOCUMENTS,
    context?.organizations ?? MOCK_ORGANIZATIONS,
    context?.sources ?? MOCK_SOURCES
  );
  const training = deriveTrainingReport(context?.courses ?? MOCK_TRAINING_COURSES);
  const community = deriveCommunityReport(context?.submissions ?? MOCK_CITIZEN_SUBMISSIONS);
  const aiReview = deriveAIReviewReport(context?.artifacts ?? AIReviewService.getAllReviews());
  const users = deriveUsersReport(context?.users ?? AdminAccessService.getMockUsers());
  const auditActivity = deriveAuditActivityReport(context?.events ?? AdminAuditService.getEvents());

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

export class SystemReportsService {
  /**
   * Generates operational report for News.
   */
  public static getNewsReport(customNews?: NewsItem[]): NewsOperationalReport {
    return deriveNewsReport(customNews ?? INITIAL_MOCK_NEWS);
  }

  /**
   * Generates operational report for Knowledge Library.
   */
  public static getLibraryReport(
    customDocs?: LibraryDocument[],
    customOrgs?: LibraryOrganization[],
    customSources?: LibrarySource[]
  ): LibraryOperationalReport {
    return deriveLibraryReport(
      customDocs ?? MOCK_LIBRARY_DOCUMENTS,
      customOrgs ?? MOCK_ORGANIZATIONS,
      customSources ?? MOCK_SOURCES
    );
  }

  /**
   * Generates operational report for Training Courses.
   */
  public static getTrainingReport(customCourses?: TrainingCourse[]): TrainingOperationalReport {
    return deriveTrainingReport(customCourses ?? MOCK_TRAINING_COURSES);
  }

  /**
   * Generates operational report for Citizen Submissions.
   */
  public static getCommunityReport(customSubmissions?: CitizenSubmission[]): CommunityOperationalReport {
    return deriveCommunityReport(customSubmissions ?? MOCK_CITIZEN_SUBMISSIONS);
  }

  /**
   * Generates operational report for AI Review Artifacts.
   */
  public static getAIReviewReport(customArtifacts?: AIReviewArtifact[]): AIReviewOperationalReport {
    return deriveAIReviewReport(customArtifacts ?? AIReviewService.getAllReviews());
  }

  /**
   * Generates operational report for Users & RBAC.
   */
  public static getUsersReport(customUsers?: AdminUser[]): UsersOperationalReport {
    return deriveUsersReport(customUsers ?? AdminAccessService.getMockUsers());
  }

  /**
   * Generates operational report for Audit Activity.
   */
  public static getAuditActivityReport(customEvents?: AuditEvent[]): AuditActivityOperationalReport {
    return deriveAuditActivityReport(customEvents ?? AdminAuditService.getEvents());
  }

  /**
   * Generates the comprehensive operational platform summary.
   */
  public static getSystemSummary(context?: {
    news?: NewsItem[];
    documents?: LibraryDocument[];
    organizations?: LibraryOrganization[];
    sources?: LibrarySource[];
    courses?: TrainingCourse[];
    submissions?: CitizenSubmission[];
    artifacts?: AIReviewArtifact[];
    users?: AdminUser[];
    events?: AuditEvent[];
  }): SystemOperationalSummary {
    return deriveSystemOperationalSummary(context);
  }
}
