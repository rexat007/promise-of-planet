import type { NewsRepository, NewsItemBackend } from './newsRepository';

export class InMemoryNewsRepository implements NewsRepository {
  private items: Map<string, NewsItemBackend> = new Map();

  constructor(initialItems?: NewsItemBackend[]) {
    if (initialItems) {
      for (const item of initialItems) {
        this.items.set(item.id, { ...item });
      }
    }
  }

  async getById(id: string): Promise<NewsItemBackend | null> {
    const item = this.items.get(id);
    return item ? { ...item } : null;
  }

  async save(item: NewsItemBackend): Promise<void> {
    this.items.set(item.id, { ...item });
  }

  async listAll(): Promise<NewsItemBackend[]> {
    return Array.from(this.items.values()).map(item => ({ ...item }));
  }

  async listPublished(language?: 'ar' | 'en'): Promise<NewsItemBackend[]> {
    return Array.from(this.items.values())
      .filter(item => item.workflowState === 'Published')
      .filter(item => {
        if (language === 'en') {
          return Boolean(item.titleEn || item.bodyEn);
        }
        return Boolean(item.titleAr);
      })
      .map(item => ({ ...item }));
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }

  clear(): void {
    this.items.clear();
  }
}
