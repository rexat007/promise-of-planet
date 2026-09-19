import { WorkflowState } from './workflow';
import { LibraryRightsStatus, LibraryDocumentType } from './library';
import type { TrainingLevel, DeliveryMode } from './training';
import { SubmissionStatus } from './community';
import { 
  AIReviewExecutionState, 
  AIReviewSeverity, 
  AIReviewCategory, 
  AIReviewTargetType 
} from './aiReview';
import { AdminRole } from './admin';
import { AuditTargetType, AuditAction } from './audit';

/**
 * Environmental News Operational Report Contract
 * Derived purely from canonical NewsItem records.
 */
export interface NewsOperationalReport {
  totalCount: number;
  byWorkflowState: Record<WorkflowState, number>;
  byCategory: Record<string, number>;
}

/**
 * Knowledge Library Operational Report Contract
 * Derived purely from canonical LibraryDocument, Organization, and Source records.
 */
export interface LibraryOperationalReport {
  totalCount: number;
  byWorkflowState: Record<WorkflowState, number>;
  byRightsStatus: Record<LibraryRightsStatus, number>;
  byDocumentType: Record<LibraryDocumentType, number>;
  byLanguage: Record<string, number>;
  totalOrganizationsCount: number;
  totalSourcesCount: number;
}

/**
 * Training & Capacity Operational Report Contract
 * Derived purely from canonical TrainingCourse records.
 */
export interface TrainingOperationalReport {
  totalCount: number;
  byWorkflowState: Record<WorkflowState, number>;
  byLevel: Record<TrainingLevel, number>;
  byDeliveryMode: Record<DeliveryMode, number>;
  totalDurationHours: number;
}

/**
 * Citizen & Community Submissions Operational Report Contract
 * Derived purely from canonical CitizenSubmission records.
 */
export interface CommunityOperationalReport {
  totalCount: number;
  byStatus: Record<SubmissionStatus, number>;
  byCategory: Record<string, number>;
  byLanguage: Record<string, number>;
  withAttachmentsCount: number;
  totalAttachmentsCount: number;
}

/**
 * AI Content Auditor Operational Report Contract
 * Derived purely from canonical AIReviewArtifact records.
 */
export interface AIReviewOperationalReport {
  totalArtifactsCount: number;
  byExecutionState: Record<AIReviewExecutionState, number>;
  byTargetType: Record<AIReviewTargetType, number>;
  totalFindingsCount: number;
  findingsBySeverity: Record<AIReviewSeverity, number>;
  findingsByCategory: Record<AIReviewCategory, number>;
}

/**
 * Users & RBAC Operational Report Contract
 * Derived purely from canonical AdminUser records.
 */
export interface UsersOperationalReport {
  totalUsersCount: number;
  activeUsersCount: number;
  inactiveUsersCount: number;
  byRole: Record<AdminRole, number>;
  activeOwnerCount: number;
}

/**
 * Audit Activity Operational Summary Contract
 * Summarizes audit logging activity itself (NOT a substitute for domain state).
 */
export interface AuditActivityOperationalReport {
  totalEventsCount: number;
  byTargetType: Record<AuditTargetType, number>;
  byAction: Record<AuditAction, number>;
}

/**
 * Unified System Operational Summary Contract
 * Deterministic aggregation of canonical operational metrics for the current session.
 */
export interface SystemOperationalSummary {
  generatedAt: string;
  dataScope: 'in-memory-operational-snapshot';
  news: NewsOperationalReport;
  library: LibraryOperationalReport;
  training: TrainingOperationalReport;
  community: CommunityOperationalReport;
  aiReview: AIReviewOperationalReport;
  users: UsersOperationalReport;
  auditActivity: AuditActivityOperationalReport;
}
