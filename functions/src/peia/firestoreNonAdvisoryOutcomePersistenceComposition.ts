import {
  persistNonAdvisoryOutcome,
  NonAdvisoryOutcomePersistenceResult,
} from './nonAdvisoryOutcomePersistenceBoundary';
import { AuthorizedNonAdvisoryOutcomeIntake } from './authorizedNonAdvisoryOutcomeIntakeBoundary';
import { reconcileNonAdvisoryOutcomeTask } from './nonAdvisoryOutcomeTaskReconciliationBoundary';
import {
  FirestoreNonAdvisoryOutcomeRepository,
  PEIA_PENDING_TASK_COLLECTION,
} from './firestoreNonAdvisoryOutcomeRepository';

export type FirestoreNonAdvisoryOutcomePersistenceHandler = (
  authorizedIntake: AuthorizedNonAdvisoryOutcomeIntake
) => Promise<NonAdvisoryOutcomePersistenceResult>;

export interface NonAdvisoryFirestoreQueryDatabase {
  collection(name: string): {
    where(field: string, op: string, value: unknown): {
      limit(count: number): {
        get(): Promise<{ docs: Array<{ data(): unknown }> }>;
      };
    };
  };
}

export function createFirestoreNonAdvisoryOutcomePersistenceRuntime(
  queryDb: NonAdvisoryFirestoreQueryDatabase,
  repository: FirestoreNonAdvisoryOutcomeRepository
): FirestoreNonAdvisoryOutcomePersistenceHandler {
  return async (authorizedIntake: AuthorizedNonAdvisoryOutcomeIntake) => {
    const taskId = authorizedIntake.request.outcome.taskId;

    const taskSource = {
      fetchTaskById: async (id: string) => {
        const snap = await queryDb
          .collection(PEIA_PENDING_TASK_COLLECTION)
          .where('taskId', '==', id)
          .limit(2)
          .get();

        if (snap.docs.length === 0) {
          return null;
        }
        if (snap.docs.length > 1) {
          throw new Error('TASK_QUERY_CARDINALITY_INVALID: Multiple tasks matched query.');
        }

        return snap.docs[0].data();
      },
    };

    const authoritativeTask = await reconcileNonAdvisoryOutcomeTask(authorizedIntake, taskSource);

    return persistNonAdvisoryOutcome(
      taskId,
      authoritativeTask,
      authorizedIntake.principal,
      authorizedIntake.request.outcome,
      repository
    );
  };
}

export function createProductionNonAdvisoryOutcomePersistenceRuntime(): FirestoreNonAdvisoryOutcomePersistenceHandler {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getFirestore } = require('firebase-admin/firestore');
  const db = getFirestore();

  const queryDb: NonAdvisoryFirestoreQueryDatabase = {
    collection: (name: string) => db.collection(name) as any,
  };

  const transactionDb: any = db;

  const repository = new FirestoreNonAdvisoryOutcomeRepository(transactionDb);

  return createFirestoreNonAdvisoryOutcomePersistenceRuntime(queryDb, repository);
}
