import type { AdminRole } from './admin';

/**
 * Canonical Audit Target Types
 * Represents the distinct administrative and content domains present in Promise of Planet.
 */
export const AuditTargetType = {
  News: 'News',
  LibraryDocument: 'LibraryDocument',
  TrainingCourse: 'TrainingCourse',
  CitizenSubmission: 'CitizenSubmission',
  AdminUser: 'AdminUser',
  AIReviewArtifact: 'AIReviewArtifact',
  GlobalSettings: 'GlobalSettings',
  Media: 'Media',
} as const;

export type AuditTargetType = typeof AuditTargetType[keyof typeof AuditTargetType];

/**
 * Minimal Canonical Audit Action Vocabulary
 * Composed with `targetType` to express domain-specific actions with zero redundant keys.
 */
export const AuditAction = {
  Created: 'Created',
  Updated: 'Updated',
  WorkflowTransitioned: 'WorkflowTransitioned',
  StatusChanged: 'StatusChanged',
  RoleChanged: 'RoleChanged',
  RightsChanged: 'RightsChanged',
} as const;

export type AuditAction = typeof AuditAction[keyof typeof AuditAction];

/**
 * Compact Change Representation
 * Records specific field-level delta without storing entire entity copies or large payloads.
 */
export interface AuditChange {
  field: string;
  previousValue?: string | number | boolean | null;
  newValue?: string | number | boolean | null;
}

/**
 * Canonical Audit Event Contract
 * Represents an immutable, completed administrative action across all back-office domains.
 */
export interface AuditEvent {
  id: string;
  timestamp: string; // ISO 8601 canonical timestamp
  actorUserId: string; // Stable reference to canonical AdminUser ID
  actorName: string; // Immutable display snapshot for historical readability
  actorRole: AdminRole; // Role snapshot at the moment of action execution
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  targetTitle?: string; // Descriptive entity title/name snapshot
  changes?: AuditChange[];
  metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Query filter structure for filtering platform audit history.
 */
export interface AuditFilterQuery {
  actorUserId?: string;
  targetType?: AuditTargetType;
  targetId?: string;
  action?: AuditAction;
  fromDate?: string;
  toDate?: string;
}
