import type { LibraryRepository } from './libraryRepository';
import type { LibraryDocument } from '../shared/libraryContract';
import { LibraryValidator } from './libraryValidator';

export class InMemoryLibraryRepository implements LibraryRepository {
  private documents: Map<string, LibraryDocument> = new Map();

  async getById(id: string): Promise<LibraryDocument | null> {
    const doc = this.documents.get(id);
    if (!doc) return null;
    
    // Simulate validation like Firestore
    const validated = LibraryValidator.validateDocument(JSON.parse(JSON.stringify(doc)));
    if (validated.id !== id) throw new Error(`VALIDATION_ERROR: ID mismatch: ${validated.id} !== ${id}`);
    return validated;
  }

  async create(doc: LibraryDocument): Promise<LibraryDocument> {
    if (this.documents.has(doc.id)) {
      throw new Error(`DUPLICATE_DOCUMENT: Document with ID ${doc.id} already exists`);
    }
    const validated = LibraryValidator.validateDocument(JSON.parse(JSON.stringify(doc)));
    this.documents.set(validated.id, validated);
    return validated;
  }

  async update(doc: LibraryDocument): Promise<LibraryDocument> {
    if (!this.documents.has(doc.id)) {
      throw new Error(`NOT_FOUND: Document with ID ${doc.id} not found`);
    }
    const validated = LibraryValidator.validateDocument(JSON.parse(JSON.stringify(doc)));
    this.documents.set(validated.id, validated);
    return validated;
  }

  async listAll(): Promise<LibraryDocument[]> {
    return Array.from(this.documents.values()).map(doc => LibraryValidator.validateDocument(JSON.parse(JSON.stringify(doc))));
  }
}
