import { createHash } from 'node:crypto';
import { AITaskStatus } from '../types/aiTask';
import { validateAIReviewTask } from './aiTaskValidator';
import {
  ReconciledNonAdvisoryOutcomePersistenceRecord,
  NonAdvisoryOutcomeRepository,
  NonAdvisoryOutcomeSaveResult,
  NonAdvisoryOutcomePersistenceError,
  validateExistingRecord,
  isOutcomeEqual,
  computeConvergedTaskStatus,
} from './nonAdvisoryOutcomePersistenceBoundary';

export const PEIA_NON_ADVISORY_OUTCOME_COLLECTION = 'peiaNonAdvisoryOutcomes';
export const PEIA_PENDING_TASK_COLLECTION = 'peiaReviewTasks';

export function deriveNonAdvisoryOutcomeDocumentId(taskId: string): string {
  return createHash('sha256').update(taskId, 'utf8').digest('hex');
}

export class NonAdvisoryOutcomeRepositoryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'NonAdvisoryOutcomeRepositoryError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface FirestoreDocumentSnapshot {
  readonly exists: boolean;
  readonly ref: FirestoreDocumentRef;
  data(): any;
}

export interface FirestoreQuerySnapshot {
  readonly docs: readonly FirestoreDocumentSnapshot[];
}

export interface FirestoreDocumentRef {
  readonly id: string;
}

export interface FirestoreQuery {
  where(field: string, op: string, value: unknown): FirestoreQuery;
  limit(count: number): FirestoreQuery;
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
  runTransaction<T>(updateFunction: (transaction: FirestoreTransaction) => Promise<T>): Promise<T>;
}

export class FirestoreNonAdvisoryOutcomeRepository implements NonAdvisoryOutcomeRepository {
  constructor(private readonly db: FirestoreTransactionDatabase) {}

  async findByTaskId(taskId: string): Promise<unknown | null> {
    const docId = deriveNonAdvisoryOutcomeDocumentId(taskId);
    const docRef = this.db.collection(PEIA_NON_ADVISORY_OUTCOME_COLLECTION).doc(docId);

    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(docRef);
      if (!snapshot.exists) {
        return null;
      }
      return snapshot.data();
    });
  }

  async saveWithTaskConvergence(
    record: ReconciledNonAdvisoryOutcomePersistenceRecord
  ): Promise<NonAdvisoryOutcomeSaveResult> {
    const outcomeDocId = deriveNonAdvisoryOutcomeDocumentId(record.taskId);
    const outcomeRef = this.db.collection(PEIA_NON_ADVISORY_OUTCOME_COLLECTION).doc(outcomeDocId);
    const taskQuery = this.db
      .collection(PEIA_PENDING_TASK_COLLECTION)
      .where('taskId', '==', record.taskId)
      .limit(2);

    return this.db.runTransaction(async (transaction) => {
      const outcomeSnap = await transaction.get(outcomeRef);
      if (outcomeSnap.exists) {
        const existingRaw = outcomeSnap.data();
        const existing = validateExistingRecord(record.taskId, existingRaw);

        if (existing.reconciledTask.taskId !== record.taskId) {
          throw new NonAdvisoryOutcomePersistenceError(
            'TASK_IDENTITY_MISMATCH',
            'Stored task reference does not match current authoritative task.'
          );
        }

        const isOutcomeIdentical = isOutcomeEqual(
          existing.nonAdvisoryOutcome,
          record.nonAdvisoryOutcome
        );

        if (!isOutcomeIdentical) {
          throw new NonAdvisoryOutcomePersistenceError(
            'RESULT_CONFLICT',
            'Divergent outcome for taskId.'
          );
        }

        // Query authoritative task with canonical query
        const taskQuerySnap: FirestoreQuerySnapshot = await transaction.get(taskQuery);
        if (taskQuerySnap.docs.length === 0) {
          throw new NonAdvisoryOutcomeRepositoryError(
            'TASK_NOT_FOUND',
            `Authoritative review task with taskId "${record.taskId}" was not found.`
          );
        }
        if (taskQuerySnap.docs.length > 1) {
          throw new NonAdvisoryOutcomeRepositoryError(
            'TASK_QUERY_CARDINALITY_INVALID',
            `Multiple tasks found for taskId "${record.taskId}".`
          );
        }

        const taskDoc = taskQuerySnap.docs[0];
        const taskData = taskDoc.data();
        const authTask = validateAIReviewTask(taskData);

        if (
          authTask.taskId !== record.taskId ||
          authTask.taskId !== existing.reconciledTask.taskId ||
          authTask.taskId !== record.reconciledTask.taskId ||
          authTask.taskType !== existing.reconciledTask.taskType ||
          authTask.target.targetType !== existing.reconciledTask.target.targetType ||
          authTask.target.targetId !== existing.reconciledTask.target.targetId
        ) {
          throw new NonAdvisoryOutcomePersistenceError(
            'TASK_IDENTITY_MISMATCH',
            'Authoritative task identity mismatch on replay.'
          );
        }

        const expectedTerminalStatus = computeConvergedTaskStatus(existing.nonAdvisoryOutcome.kind);

        if (authTask.status !== expectedTerminalStatus) {
          throw new NonAdvisoryOutcomeRepositoryError(
            'TASK_STATUS_INCONSISTENT',
            `Authoritative task status "${authTask.status}" does not match expected terminal status "${expectedTerminalStatus}".`
          );
        }

        return { disposition: 'ALREADY_IDENTICAL' };
      }

      const taskQuerySnap: FirestoreQuerySnapshot = await transaction.get(taskQuery);
      if (taskQuerySnap.docs.length === 0) {
        throw new NonAdvisoryOutcomeRepositoryError(
          'TASK_NOT_FOUND',
          `Authoritative review task with taskId "${record.taskId}" was not found.`
        );
      }
      if (taskQuerySnap.docs.length > 1) {
        throw new NonAdvisoryOutcomeRepositoryError(
          'TASK_QUERY_CARDINALITY_INVALID',
          `Multiple tasks found for taskId "${record.taskId}".`
        );
      }

      const taskDoc = taskQuerySnap.docs[0];
      const taskData = taskDoc.data();
      const authTask = validateAIReviewTask(taskData);

      if (authTask.taskId !== record.taskId) {
        throw new NonAdvisoryOutcomePersistenceError(
          'TASK_IDENTITY_MISMATCH',
          'Authoritative task taskId does not match submission taskId.'
        );
      }

      if (authTask.status !== AITaskStatus.Pending) {
        throw new NonAdvisoryOutcomeRepositoryError(
          'TASK_NOT_PENDING',
          `Authoritative task is not pending.`
        );
      }

      transaction.create(outcomeRef, record);
      transaction.update(taskDoc.ref, {
        status: record.convergedStatus,
      });

      return { disposition: 'STORED' };
    });
  }
}
