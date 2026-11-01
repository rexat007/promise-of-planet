import * as crypto from 'crypto';
import { getFirestore } from 'firebase-admin/firestore';
import type { LibraryRepository } from './libraryRepository';
import type { 
  LibraryDocument, 
  LibraryOrganization, 
  LibrarySource,
  LibraryIntakeRecord,
  LibraryIntakeAISuggestion
} from '../shared/libraryContract';
import { LibraryValidator } from './libraryValidator';

export class FirestoreLibraryRepository implements LibraryRepository {
  public static readonly COLLECTION = 'library_documents' as const;
  public static readonly ORGANIZATIONS_COLLECTION = 'library_organizations' as const;
  public static readonly SOURCES_COLLECTION = 'library_sources' as const;
  public static readonly INTAKE_COLLECTION = 'library_intake' as const;
  public static readonly INTAKE_URLS_COLLECTION = 'library_intake_urls' as const;

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

  // --- Intake Inbox Persistence ---

  async getIntakeById(id: string): Promise<LibraryIntakeRecord | null> {
    if (!id || typeof id !== 'string') return null;
    const docSnap = await this.db.collection(FirestoreLibraryRepository.INTAKE_COLLECTION).doc(id.trim()).get();
    if (!docSnap.exists) return null;
    const data = docSnap.data();
    if (!data) return null;
    return { ...data, id: docSnap.id } as LibraryIntakeRecord;
  }

  async listIntake(): Promise<LibraryIntakeRecord[]> {
    const snapshot = await this.db.collection(FirestoreLibraryRepository.INTAKE_COLLECTION).get();
    const records = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as LibraryIntakeRecord));
    return records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async createIntake(record: LibraryIntakeRecord): Promise<LibraryIntakeRecord> {
    const docRef = this.db.collection(FirestoreLibraryRepository.INTAKE_COLLECTION).doc(record.id);
    const urlHash = crypto.createHash('sha256').update(record.normalizedUrl.trim().toLowerCase()).digest('hex');
    const urlRef = this.db.collection(FirestoreLibraryRepository.INTAKE_URLS_COLLECTION).doc(urlHash);
    const cleanRecord = JSON.parse(JSON.stringify(record));

    await this.db.runTransaction(async transaction => {
      const [docSnap, urlSnap] = await Promise.all([
        transaction.get(docRef),
        transaction.get(urlRef),
      ]);

      if (docSnap.exists) {
        throw new Error(`DUPLICATE_INTAKE: Intake record with ID ${record.id} already exists`);
      }
      if (urlSnap.exists) {
        throw new Error(`DUPLICATE_INTAKE: Reference URL already exists in intake queue: ${record.normalizedUrl}`);
      }

      transaction.set(docRef, cleanRecord);
      transaction.set(urlRef, {
        intakeId: record.id,
        normalizedUrl: record.normalizedUrl,
        createdAt: record.createdAt,
      });
    });

    return record;
  }

  async updateIntake(record: LibraryIntakeRecord): Promise<LibraryIntakeRecord> {
    const docRef = this.db.collection(FirestoreLibraryRepository.INTAKE_COLLECTION).doc(record.id);
    const cleanRecord = JSON.parse(JSON.stringify(record));

    await this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(docRef);
      if (!snapshot.exists) {
        throw new Error(`NOT_FOUND: Intake record with ID ${record.id} not found`);
      }
      transaction.set(docRef, cleanRecord);
    });

    return record;
  }

  async saveIntakeAISuggestion(
    intakeId: string,
    expectedUpdatedAt: string,
    suppliedExcerpt: string | undefined,
    aiSuggestion: LibraryIntakeAISuggestion,
    updatedAt: string
  ): Promise<LibraryIntakeRecord> {
    const docRef = this.db.collection(FirestoreLibraryRepository.INTAKE_COLLECTION).doc(intakeId.trim());
    let committedRecord: LibraryIntakeRecord | null = null;

    await this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(docRef);
      if (!snapshot.exists) {
        throw new Error(`NOT_FOUND: Intake record with ID ${intakeId} not found`);
      }
      const existingData = snapshot.data() as LibraryIntakeRecord | undefined;
      if (!existingData) {
        throw new Error(`NOT_FOUND: Intake record with ID ${intakeId} has empty data`);
      }
      if (existingData.updatedAt !== expectedUpdatedAt) {
        throw new Error(
          `CONFLICT: Intake record ${intakeId} was modified by a newer editorial action while AI preparation was in flight.`
        );
      }

      // Preserve canonical intake fields strictly (url, normalizedUrl, title, organizationId, sourceId, status, reviewNotes, etc.)
      const nextRecord: LibraryIntakeRecord = {
        ...existingData,
        id: snapshot.id,
        ...(suppliedExcerpt !== undefined ? { suppliedExcerpt } : {}),
        aiSuggestion,
        updatedAt,
      };

      const cleanRecord = JSON.parse(JSON.stringify(nextRecord));
      transaction.set(docRef, cleanRecord);
      committedRecord = nextRecord;
    });

    if (!committedRecord) {
      throw new Error(`INTERNAL_ERROR: Transaction failed to return updated intake record ${intakeId}`);
    }
    return committedRecord;
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
