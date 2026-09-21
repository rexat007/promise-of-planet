/**
 * Canonical Enrollment Entity for Promise of Planet Member & Training Access Foundation.
 * Represents a participation relationship between an authenticated Account and a TrainingCourse.
 */
export interface Enrollment {
  id: string;        // Deterministic document identity: `${accountId}_${courseId}`
  accountId: string; // Authenticated Account UID
  courseId: string;  // Canonical TrainingCourse.id
  createdAt: string; // ISO 8601 Timestamp
}
