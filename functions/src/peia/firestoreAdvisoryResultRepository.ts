import { createHash } from 'node:crypto';
import {
  AdvisoryResultRepository,
  ReconciledAdvisoryResultPersistenceRecord,
} from './advisoryResultPersistenceBoundary';

/**
 * Deterministic collection name for PEIA advisory results.
 */
export const PEIA_ADVISORY_RESULT_COLLECTION = 'peiaAdvisoryResults';

/**
 * Derives a deterministic Firestore-safe document ID from a canonical taskId.
 * Uses SHA-256 hex digest to ensure no slashes or unsafe path characters are present
 * in the document ID while maintaining a 1:1 stable mapping.
 */
export function deriveAdvisoryResultDocumentId(taskId: string): string {
  return createHash('sha256').update(taskId, 'utf8').digest('hex');
}

/**
 * Minimal Firestore interfaces to avoid direct dependency on the SDK in the logic,
 * facilitating testing with mocks.
 */
export interface FirestoreDocumentSnapshot {
  readonly exists: boolean;
  data(): unknown;
}

export interface FirestoreDocument {
  get(): Promise<FirestoreDocumentSnapshot>;
  create(data: unknown): Promise<unknown>;
}

export interface FirestoreCollection {
  doc(documentId: string): FirestoreDocument;
}

export interface FirestoreDatabase {
  collection(collectionName: string): FirestoreCollection;
}

/**
 * Firestore-backed implementation of the AdvisoryResultRepository.
 * 
 * Provides:
 * - findByTaskId(taskId): Reads from the deterministic hashed document path.
 * - save(record): Uses create() to ensure concurrent write safety (fails if exists).
 */
export class FirestoreAdvisoryResultRepository implements AdvisoryResultRepository {
  constructor(private readonly db: FirestoreDatabase) {}

  /**
   * Reads the record for a given taskId.
   * Document ID is derived via SHA-256 from the taskId.
   */
  async findByTaskId(taskId: string): Promise<unknown | null> {
    const docId = deriveAdvisoryResultDocumentId(taskId);
    const snapshot = await this.db
      .collection(PEIA_ADVISORY_RESULT_COLLECTION)
      .doc(docId)
      .get();

    if (!snapshot.exists) {
      return null;
    }

    return snapshot.data();
  }

  /**
   * Persists a reconciled advisory result.
   * 
   * Requirement: CONCURRENT WRITE SAFETY.
   * We use .create() which performs an atomic check-and-create.
   * If the document already exists, Firestore returns an error (ALREADY_EXISTS).
   */
  async save(record: ReconciledAdvisoryResultPersistenceRecord): Promise<void> {
    const docId = deriveAdvisoryResultDocumentId(record.taskId);
    
    // Original canonical taskId remains preserved unchanged inside the stored document.
    await this.db
      .collection(PEIA_ADVISORY_RESULT_COLLECTION)
      .doc(docId)
      .create({
        taskId: record.taskId,
        reconciledTask: record.reconciledTask,
        principal: record.principal,
        advisoryResult: record.advisoryResult,
      });
  }
}
