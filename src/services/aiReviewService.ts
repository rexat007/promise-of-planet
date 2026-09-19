/**
 * AI Review Service & Provider Boundary
 * 
 * Defines the contract for AI-assisted analysis without coupling to any live AI provider.
 * Enforces human decision authority and source immutability.
 */

import type { 
  AIReviewArtifact, 
  AIReviewTargetType, 
  ReviewTargetIdentity 
} from '../types/aiReview';
import { MOCK_AI_REVIEWS } from '../data/mockAIReviewData';

/**
 * Provider-independent interface for AI-assisted review analysis.
 */
export interface AIReviewProvider {
  readonly name: string;
  readonly isConfigured: boolean;
  analyze(target: ReviewTargetIdentity, content: unknown): Promise<AIReviewArtifact> | AIReviewArtifact;
}

/**
 * Default Unconfigured Provider.
 * Safely handles calls when no external model provider is connected.
 */
export class NullAIReviewProvider implements AIReviewProvider {
  public readonly name = 'NullAIReviewProvider';
  public readonly isConfigured = false;

  public analyze(target: ReviewTargetIdentity): AIReviewArtifact {
    return {
      id: `ai-rev-unconfigured-${Date.now()}`,
      target,
      generatedAt: new Date().toISOString(),
      executionState: 'Failed',
      findings: [],
      providerId: 'unconfigured-null-provider',
      isAdvisoryOnly: true,
    };
  }
}

/**
 * Core AI Content Review Service.
 * Provides query methods and freshness checks while guaranteeing that AI findings remain advisory.
 */
export class AIReviewService {
  private static provider: AIReviewProvider = new NullAIReviewProvider();
  private static reviewStore: AIReviewArtifact[] = [...MOCK_AI_REVIEWS];

  /**
   * Sets the active provider behind the provider-independent boundary.
   */
  public static setProvider(provider: AIReviewProvider): void {
    this.provider = provider;
  }

  /**
   * Returns the current provider instance.
   */
  public static getProvider(): AIReviewProvider {
    return this.provider;
  }

  /**
   * Checks if an AI review artifact is stale compared to the current content version.
   */
  public static isReviewStale(review: AIReviewArtifact, currentSourceUpdatedAt: string): boolean {
    if (!review.target.sourceUpdatedAt || !currentSourceUpdatedAt) {
      return false;
    }
    // If the content's updatedAt timestamp is strictly newer than when the review was bound, mark as stale
    return new Date(currentSourceUpdatedAt).getTime() > new Date(review.target.sourceUpdatedAt).getTime();
  }

  /**
   * Retrieves an advisory review for a specific content target.
   */
  public static getReviewForTarget(
    targetType: AIReviewTargetType, 
    targetId: string
  ): AIReviewArtifact | null {
    return this.reviewStore.find(
      (rev) => rev.target.targetType === targetType && rev.target.targetId === targetId
    ) || null;
  }

  /**
   * Returns all known mock review artifacts.
   */
  public static getAllReviews(): AIReviewArtifact[] {
    return [...this.reviewStore];
  }

  /**
   * Architectural invariant assertion:
   * Guarantees that the AI Review engine has no authority to mutate workflows, statuses, or records.
   */
  public static assertAuthorityBoundary() {
    return {
      allowsDirectWorkflowMutation: false as const,
      allowsDirectStatusMutation: false as const,
      allowsDirectRightsMutation: false as const,
      isAdvisoryOnly: true as const,
    };
  }
}
