import { isCanonicalCategory, type JournalisticType, type Category } from '../shared/contentContract';
import { MAX_WORKFLOW_COMMENT_LENGTH } from '../shared/workflowContract';

export { MAX_WORKFLOW_COMMENT_LENGTH };

export const VALID_JOURNALISTIC_TYPES: readonly JournalisticType[] = [
  'News',
  'Report',
  'Article',
  'Investigation',
  'Interview',
  'Analysis',
  'Opinion',
  'Explainer',
  'Feature',
] as const;

export function isValidJournalisticType(val: any): val is JournalisticType {
  return VALID_JOURNALISTIC_TYPES.includes(val);
}

import type { 
  NewsItemBackend, 
  WorkflowStateBackend, 
  WorkflowActionBackend 
} from './newsRepository';

export class NewsValidator {
  /**
   * Validates that a category value is an authorized canonical environmental category.
   */
  public static validateCanonicalCategory(category: unknown): asserts category is Category {
    if (typeof category !== 'string' || category.trim() === '' || !isCanonicalCategory(category)) {
      throw new Error(`VALIDATION_ERROR: INVALID_CANONICAL_NEWS_CATEGORY '${category}'`);
    }
  }

  /**
   * Validates draft or article data for persistence.
   */
  public static validateNewsPayload(payload: Partial<NewsItemBackend>): void {
    if (!payload.titleAr || typeof payload.titleAr !== 'string' || payload.titleAr.trim() === '') {
      throw new Error('VALIDATION_ERROR: Arabic title (titleAr) is mandatory for Promise of Planet news items');
    }

    if (!payload.author || typeof payload.author !== 'string' || payload.author.trim() === '') {
      throw new Error('VALIDATION_ERROR: Author is mandatory for news items');
    }
    if (payload.kickerAr !== undefined && typeof payload.kickerAr !== 'string') {
      throw new Error('VALIDATION_ERROR: Arabic kicker (kickerAr) must be a string');
    }
    if (payload.kickerEn !== undefined && typeof payload.kickerEn !== 'string') {
      throw new Error('VALIDATION_ERROR: English kicker (kickerEn) must be a string');
    }
    if (payload.journalisticType !== undefined && !isValidJournalisticType(payload.journalisticType)) {
      throw new Error(`VALIDATION_ERROR: Invalid journalisticType '${payload.journalisticType}'. Must be one of: ${VALID_JOURNALISTIC_TYPES.join(', ')}`);
    }
  }

  /**
   * Validates whether a workflow state transition is permissible.
   * STRICT: Human explicit publication only! No automatic publishing.
   */
  public static validateTransition(
    currentState: WorkflowStateBackend,
    targetState: WorkflowStateBackend,
    comment?: string
  ): WorkflowActionBackend {
    if (currentState === targetState) {
      throw new Error(`VALIDATION_ERROR: Item is already in state '${currentState}'`);
    }

    if (
      comment !== undefined &&
      typeof comment === 'string' &&
      (comment.length > MAX_WORKFLOW_COMMENT_LENGTH ||
        comment.trim().length > MAX_WORKFLOW_COMMENT_LENGTH)
    ) {
      throw new Error(
        `VALIDATION_ERROR: Workflow transition comment exceeds maximum length of ${MAX_WORKFLOW_COMMENT_LENGTH} characters`
      );
    }

    // 1. Draft -> InReview
    if (currentState === 'Draft' && targetState === 'InReview') {
      return 'submit_for_review';
    }

    // 2. InReview -> ChangesRequested
    if (currentState === 'InReview' && targetState === 'ChangesRequested') {
      if (typeof comment !== 'string' || comment.trim() === '') {
        throw new Error('VALIDATION_ERROR: Editorial comment is required when requesting changes');
      }
      return 'request_changes';
    }

    // 3. InReview -> Approved
    if (currentState === 'InReview' && targetState === 'Approved') {
      return 'approve';
    }

    // 4. ChangesRequested -> Draft
    if (currentState === 'ChangesRequested' && targetState === 'Draft') {
      return 'revise_draft';
    }

    // 5. Approved -> Published (Only approved items can be published!)
    if (currentState === 'Approved' && targetState === 'Published') {
      return 'publish';
    }

    // 6. Published -> Draft (Owner-only formal editorial withdrawal for revision; requires written reason)
    if (currentState === 'Published' && targetState === 'Draft') {
      if (typeof comment !== 'string' || comment.trim() === '') {
        throw new Error(
          'VALIDATION_ERROR: Written withdrawal reason is mandatory when withdrawing a published article to Draft'
        );
      }
      return 'withdraw_for_revision';
    }

    // Block invalid jumps (e.g. Draft directly to Published)
    if (targetState === 'Published' && currentState !== 'Approved') {
      throw new Error(
        `VALIDATION_ERROR: Publication forbidden. Item must be in 'Approved' state before human publication. Current state is '${currentState}'.`
      );
    }

    throw new Error(
      `VALIDATION_ERROR: Unauthorized transition path from '${currentState}' to '${targetState}'`
    );
  }
}
