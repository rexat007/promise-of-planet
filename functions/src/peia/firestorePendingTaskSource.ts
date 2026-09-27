import { AITaskStatus } from '../types/aiTask';
import { type PendingTaskSource } from './pendingTaskSourceBoundary';

export const PEIA_PENDING_TASK_COLLECTION = 'peiaReviewTasks';

export interface FirestoreDocumentSnapshot {
  data(): unknown;
}

export interface FirestoreQuerySnapshot {
  readonly docs: readonly FirestoreDocumentSnapshot[];
}

export interface FirestoreQuery {
  where(field: string, op: string, value: unknown): FirestoreQuery;
  orderBy(field: string, direction: 'asc' | 'desc'): FirestoreQuery;
  limit(count: number): FirestoreQuery;
  get(): Promise<FirestoreQuerySnapshot>;
}

export interface FirestoreReadDatabase {
  collection(name: string): FirestoreQuery;
}

export class FirestorePendingTaskSourceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'FirestorePendingTaskSourceError';
    this.code = code;
  }
}

/**
 * Read-only Firestore adapter for retrieving pending tasks.
 * Strictly decoupled from Firebase Admin runtime and write operations.
 */
export class FirestorePendingTaskSource implements PendingTaskSource {
  constructor(private readonly db: FirestoreReadDatabase) {}

  /**
   * Fetches exactly one pending task from the canonical collection.
   * Enforces oldest-first delivery with deterministic tie-breaking.
   */
  async fetchNextPendingTask(): Promise<unknown | null> {
    const snapshot = await this.db
      .collection(PEIA_PENDING_TASK_COLLECTION)
      .where('status', '==', AITaskStatus.Pending)
      .orderBy('createdAt', 'asc')
      .orderBy('taskId', 'asc')
      .limit(1)
      .get();

    if (snapshot.docs.length === 0) {
      return null;
    }

    if (snapshot.docs.length > 1) {
      throw new FirestorePendingTaskSourceError(
        'PENDING_TASK_QUERY_CARDINALITY_INVALID',
        'Firestore adapter received unexpected multiple documents for a limit(1) query.'
      );
    }

    const doc = snapshot.docs[0];
    const data = doc.data();

    if (data === undefined || data === null) {
      throw new FirestorePendingTaskSourceError(
        'PENDING_TASK_RECORD_MISSING_DATA',
        'Firestore document exists but contains null or undefined data.'
      );
    }

    return data;
  }
}
