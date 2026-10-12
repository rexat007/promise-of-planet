import type { LibraryRepository } from './libraryRepository';
import type { LibraryDocument } from '../../../src/types/library';

export class InMemoryLibraryRepository implements LibraryRepository {
  private documents: Map<string, LibraryDocument> = new Map();

  constructor(initialDocs: LibraryDocument[] = []) {
    for (const d of initialDocs) {
      this.documents.set(d.id, JSON.parse(JSON.stringify(d)));
    }
  }

  async getById(id: string): Promise<LibraryDocument | null> {
    const doc = this.documents.get(id);
    return doc ? JSON.parse(JSON.stringify(doc)) : null;
  }

  async create(doc: LibraryDocument): Promise<LibraryDocument> {
    if (this.documents.has(doc.id)) {
      throw new Error(`DUPLICATE_DOCUMENT: Document with ID ${doc.id} already exists`);
    }
    const cloned = JSON.parse(JSON.stringify(doc));
    this.documents.set(doc.id, cloned);
    return JSON.parse(JSON.stringify(cloned));
  }

  async update(doc: LibraryDocument): Promise<LibraryDocument> {
    if (!this.documents.has(doc.id)) {
      throw new Error(`NOT_FOUND: Document with ID ${doc.id} not found`);
    }
    const cloned = JSON.parse(JSON.stringify(doc));
    this.documents.set(doc.id, cloned);
    return JSON.parse(JSON.stringify(cloned));
  }

  async listAll(): Promise<LibraryDocument[]> {
    return Array.from(this.documents.values()).map(d => JSON.parse(JSON.stringify(d)));
  }
}
