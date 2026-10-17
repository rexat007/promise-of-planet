import type { NewsItem } from '../types/news';
import { WorkflowState } from '../types/workflow';
import type { AdminUser } from '../types/admin';
import { WorkflowEngine } from './workflowEngine';

const STORAGE_KEY = 'pop_news_durable_store_v1';

export class NewsAdminClient {
  private static getStoredItems(): NewsItem[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to read news items from durable storage:', e);
    }
    return [];
  }

  private static persistItems(items: NewsItem[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (e) {
      console.error('Failed to write news items to durable storage:', e);
    }
  }

  /**
   * Retrieves all news items from durable storage.
   */
  public static async listAll(): Promise<NewsItem[]> {
    return this.getStoredItems();
  }

  /**
   * Retrieves a single news item by ID.
   */
  public static async getById(id: string): Promise<NewsItem | null> {
    const items = this.getStoredItems();
    return items.find(item => item.id === id) || null;
  }

  /**
   * Saves or updates a draft/article durably.
   * Ensures author, source, dates and bilingual content are preserved.
   */
  public static async saveNewsItem(
    item: NewsItem,
    actor: AdminUser
  ): Promise<NewsItem> {
    if (!item.titleAr || item.titleAr.trim() === '') {
      throw new Error('Arabic title (titleAr) is mandatory for Promise of Planet news items');
    }

    const items = this.getStoredItems();
    const existingIndex = items.findIndex(n => n.id === item.id);
    const now = new Date().toISOString();

    let updatedItem: NewsItem;

    if (existingIndex >= 0) {
      const existing = items[existingIndex];
      updatedItem = {
        ...existing,
        ...item,
        updatedAt: now,
        // Preserve original author if not changed
        author: item.author || existing.author || actor.name,
      };
      items[existingIndex] = updatedItem;
    } else {
      updatedItem = {
        ...item,
        createdAt: item.createdAt || now,
        updatedAt: now,
        author: item.author || actor.name,
        workflowState: item.workflowState || WorkflowState.Draft,
        history: item.history || [],
      };
      items.unshift(updatedItem);
    }

    this.persistItems(items);
    return updatedItem;
  }

  /**
   * Executes a workflow transition with authorization check and history audit.
   * STRICT: Human explicit publication only!
   */
  public static async executeTransition(
    newsItemId: string,
    targetState: WorkflowState,
    actor: AdminUser,
    comment?: string
  ): Promise<NewsItem> {
    const items = this.getStoredItems();
    const existingIndex = items.findIndex(n => n.id === newsItemId);
    if (existingIndex < 0) {
      throw new Error(`News item with ID ${newsItemId} not found`);
    }

    const existing = items[existingIndex];

    // Build adapter item for WorkflowEngine
    const adapterItem = {
      id: existing.id,
      titleAr: existing.titleAr,
      titleEn: existing.titleEn || '',
      contentType: 'News' as const,
      currentState: existing.workflowState,
      authorName: existing.author,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
      category: existing.category,
      history: existing.history || [],
    };

    // Execute transition using canonical WorkflowEngine (validates permissions & workflow rules)
    const resultAdapter = WorkflowEngine.executeTransition(
      adapterItem,
      targetState,
      actor,
      comment
    );

    const now = new Date().toISOString();
    const updatedNewsItem: NewsItem = {
      ...existing,
      workflowState: resultAdapter.currentState,
      updatedAt: resultAdapter.updatedAt,
      history: resultAdapter.history,
      publishedAt: resultAdapter.currentState === WorkflowState.Published 
        ? (existing.publishedAt || now) 
        : existing.publishedAt,
    };

    items[existingIndex] = updatedNewsItem;
    this.persistItems(items);
    return updatedNewsItem;
  }

  /**
   * Resets/seeds items for testing or administration initialization if empty.
   */
  public static seedIfEmpty(items: NewsItem[]): void {
    const existing = this.getStoredItems();
    if (existing.length === 0 && items.length > 0) {
      this.persistItems(items);
    }
  }

  /**
   * Clears storage (used for tests).
   */
  public static clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_e) {
      // ignore
    }
  }
}
