import type { NewsRepository, SanitizedPublicNewsDTO } from './newsRepository';
import { FirestoreNewsRepository } from './firestoreNewsRepository';

export class PublicNewsRepository {
  private repo: NewsRepository;

  constructor(repo?: NewsRepository) {
    this.repo = repo || new FirestoreNewsRepository();
  }

  /**
   * Retrieves strictly published, approved, sanitized news articles.
   * Internal review notes, approval transition records, and draft metadata
   * are completely stripped before returning to the public client.
   */
  async listPublicNews(language?: 'ar' | 'en'): Promise<SanitizedPublicNewsDTO[]> {
    const rawItems = await this.repo.listPublished(language);

    // Double-check workflowState is strictly 'Published'
    const published = rawItems.filter(item => item.workflowState === 'Published');

    return published.map(item => ({
      id: item.id,
      titleAr: item.titleAr,
      titleEn: item.titleEn || undefined,
      summaryAr: item.summaryAr,
      summaryEn: item.summaryEn || undefined,
      bodyAr: item.bodyAr,
      bodyEn: item.bodyEn || undefined,
      author: item.author,
      category: item.category,
      tags: item.tags || [],
      sources: item.sources || [],
      featuredImage: item.featuredImage,
      location: item.location || 'Sudan / السودان',
      urgencyLevel: item.urgencyLevel || 'Standard',
      publishedAt: item.publishedAt || item.updatedAt || item.createdAt,
      createdAt: item.createdAt,
      relatedVideoIds: item.relatedVideoIds || [],
    }));
  }

  /**
   * Retrieves a single published, sanitized article by ID.
   */
  async getPublicNewsById(id: string, language?: 'ar' | 'en'): Promise<SanitizedPublicNewsDTO | null> {
    const item = await this.repo.getById(id);
    if (!item || item.workflowState !== 'Published') {
      return null;
    }

    if (language === 'en' && !item.titleEn && !item.bodyEn) {
      return null;
    }

    return {
      id: item.id,
      titleAr: item.titleAr,
      titleEn: item.titleEn || undefined,
      summaryAr: item.summaryAr,
      summaryEn: item.summaryEn || undefined,
      bodyAr: item.bodyAr,
      bodyEn: item.bodyEn || undefined,
      author: item.author,
      category: item.category,
      tags: item.tags || [],
      sources: item.sources || [],
      featuredImage: item.featuredImage,
      location: item.location || 'Sudan / السودان',
      urgencyLevel: item.urgencyLevel || 'Standard',
      publishedAt: item.publishedAt || item.updatedAt || item.createdAt,
      createdAt: item.createdAt,
      relatedVideoIds: item.relatedVideoIds || [],
    };
  }
}
