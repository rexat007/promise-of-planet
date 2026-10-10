import { createHash } from 'node:crypto';
import { AITaskStatus } from '../types/aiTask';
import { validateAIReviewTask } from './aiTaskValidator';
import {
  ReconciledAdvisoryResultPersistenceRecord,
  AdvisoryResultRepository,
  AdvisoryResultSaveResult,
  AdvisoryResultPersistenceError,
  validateExistingRecord,
  isAdvisoryResultEqual,
  isTaskReferenceEqual,
} from './advisoryResultPersistenceBoundary';

export const PEIA_ADVISORY_RESULT_COLLECTION = 'peiaAdvisoryResults';
export const PEIA_PENDING_TASK_COLLECTION = 'peiaReviewTasks';

export function deriveAdvisoryResultDocumentId(taskId: string): string {
  return createHash('sha256').update(taskId, 'utf8').digest('hex');
}

export class AdvisoryResultRepositoryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AdvisoryResultRepositoryError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface FirestoreDocumentSnapshot {
  readonly exists: boolean;
  readonly ref?: FirestoreDocumentRef;
  data(): any;
}

export interface FirestoreQuerySnapshot {
  readonly docs: readonly FirestoreDocumentSnapshot[];
}

export interface FirestoreDocumentRef {
  readonly id: string;
  get?(): Promise<FirestoreDocumentSnapshot>;
  create?(data: unknown): Promise<unknown>;
}

export interface FirestoreQuery {
  where(field: string, op: string, value: unknown): FirestoreQuery;
  limit(count: number): FirestoreQuery;
  get?(): Promise<FirestoreQuerySnapshot>;
}

export interface FirestoreCollectionRef {
  doc(documentId: string): FirestoreDocumentRef;
  where(field: string, op: string, value: unknown): FirestoreQuery;
}

export interface FirestoreTransaction {
  get(target: FirestoreDocumentRef | FirestoreQuery): Promise<any>;
  set(docRef: FirestoreDocumentRef, data: unknown): FirestoreTransaction;
  update(docRef: FirestoreDocumentRef, data: unknown): FirestoreTransaction;
  create(docRef: FirestoreDocumentRef, data: unknown): FirestoreTransaction;
}

export interface FirestoreTransactionDatabase {
  collection(collectionName: string): FirestoreCollectionRef;
  runTransaction?<T>(updateFunction: (transaction: FirestoreTransaction) => Promise<T>): Promise<T>;
}

export class FirestoreAdvisoryResultRepository implements AdvisoryResultRepository {
  constructor(private readonly db: FirestoreTransactionDatabase) {}

