import { getFirestore } from 'firebase-admin/firestore';
import type { LibraryRepository } from './libraryRepository';
import type { LibraryDocument } from '../shared/libraryContract';
import { LibraryValidator } from './libraryValidator';

export class FirestoreLibraryRepository implements LibraryRepository {
  public static readonly COLLECTION = 'library_documents' as const;

  private get db() {
    return getFirestore();
  }

  async getById(id: string): Promise<LibraryDocument | null> {
    const docSnap = await this.db.collection(FirestoreLibraryRepository.COLLECTION).doc(id).get();
    if (!docSnap.exists) return null;
    const data = docSnap.data();
    if (!data) return null;
    return this.deserializeDocument(data, id);
  }

  async create(doc: LibraryDocument): Promise<LibraryDocument> {
    const docRef = this.db.collection(FirestoreLibraryRepository.COLLECTION).doc(doc.id);
    const cleanDoc = this.serializeDocument(doc);

    await this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(docRef);
      if (snapshot.exists) {
        throw new Error(`DUPLICATE_DOCUMENT: Document with ID ${doc.id} already exists`);
      }
      transaction.set(docRef, cleanDoc);
    });

    return doc;
  }

  async update(doc: LibraryDocument): Promise<LibraryDocument> {
    const docRef = this.db.collection(FirestoreLibraryRepository.COLLECTION).doc(doc.id);
    const cleanDoc = this.serializeDocument(doc);

    await this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(docRef);
      if (!snapshot.exists) {
        throw new Error(`NOT_FOUND: Document with ID ${doc.id} not found`);
      }
      transaction.set(docRef, cleanDoc);
    });

    return doc;
  }

  async listAll(): Promise<LibraryDocument[]> {
    const snapshot = await this.db.collection(FirestoreLibraryRepository.COLLECTION).get();
    return snapshot.docs.map(doc => this.deserializeDocument(doc.data(), doc.id));
  }

  private serializeDocument(doc: LibraryDocument): Record<string, any> {
    // Remove any undefined fields safely
    return JSON.parse(JSON.stringify(doc));
  }

  private deserializeDocument(data: any, expectedId: string): LibraryDocument {
    return LibraryValidator.validatePersistedDocument(data, expectedId);
  }
}
