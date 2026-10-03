import { getFirestore } from 'firebase-admin/firestore';
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
  FirestoreDatabase,
} from './firestoreAdvisoryResultRepository';
import { AdvisoryResultFirestoreReadDatabase } from './firestoreAdvisoryResultTaskSource';

/**
 * Internal runtime handler for persisting advisory results.
 * This orchestrates the full flow from authorized intake to storage.
 */
export type FirestoreAdvisoryResultPersistenceHandler = (
  authorizedIntake: AuthorizedAdvisoryResultIntake
) => Promise<AdvisoryResultPersistenceResult>;

/**
 * Dependency-injected core composition that wires reconciliation and persistence.
 * Ensures the boundary logic is orchestrated without being duplicated.
 */
export function createFirestoreAdvisoryResultPersistenceRuntime(
  reconciliationHandler: FirestoreAdvisoryResultReconciliationHandler,
  repository: AdvisoryResultRepository
): FirestoreAdvisoryResultPersistenceHandler {
  return async (authorizedIntake: AuthorizedAdvisoryResultIntake) => {
    // 1. Reconcile the authorized intake against the authoritative task source
    const reconciled = await reconciliationHandler(authorizedIntake);

    // 2. Persist the reconciled result through the persistence boundary
    // Concurrency: storage errors (e.g. ALREADY_EXISTS) propagate unchanged.
    return persistReconciledAdvisoryResult(reconciled, repository);
  };
}

/**
 * Production runtime factory that binds real Firestore dependencies.
 * Retrieves the active Firebase Admin Firestore instance.
 */
export function createProductionAdvisoryResultPersistenceRuntime(): FirestoreAdvisoryResultPersistenceHandler {
  const db = getFirestore();
  
  // Bind the real Firestore instance to the minimal interfaces via object wrappers
  // to satisfy the boundary contracts without unsafe casts.
  const readDb: AdvisoryResultFirestoreReadDatabase = {
    collection: (name: string) => db.collection(name),
  };

  const writeDb: FirestoreDatabase = {
    collection: (name: string) => db.collection(name),
  };

  const reconciliationHandler = createFirestoreAdvisoryResultReconciliationRuntime(readDb);
  const repository = new FirestoreAdvisoryResultRepository(writeDb);

  return createFirestoreAdvisoryResultPersistenceRuntime(reconciliationHandler, repository);
}
