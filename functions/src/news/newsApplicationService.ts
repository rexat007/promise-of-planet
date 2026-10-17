import type { 
  NewsRepository, 
  NewsItemBackend, 
  WorkflowStateBackend, 
  WorkflowTransitionRecordBackend 
} from './newsRepository';
import { FirestoreNewsRepository } from './firestoreNewsRepository';
import { NewsValidator } from './newsValidator';

export interface SaveNewsInput {
  id?: string;
  titleAr: string;
  titleEn?: string;
  summaryAr: string;
  summaryEn?: string;
  bodyAr: string;
  bodyEn?: string;
  author?: string;
  category: string;
  tags?: string[];
  sources?: string[];
  featuredImage?: string;
  location?: string;
  urgencyLevel?: 'Standard' | 'Urgent' | 'Breaking';
  relatedVideoIds?: string[];
}

export interface ActorContext {
  uid: string;
  name: string;
  role: string;
}

export class NewsApplicationService {
  private repo: NewsRepository;

  constructor(repo?: NewsRepository) {
    this.repo = repo || new FirestoreNewsRepository();
  }

  async listAll(): Promise<NewsItemBackend[]> {
    return this.repo.listAll();
  }

  async getById(id: string): Promise<NewsItemBackend | null> {
    return this.repo.getById(id);
  }

  /**
   * Creates a new draft article.
   */
  async createDraft(input: SaveNewsInput, actor: ActorContext): Promise<NewsItemBackend> {
    const now = new Date().toISOString();
    const id = input.id || `news-${Date.now()}`;

    const item: NewsItemBackend = {
      id,
      titleAr: input.titleAr,
      titleEn: input.titleEn || '',
      summaryAr: input.summaryAr || '',
      summaryEn: input.summaryEn || '',
      bodyAr: input.bodyAr || '',
      bodyEn: input.bodyEn || '',
      author: input.author || actor.name,
      category: input.category,
      tags: input.tags || [],
      sources: input.sources || [],
      featuredImage: input.featuredImage,
      workflowState: 'Draft',
      createdAt: now,
      updatedAt: now,
      history: [
        {
          id: `trans-${Date.now()}-init`,
          fromState: 'Draft',
          toState: 'Draft',
          action: 'revise_draft',
          actorName: actor.name,
          actorRole: actor.role,
          timestamp: now,
          comment: 'Initial draft created',
        },
      ],
      location: input.location,
      urgencyLevel: input.urgencyLevel || 'Standard',
      relatedVideoIds: input.relatedVideoIds || [],
    };

    NewsValidator.validateNewsPayload(item);
    await this.repo.save(item);
    return item;
  }

  /**
   * Updates an existing draft or article while in editorial workflow.
   */
  async updateDraft(id: string, input: Partial<SaveNewsInput>, actor: ActorContext): Promise<NewsItemBackend> {
    const existing = await this.repo.getById(id);
    if (!existing) {
      throw new Error(`NOT_FOUND: News article with ID ${id} does not exist`);
    }

    const now = new Date().toISOString();
    const updated: NewsItemBackend = {
      ...existing,
      ...input,
      id: existing.id,
      updatedAt: now,
      author: input.author || existing.author || actor.name,
    };

    NewsValidator.validateNewsPayload(updated);
    await this.repo.save(updated);
    return updated;
  }

  /**
   * Transitions an article through the editorial workflow.
   * Human explicit publication required for state === 'Published'.
   */
  async transitionWorkflow(
    id: string,
    targetState: WorkflowStateBackend,
    actor: ActorContext,
    comment?: string
  ): Promise<NewsItemBackend> {
    const existing = await this.repo.getById(id);
    if (!existing) {
      throw new Error(`NOT_FOUND: News article with ID ${id} does not exist`);
    }

    const action = NewsValidator.validateTransition(existing.workflowState, targetState, comment);
    const now = new Date().toISOString();

    const transitionRecord: WorkflowTransitionRecordBackend = {
      id: `trans-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      fromState: existing.workflowState,
      toState: targetState,
      action,
      actorName: actor.name,
      actorRole: actor.role,
      timestamp: now,
      comment: comment || undefined,
    };

    const updated: NewsItemBackend = {
      ...existing,
      workflowState: targetState,
      updatedAt: now,
      publishedAt: targetState === 'Published' ? (existing.publishedAt || now) : existing.publishedAt,
      history: [...(existing.history || []), transitionRecord],
    };

    await this.repo.save(updated);
    return updated;
  }
}
