import type { News } from '../types';
import { WorkflowState } from '../types/workflow';
import { NewsAdminClient } from './newsAdminClient';
import { toCanonicalNews, normalizeCategory } from './newsDomainAdapter';

export interface PublicNewsFilterOptions {
  searchQuery?: string;
  category?: string; // 'all' or canonical category
  sortBy?: 'recent' | 'relevant';
  language?: 'ar' | 'en';
}

export class PublicNewsClient {
  /**
   * Generates a semantic slug from title for URL/sharing.
   */
  public static getSlug(title: string): string {
    return (title || '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\u0600-\u06FFa-z0-9-]/g, '')
      .replace(/-+/g, '-');
  }

  /**
   * Retrieves all published, approved news articles for the public hub.
   * Strictly enforces workflowState === 'Published'.
   * No draft or unapproved items will ever be returned.
   */
  public static async listPublishedNews(options: PublicNewsFilterOptions = {}): Promise<News[]> {
    // 1. Fetch from durable storage / API
    const rawItems = await NewsAdminClient.listAll();

    // 2. Filter strictly for Published
    const publishedWorkflowItems = rawItems.filter(
      item => item.workflowState === WorkflowState.Published
    );

    // 3. Convert to canonical News model
    let canonicalItems: News[] = publishedWorkflowItems.map(toCanonicalNews);

    // 4. Language availability filter:
    if (options.language) {
      canonicalItems = canonicalItems.filter(item => {
        if (options.language === 'en') {
          // If English requested, must have at least titleEn or contentEn, or fallback gracefully
          return Boolean(item.titleEn || item.titleAr);
        }
        // Arabic is primary canonical
        return Boolean(item.titleAr);
      });
    }

    // 5. Category filter
    if (options.category && options.category !== 'all') {
      const normalizedReqCat = normalizeCategory(options.category);
      canonicalItems = canonicalItems.filter(item => item.category === normalizedReqCat);
    }

    // 6. Search query filter
    if (options.searchQuery && options.searchQuery.trim() !== '') {
      const q = options.searchQuery.toLowerCase().trim();
      canonicalItems = canonicalItems.filter(item => {
        const titleAr = (item.titleAr || '').toLowerCase();
        const titleEn = (item.titleEn || '').toLowerCase();
        const excerptAr = (item.excerptAr || '').toLowerCase();
        const excerptEn = (item.excerptEn || '').toLowerCase();
        const contentAr = (item.contentAr || '').toLowerCase();
        const contentEn = (item.contentEn || '').toLowerCase();
        const author = (item.author || '').toLowerCase();

        return (
          titleAr.includes(q) ||
          titleEn.includes(q) ||
          excerptAr.includes(q) ||
          excerptEn.includes(q) ||
          contentAr.includes(q) ||
          contentEn.includes(q) ||
          author.includes(q)
        );
      });
    }

    // 7. Sort by publication date (descending by default)
    canonicalItems.sort((a, b) => {
      const dateA = new Date(a.publishedAt || a.createdAt).getTime();
      const dateB = new Date(b.publishedAt || b.createdAt).getTime();
      return dateB - dateA;
    });

    return canonicalItems;
  }

  /**
   * Retrieves a single published article by ID or slug.
   */
  public static async getPublishedArticle(idOrSlug: string): Promise<News | null> {
    const published = await this.listPublishedNews();
    const match = published.find(item => {
      if (item.id === idOrSlug) return true;
      const slug = this.getSlug(item.titleAr);
      const slugEn = item.titleEn ? this.getSlug(item.titleEn) : '';
      return slug === idOrSlug || slugEn === idOrSlug;
    });
    return match || null;
  }
}
