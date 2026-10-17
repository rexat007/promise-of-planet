"use strict";
/**
 * AI Review Service & Provider Boundary
 *
 * Defines the contract for AI-assisted analysis without coupling to any live AI provider.
 * Enforces human decision authority and source immutability.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIReviewService = exports.NullAIReviewProvider = void 0;
const mockAIReviewData_1 = require("../data/mockAIReviewData");
/**
 * Default Unconfigured Provider.
 * Safely handles calls when no external model provider is connected.
 */
class NullAIReviewProvider {
    name = 'NullAIReviewProvider';
    isConfigured = false;
    analyze(target) {
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
exports.NullAIReviewProvider = NullAIReviewProvider;
/**
 * Core AI Content Review Service.
 * Provides query methods and freshness checks while guaranteeing that AI findings remain advisory.
 */
class AIReviewService {
    static provider = new NullAIReviewProvider();
    static reviewStore = [...mockAIReviewData_1.MOCK_AI_REVIEWS];
    /**
     * Sets the active provider behind the provider-independent boundary.
     */
    static setProvider(provider) {
        this.provider = provider;
    }
    /**
     * Returns the current provider instance.
     */
    static getProvider() {
        return this.provider;
    }
    /**
     * Checks if an AI review artifact is stale compared to the current content version.
     */
    static isReviewStale(review, currentSourceUpdatedAt) {
        if (!review.target.sourceUpdatedAt || !currentSourceUpdatedAt) {
            return false;
        }
        // If the content's updatedAt timestamp is strictly newer than when the review was bound, mark as stale
        return new Date(currentSourceUpdatedAt).getTime() > new Date(review.target.sourceUpdatedAt).getTime();
    }
    /**
     * Retrieves an advisory review for a specific content target.
     */
    static getReviewForTarget(targetType, targetId) {
        return this.reviewStore.find((rev) => rev.target.targetType === targetType && rev.target.targetId === targetId) || null;
    }
    /**
     * Returns all known mock review artifacts.
     */
    static getAllReviews() {
        return [...this.reviewStore];
    }
    /**
     * Architectural invariant assertion:
     * Guarantees that the AI Review engine has no authority to mutate workflows, statuses, or records.
     */
    static assertAuthorityBoundary() {
        return {
            allowsDirectWorkflowMutation: false,
            allowsDirectStatusMutation: false,
            allowsDirectRightsMutation: false,
            isAdvisoryOnly: true,
        };
    }
}
exports.AIReviewService = AIReviewService;
//# sourceMappingURL=aiReviewService.js.map