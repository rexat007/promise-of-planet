import {
  persistReconciledAdvisoryResult,
  AdvisoryResultPersistenceResult,
  AdvisoryResultRepository,
} from './advisoryResultPersistenceBoundary';
import {
  createFirestoreAdvisoryResultReconciliationRuntime,
  FirestoreAdvisoryResultReconciliationHandler,
} from './firestoreAdvisoryResultReconciliationComposition';
import { AuthorizedAdvisoryResultIntake } from './authorizedAdvisoryResultIntakeBoundary';
import {
  FirestoreAdvisoryResultRepository,
  FirestoreTransactionDatabase,
  FirestoreCollectionRef,
} from './firestoreAdvisoryResultRepository';
import { AdvisoryResultFirestoreReadDatabase } from './firestoreAdvisoryResultTaskSource';

export type FirestoreAdvisoryResultPersistenceHandler = (
  authorizedIntake: AuthorizedAdvisoryResultIntake
) => Promise<AdvisoryResultPersistenceResult>;

export function createFirestoreAdvisoryResultPersistenceRuntime(
  reconciliationHandler: FirestoreAdvisoryResultReconciliationHandler,
  repository: AdvisoryResultRepository
): FirestoreAdvisoryResultPersistenceHandler {
  return async (authorizedIntake: AuthorizedAdvisoryResultIntake) => {
    const reconciled = await reconciliationHandler(authorizedIntake);
    return persistReconciledAdvisoryResult(reconciled, repository);
  };
}

export function createProductionAdvisoryResultPersistenceRuntime(): FirestoreAdvisoryResultPersistenceHandler {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getFirestore } = require('firebase-admin/firestore');
  const db = getFirestore();
  
  const readDb: AdvisoryResultFirestoreReadDatabase = {
    collection: (name: string) => db.collection(name) as any,
  };

  const writeDb: FirestoreTransactionDatabase = {
    collection: (name: string) => db.collection(name) as unknown as FirestoreCollectionRef,
    runTransaction: async <T>(updateFn: (transaction: any) => Promise<T>) => {
      return db.runTransaction(async (transaction: any) => {
        return updateFn(transaction);
      });
    },
  };

  const reconciliationHandler = createFirestoreAdvisoryResultReconciliationRuntime(readDb);
  const repository = new FirestoreAdvisoryResultRepository(writeDb);

  return createFirestoreAdvisoryResultPersistenceRuntime(reconciliationHandler, repository);
}
