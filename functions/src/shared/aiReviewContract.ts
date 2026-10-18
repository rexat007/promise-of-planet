/**
 * AI Content Auditor - Foundation & Human-Decision Review Contract
 * 
 * ARCHITECTURAL PRINCIPLE:
 * CONTENT -> AI-ASSISTED ANALYSIS -> STRUCTURED REVIEW FINDINGS -> HUMAN REVIEW -> HUMAN DECISION THROUGH EXISTING DOMAIN WORKFLOW
 * 
 * CRITICAL AUTHORITY BOUNDARY:
 * - AI is strictly ADVISORY.
 * - AI is NOT an approval authority.
 * - AI MUST NOT autonomously publish, approve, reject, change WorkflowState,
 *   change CitizenSubmissionStatus, grant LibraryRightsStatus, or alter canonical source records.
 */

export const AIReviewTargetType = {
  News: 'News',
  LibraryDocument: 'LibraryDocument',
  TrainingCourse: 'TrainingCourse',
  CitizenSubmission: 'CitizenSubmission',
} as const;

export type AIReviewTargetType = typeof AIReviewTargetType[keyof typeof AIReviewTargetType];

/**
 * Minimal Target Identity required to bind a review to a canonical content record.
 */
export interface ReviewTargetIdentity {
  targetType: AIReviewTargetType;
  targetId: string;
  sourceUpdatedAt: string; // Used for stale-review detection against current content updatedAt
}

/**
 * Operational Review Categories justified by current platform domains.
 */
export const AIReviewCategory = {
  Completeness: 'Completeness',
  Clarity: 'Clarity',
  SourceReferenceQuality: 'SourceReferenceQuality',
  PossibleInconsistency: 'PossibleInconsistency',
  MetadataCompleteness: 'MetadataCompleteness',
  RightsConcern: 'RightsConcern',
  LanguagePresentation: 'LanguagePresentation',
} as const;

export type AIReviewCategory = typeof AIReviewCategory[keyof typeof AIReviewCategory];

/**
 * Non-numeric, operationally clear attention levels.
 */
export const AIReviewSeverity = {
  Info: 'Info',
  Warning: 'Warning',
  ReviewRecommended: 'ReviewRecommended',
} as const;

export type AIReviewSeverity = typeof AIReviewSeverity[keyof typeof AIReviewSeverity];

/**
 * Factual-review attention flags.
 * AI flags statements for human factual review; it does NOT certify objective truth.
 * Only applied when factual or source verification is specifically warranted.
 */
export const AIFactualFlag = {
  NeedsReview: 'NeedsReview',
  PossibleInconsistency: 'PossibleInconsistency',
  SourceCheckSuggested: 'SourceCheckSuggested',
} as const;

export type AIFactualFlag = typeof AIFactualFlag[keyof typeof AIFactualFlag];

/**
 * Canonical Review Finding Model.
 * Atomic finding with single source-language prose and optional advisory suggestion.
 * Translation into other display languages is handled as a presentation derivative.
 */
export interface AIReviewFinding {
  id: string;
  category: AIReviewCategory;
  severity: AIReviewSeverity;
  flag?: AIFactualFlag;
  message: string;
  sourceLanguage: 'ar' | 'en';
  affectedField?: string;
  suggestion?: string;
}

/**
 * Technical execution state of the AI audit operation (NOT editorial workflow state).
 */
export const AIReviewExecutionState = {
  Completed: 'Completed',
  Pending: 'Pending',
  Failed: 'Failed',
} as const;

export type AIReviewExecutionState = typeof AIReviewExecutionState[keyof typeof AIReviewExecutionState];

/**
 * Canonical AI Review Result / Artifact.
 * Attaches structured findings to a content target while enforcing source immutability.
 */
export interface AIReviewArtifact {
  id: string;
  target: ReviewTargetIdentity;
  generatedAt: string;
  executionState: AIReviewExecutionState;
  findings: AIReviewFinding[];
  providerId: string; // e.g. 'null-provider', 'mock-audit-engine'
  readonly isAdvisoryOnly: true; // Hard architectural indicator that this artifact carries no executive authority
}
