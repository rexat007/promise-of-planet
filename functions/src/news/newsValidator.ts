import type { 
  NewsItemBackend, 
  WorkflowStateBackend, 
  WorkflowActionBackend 
} from './newsRepository';

export class NewsValidator {
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

    // 1. Draft -> InReview
    if (currentState === 'Draft' && targetState === 'InReview') {
      return 'submit_for_review';
    }

    // 2. InReview -> ChangesRequested
    if (currentState === 'InReview' && targetState === 'ChangesRequested') {
      if (!comment || comment.trim() === '') {
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
