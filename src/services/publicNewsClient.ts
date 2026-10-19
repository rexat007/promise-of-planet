import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, isFirebaseConfigured } from './firebase';
import type { News } from '../types';
import { publicDtoToCanonicalNews, normalizeCategory } from './newsDomainAdapter';
import type { SanitizedPublicNewsDTO } from './newsDomainAdapter';

export interface PublicNewsFilterOptions {
  searchQuery?: string;
  category?: string; // 'all' or canonical category
  sortBy?: 'recent' | 'relevant';
  language?: 'ar' | 'en';
}

export type PublicNewsTransport = (data: { lang?: 'ar' | 'en' }) => Promise<{ articles: SanitizedPublicNewsDTO[] }>;

let customPublicTransport: PublicNewsTransport | null = null;

export class PublicNewsClient {
  /**
   * Injects an isolated transport function (used for automated testing without live network mutation).
   */
  public static setTransport(transport: PublicNewsTransport | null): void {
    customPublicTransport = transport;
  }

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
   * Connects via callable Firebase function getPublicNews.
   * Strictly enforces that only server-returned, sanitized, Published articles are returned.
   */
  public static async listPublishedNews(options: PublicNewsFilterOptions = {}): Promise<News[]> {
    let dtos: SanitizedPublicNewsDTO[] = [];

    if (customPublicTransport) {
      const res = await customPublicTransport({ lang: options.language || 'ar' });
      dtos = res.articles || [];
    } else {
      if (!isFirebaseConfigured || !app) {
        throw new Error('BACKEND_UNAVAILABLE: Firebase backend is not configured.');
      }
      try {
        const fns = getFunctions(app);
        const callable = httpsCallable<{ lang?: 'ar' | 'en' }, { articles: SanitizedPublicNewsDTO[] }>(fns, 'getPublicNews');
        const res = await callable({ lang: options.language || 'ar' });
        dtos = res.data?.articles || [];
      } catch (err) {
        console.error('Failed to fetch public news from server:', err);
        throw new Error('BACKEND_UNAVAILABLE: Failed to retrieve public news from server.');
      }
    }

    // Convert server DTO to canonical News model
    let canonicalItems: News[] = dtos.map(publicDtoToCanonicalNews);

    // Language availability filter:
    if (options.language) {
      canonicalItems = canonicalItems.filter(item => {
        if (options.language === 'en') {
          return Boolean(item.titleEn || item.titleAr);
        }
        return Boolean(item.titleAr);
      });
    }

    // Category filter
    if (options.category && options.category !== 'all') {
      const normalizedReqCat = normalizeCategory(options.category);
      canonicalItems = canonicalItems.filter(item => item.category === normalizedReqCat);
    }

    // Search query filter
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

    // Sort by publication date (descending by default)
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
      const matchesId = item.id === idOrSlug;
      const slugAr = this.getSlug(item.titleAr);
      const slugEn = item.titleEn ? this.getSlug(item.titleEn) : '';
      return matchesId || slugAr === idOrSlug || slugEn === idOrSlug;
    });
    return match || null;
  }
}
