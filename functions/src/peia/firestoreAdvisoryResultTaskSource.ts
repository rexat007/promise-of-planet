import type { AdvisoryResultTaskSource } from './advisoryResultTaskReconciliationBoundary';
import { PEIA_PENDING_TASK_COLLECTION } from './firestorePendingTaskSource';

export interface AdvisoryResultFirestoreDocumentSnapshot {
  data(): unknown;
}

export interface AdvisoryResultFirestoreQuerySnapshot {
  readonly docs: readonly AdvisoryResultFirestoreDocumentSnapshot[];
}

export interface AdvisoryResultFirestoreQuery {
  where(
    field: string,
    op: string,
    value: unknown
  ): AdvisoryResultFirestoreQuery;
  limit(count: number): AdvisoryResultFirestoreQuery;
  get(): Promise<AdvisoryResultFirestoreQuerySnapshot>;
}

export interface AdvisoryResultFirestoreReadDatabase {
  collection(name: string): AdvisoryResultFirestoreQuery;
}

export type FirestoreAdvisoryResultTaskSourceErrorCode =
  | 'ADVISORY_RESULT_TASK_QUERY_CARDINALITY_INVALID'
  | 'ADVISORY_RESULT_TASK_RECORD_MISSING_DATA';

export class FirestoreAdvisoryResultTaskSourceError extends Error {
  readonly code: FirestoreAdvisoryResultTaskSourceErrorCode;

  constructor(
    code: FirestoreAdvisoryResultTaskSourceErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'FirestoreAdvisoryResultTaskSourceError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class FirestoreAdvisoryResultTaskSource
  implements AdvisoryResultTaskSource {
  constructor(private readonly db: AdvisoryResultFirestoreReadDatabase) {}

  async fetchTaskById(taskId: string): Promise<unknown | null> {
    const snapshot = await this.db
      .collection(PEIA_PENDING_TASK_COLLECTION)
      .where('taskId', '==', taskId)
      .limit(2)
      .get();

    if (snapshot.docs.length === 0) {
      return null;
    }

    if (snapshot.docs.length > 1) {
      throw new FirestoreAdvisoryResultTaskSourceError(
        'ADVISORY_RESULT_TASK_QUERY_CARDINALITY_INVALID',
        'Firestore advisory result task lookup returned multiple records for one taskId.'
      );
    }

    const data = snapshot.docs[0].data();

    if (data === null || data === undefined) {
      throw new FirestoreAdvisoryResultTaskSourceError(
        'ADVISORY_RESULT_TASK_RECORD_MISSING_DATA',
        'Firestore advisory result task record exists but contains null or undefined data.'
      );
    }

    return data;
  }
}