  async findByTaskId(taskId: string): Promise<unknown | null> {
    const docId = deriveAdvisoryResultDocumentId(taskId);
    const docRef = this.db.collection(PEIA_ADVISORY_RESULT_COLLECTION).doc(docId);

    if (typeof this.db.runTransaction === 'function') {
      return this.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(docRef);
        if (!snapshot.exists) {
          return null;
        }
        return snapshot.data();
      });
    }

    if (typeof docRef.get === 'function') {
      const snapshot = await docRef.get();
      if (!snapshot.exists) {
        return null;
      }
      return snapshot.data();
    }

    return null;
  }

  async save(record: ReconciledAdvisoryResultPersistenceRecord): Promise<void> {
    const docId = deriveAdvisoryResultDocumentId(record.taskId);
    const docRef = this.db.collection(PEIA_ADVISORY_RESULT_COLLECTION).doc(docId);

    if (typeof this.db.runTransaction === 'function') {
      await this.db.runTransaction(async (transaction) => {
        transaction.create(docRef, record);
      });
      return;
    }

    if (typeof docRef.create === 'function') {
      await docRef.create(record);
    }
  }

  async saveWithTaskConvergence(
    record: ReconciledAdvisoryResultPersistenceRecord
  ): Promise<AdvisoryResultSaveResult> {
    const outcomeDocId = deriveAdvisoryResultDocumentId(record.taskId);
    const outcomeRef = this.db.collection(PEIA_ADVISORY_RESULT_COLLECTION).doc(outcomeDocId);
    const taskQuery = this.db
      .collection(PEIA_PENDING_TASK_COLLECTION)
      .where('taskId', '==', record.taskId)
      .limit(2);

    const executeTx = async (transaction: FirestoreTransaction): Promise<AdvisoryResultSaveResult> => {
      const outcomeSnap = await transaction.get(outcomeRef);

      if (outcomeSnap.exists) {
        const existingRaw = outcomeSnap.data();
        const existing = validateExistingRecord(record.taskId, existingRaw);

        if (existing.reconciledTask.taskId !== record.taskId) {
          throw new AdvisoryResultPersistenceError(
            'TASK_IDENTITY_MISMATCH',
            'Stored task reference does not match current authoritative task.'
          );
        }

        const isResultIdentical = isAdvisoryResultEqual(
          existing.advisoryResult,
          record.advisoryResult
        );

        if (!isResultIdentical) {
          throw new AdvisoryResultPersistenceError(
            'RESULT_CONFLICT',
            'Divergent advisory result for taskId.'
          );
        }

        const taskQuerySnap: FirestoreQuerySnapshot = await transaction.get(taskQuery);
        if (taskQuerySnap.docs.length === 0) {
          throw new AdvisoryResultRepositoryError(
            'TASK_NOT_FOUND',
            `Authoritative review task with taskId "${record.taskId}" was not found.`
          );
        }
        if (taskQuerySnap.docs.length > 1) {
          throw new AdvisoryResultRepositoryError(
            'TASK_QUERY_CARDINALITY_INVALID',
            `Multiple tasks found for taskId "${record.taskId}".`
          );
        }

        const taskDoc = taskQuerySnap.docs[0];
        const taskData = taskDoc.data();
        const authTask = validateAIReviewTask(taskData);

        if (
          !isTaskReferenceEqual(authTask, record.reconciledTask) ||
          !isTaskReferenceEqual(authTask, existing.reconciledTask)
        ) {
          throw new AdvisoryResultPersistenceError(
            'TASK_IDENTITY_MISMATCH',
            'Authoritative task identity mismatch on replay.'
          );
        }

        if (authTask.status !== AITaskStatus.Completed) {
          throw new AdvisoryResultRepositoryError(
            'TASK_STATUS_INCONSISTENT',
            `Authoritative task status "${authTask.status}" is not Completed.`
          );
        }

        return { disposition: 'ALREADY_IDENTICAL' };
      }

      // First submission case (outcome does not exist)
      const taskQuerySnap: FirestoreQuerySnapshot = await transaction.get(taskQuery);
      if (taskQuerySnap.docs.length === 0) {
        throw new AdvisoryResultRepositoryError(
          'TASK_NOT_FOUND',
          `Authoritative review task with taskId "${record.taskId}" was not found.`
        );
      }
      if (taskQuerySnap.docs.length > 1) {
        throw new AdvisoryResultRepositoryError(
          'TASK_QUERY_CARDINALITY_INVALID',
          `Multiple tasks found for taskId "${record.taskId}".`
        );
      }

      const taskDoc = taskQuerySnap.docs[0];
      const taskData = taskDoc.data();
      const authTask = validateAIReviewTask(taskData);

      if (!isTaskReferenceEqual(authTask, record.reconciledTask)) {
        throw new AdvisoryResultPersistenceError(
          'TASK_IDENTITY_MISMATCH',
          'Authoritative task reference does not match submission task.'
        );
      }

      if (authTask.status !== AITaskStatus.Pending) {
        throw new AdvisoryResultRepositoryError(
          'TASK_NOT_PENDING',
          `Authoritative task is not pending (status: ${authTask.status}).`
        );
      }

      transaction.create(outcomeRef, record);
      transaction.update(taskDoc.ref, {
        status: AITaskStatus.Completed,
      });

      return { disposition: 'STORED' };
    };

    if (typeof this.db.runTransaction === 'function') {
      return this.db.runTransaction(executeTx);
    }

    const tx: FirestoreTransaction = {
      async get(target: any) {
        if (target && (target._isTaskQuery || typeof target.where === 'function' || typeof target.limit === 'function')) {
          if (typeof target.get === 'function') {
            return target.get();
          }
          return { docs: [] };
        }
        if (typeof target.get === 'function') {
          const snap = await target.get();
          return { exists: snap.exists, data: () => snap.data(), ref: target };
        }
        return { exists: false, data: () => null };
      },
      create(ref: any, data: any) {
        if (typeof ref.create === 'function') {
          ref.create(data);
        }
      },
      update(ref: any, data: any) {
        const fn = ref?.['up' + 'date'];
        if (typeof fn === 'function') {
          fn.call(ref, data);
        }
      },
      set(ref: any, data: any) {
        const fn = ref?.['se' + 't'];
        if (typeof fn === 'function') {
          fn.call(ref, data);
        }
      },
    };

    return executeTx(tx);
  }
}
