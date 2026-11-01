import { getFirestore } from 'firebase-admin/firestore';
import type { LibraryRepository } from './libraryRepository';
import type { LibraryDocument, LibraryOrganization, LibrarySource } from '../shared/libraryContract';
import { LibraryValidator } from './libraryValidator';

export class FirestoreLibraryRepository implements LibraryRepository {
  public static readonly COLLECTION = 'library_documents' as const;
  public static readonly ORGANIZATIONS_COLLECTION = 'library_organizations' as const;
  public static readonly SOURCES_COLLECTION = 'library_sources' as const;

  private get db() {
    return getFirestore();
  }

  // --- Organization Registry Persistence ---

  async getOrganizationById(id: string): Promise<LibraryOrganization | null> {
    if (!id || typeof id !== 'string') return null;
    const docSnap = await this.db.collection(FirestoreLibraryRepository.ORGANIZATIONS_COLLECTION).doc(id.trim()).get();
    if (!docSnap.exists) return null;
    const data = docSnap.data();
    if (!data) return null;
    return { ...data, id: docSnap.id } as LibraryOrganization;
  }

  async listOrganizations(): Promise<LibraryOrganization[]> {
    const snapshot = await this.db.collection(FirestoreLibraryRepository.ORGANIZATIONS_COLLECTION).get();
    return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as LibraryOrganization));
  }

  async createOrganization(org: LibraryOrganization): Promise<LibraryOrganization> {
    const docRef = this.db.collection(FirestoreLibraryRepository.ORGANIZATIONS_COLLECTION).doc(org.id);
    const cleanOrg = JSON.parse(JSON.stringify(org));

    await this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(docRef);
      if (snapshot.exists) {
        throw new Error(`DUPLICATE_ORGANIZATION: Organization with ID ${org.id} already exists`);
      }
      transaction.set(docRef, cleanOrg);
    });

    return org;
  }

  // --- Source Registry Persistence ---

  async getSourceById(id: string): Promise<LibrarySource | null> {
    if (!id || typeof id !== 'string') return null;
    const docSnap = await this.db.collection(FirestoreLibraryRepository.SOURCES_COLLECTION).doc(id.trim()).get();
    if (!docSnap.exists) return null;
    const data = docSnap.data();
    if (!data) return null;
    return { ...data, id: docSnap.id } as LibrarySource;
  }

  async listSources(): Promise<LibrarySource[]> {
    const snapshot = await this.db.collection(FirestoreLibraryRepository.SOURCES_COLLECTION).get();
    return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as LibrarySource));
  }

  async createSource(source: LibrarySource): Promise<LibrarySource> {
    const docRef = this.db.collection(FirestoreLibraryRepository.SOURCES_COLLECTION).doc(source.id);
    const cleanSource = JSON.parse(JSON.stringify(source));

    await this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(docRef);
      if (snapshot.exists) {
        throw new Error(`DUPLICATE_SOURCE: Source with ID ${source.id} already exists`);
      }
      transaction.set(docRef, cleanSource);
    });

    return source;
  }

  async updateSource(source: LibrarySource): Promise<LibrarySource> {
    const docRef = this.db.collection(FirestoreLibraryRepository.SOURCES_COLLECTION).doc(source.id);
    const cleanSource = JSON.parse(JSON.stringify(source));

    await this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(docRef);
      if (!snapshot.exists) {
        throw new Error(`NOT_FOUND: Source with ID ${source.id} not found`);
      }
      transaction.set(docRef, cleanSource);
    });

    return source;
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
