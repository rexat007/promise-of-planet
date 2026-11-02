import {
  AIReviewTargetType as CanonicalAIReviewTargetType,
  type AIReviewTargetType as CanonicalAIReviewTargetTypeUnion,
} from '../../functions/src/shared/aiReviewContract';

export const AIReviewTargetType = CanonicalAIReviewTargetType;
export type AIReviewTargetType = CanonicalAIReviewTargetTypeUnion | string;

export {
  PEIALibraryPreparationInputBasis,
  PEIALibrarySuggestedDocumentType,
  type PEIALibraryPreparationAdvisoryPayload,
  type ReviewTargetIdentity,
  AIReviewCategory,
  AIReviewSeverity,
  AIFactualFlag,
  type AIReviewFinding,
  AIReviewExecutionState,
  type AIReviewArtifact,
} from '../../functions/src/shared/aiReviewContract';
