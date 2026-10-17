"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIReviewExecutionState = exports.AIFactualFlag = exports.AIReviewSeverity = exports.AIReviewCategory = exports.AIReviewTargetType = void 0;
exports.AIReviewTargetType = {
    News: 'News',
    LibraryDocument: 'LibraryDocument',
    TrainingCourse: 'TrainingCourse',
    CitizenSubmission: 'CitizenSubmission',
};
/**
 * Operational Review Categories justified by current platform domains.
 */
exports.AIReviewCategory = {
    Completeness: 'Completeness',
    Clarity: 'Clarity',
    SourceReferenceQuality: 'SourceReferenceQuality',
    PossibleInconsistency: 'PossibleInconsistency',
    MetadataCompleteness: 'MetadataCompleteness',
    RightsConcern: 'RightsConcern',
    LanguagePresentation: 'LanguagePresentation',
};
/**
 * Non-numeric, operationally clear attention levels.
 */
exports.AIReviewSeverity = {
    Info: 'Info',
    Warning: 'Warning',
    ReviewRecommended: 'ReviewRecommended',
};
/**
 * Factual-review attention flags.
 * AI flags statements for human factual review; it does NOT certify objective truth.
 * Only applied when factual or source verification is specifically warranted.
 */
exports.AIFactualFlag = {
    NeedsReview: 'NeedsReview',
    PossibleInconsistency: 'PossibleInconsistency',
    SourceCheckSuggested: 'SourceCheckSuggested',
};
/**
 * Technical execution state of the AI audit operation (NOT editorial workflow state).
 */
exports.AIReviewExecutionState = {
    Completed: 'Completed',
    Pending: 'Pending',
    Failed: 'Failed',
};
//# sourceMappingURL=aiReview.js.map