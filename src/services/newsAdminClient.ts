import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth, isFirebaseConfigured } from './firebase';
import type { NewsItem } from '../types/news';
import type { WorkflowState } from '../types/workflow';
import type { AdminUser } from '../types/admin';

export type NewsAdminTransport = (action: string, payload?: any) => Promise<any>;

let customAdminTransport: NewsAdminTransport | null = null;

function getFunctionsInstance() {
  if (!isFirebaseConfigured || !app) {
    throw new Error('BACKEND_UNCONFIGURED: Firebase backend is not configured in client environment.');
  }
  if (!auth?.currentUser) {
    throw new Error('UNAUTHENTICATED: Authentication required. Newsroom management requires an authenticated Admin user session.');
  }
  return getFunctions(app);
}

export class NewsAdminClient {
  /**
   * Allows injecting an isolated transport function (used for automated testing without live network mutation).
   */
  public static setTransport(transport: NewsAdminTransport | null): void {
    customAdminTransport = transport;
  }

  public static isBackendAvailable(): boolean {
    return isFirebaseConfigured && !!app;
  }

  public static isAuthenticated(): boolean {
    return !!(isFirebaseConfigured && auth?.currentUser);
  }

  private static async executeAction<T = any>(action: string, payload?: any): Promise<T> {
    if (customAdminTransport) {
      return customAdminTransport(action, payload);
    }
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string; [key: string]: any }, T>(fns, 'manageNews');
    const res = await callable({ action, ...payload });
    return res.data;
  }

  /**
   * Retrieves all news items from authoritative server repository.
   */
  public static async listAll(): Promise<NewsItem[]> {
    const data = await this.executeAction<{ items: NewsItem[] }>('listAll');
    return data.items || [];
  }

  /**
   * Retrieves a single news item by ID from authoritative server repository.
   */
  public static async getById(id: string): Promise<NewsItem | null> {
    if (!id || typeof id !== 'string') return null;
    const data = await this.executeAction<{ item: NewsItem | null }>('getById', { id: id.trim() });
    return data.item ?? null;
  }

  /**
   * Saves or updates a draft article via server-authoritative manageNews.
   * For new articles (isNew === true or when item.id is omitted), the provisional client ID is omitted
   * so the server executes createDraft and assigns an authoritative Firestore ID.
   */
  public static async saveNewsItem(
    item: Partial<NewsItem>,
    _actor?: AdminUser,
    isNew: boolean = false
  ): Promise<NewsItem> {
    if (!item.titleAr || item.titleAr.trim() === '') {
      throw new Error('Arabic title (titleAr) is mandatory for Promise of Planet news items');
    }

    const payload: Record<string, any> = {};

    if (item.titleAr !== undefined) payload.titleAr = item.titleAr.trim();
    if (item.titleEn !== undefined) payload.titleEn = item.titleEn.trim();
    if (item.summaryAr !== undefined) payload.summaryAr = item.summaryAr.trim();
    if (item.summaryEn !== undefined) payload.summaryEn = item.summaryEn.trim();
    if (item.bodyAr !== undefined) payload.bodyAr = item.bodyAr;
    if (item.bodyEn !== undefined) payload.bodyEn = item.bodyEn;
    if (item.category !== undefined) payload.category = item.category;
    if (item.tags !== undefined) payload.tags = item.tags;
    if (item.sources !== undefined) payload.sources = item.sources;
    if (item.featuredImage !== undefined) payload.featuredImage = item.featuredImage;
    if (item.location !== undefined) payload.location = item.location;
    if (item.urgencyLevel !== undefined) payload.urgencyLevel = item.urgencyLevel;
    if (item.relatedVideoIds !== undefined) payload.relatedVideoIds = item.relatedVideoIds;
    if (item.author !== undefined) payload.author = item.author;

    if (isNew) {
      payload.titleEn = payload.titleEn || '';
      payload.summaryAr = payload.summaryAr || '';
      payload.summaryEn = payload.summaryEn || '';
      payload.bodyAr = payload.bodyAr || '';
      payload.bodyEn = payload.bodyEn || '';
      payload.category = payload.category || 'Climate';
      payload.tags = payload.tags || [];
      payload.sources = payload.sources || [];
      payload.location = payload.location || 'Sudan / السودان';
      payload.urgencyLevel = payload.urgencyLevel || 'Standard';
      payload.relatedVideoIds = payload.relatedVideoIds || [];
    } else if (item.id && !item.id.startsWith('news-sudan-provisional-') && !item.id.startsWith('temp-')) {
      payload.id = item.id;
    }

    const data = await this.executeAction<{ item: NewsItem }>('saveDraft', { item: payload });
    return data.item;
  }

  /**
   * Executes a workflow transition with server-side authorization and audit logging.
   * Human explicit publication required for state === 'Published'.
   */
  public static async executeTransition(
    newsItemId: string,
    targetState: WorkflowState,
    _actor?: AdminUser,
    comment?: string
  ): Promise<NewsItem> {
    if (!newsItemId || !targetState) {
      throw new Error('newsItemId and targetState are required for workflow transition');
    }

    const data = await this.executeAction<{ item: NewsItem }>('transitionWorkflow', {
      id: newsItemId,
      targetState,
      comment: comment?.trim() || undefined,
    });

    return data.item;
  }

  /**
   * Test/environment utility to clear test state. Does not touch live storage or local storage.
   */
  public static clear(): void {
    // No-op in production; retained for test suite compatibility
  }
}
