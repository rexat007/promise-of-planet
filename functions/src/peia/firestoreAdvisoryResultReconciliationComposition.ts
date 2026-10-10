import {
  FirestoreAdvisoryResultTaskSource,
  AdvisoryResultFirestoreReadDatabase,
} from './firestoreAdvisoryResultTaskSource';
import {
  reconcileAdvisoryResultTask,
  ReconciledAdvisoryResultIntake,
} from './advisoryResultTaskReconciliationBoundary';
import { AuthorizedAdvisoryResultIntake } from './authorizedAdvisoryResultIntakeBoundary';

/**
 * Reusable async handler that orchestrates the reconciliation process.
 */
export type FirestoreAdvisoryResultReconciliationHandler = (
  authorizedIntake: AuthorizedAdvisoryResultIntake
) => Promise<ReconciledAdvisoryResultIntake>;

/**
 * Pure factory that constructs the Firestore task source and binds it to the reconciliation boundary.
 * Dependency Injection style ensures testability with a fake/mock database.
 */
export function createFirestoreAdvisoryResultReconciliationRuntime(
  db: AdvisoryResultFirestoreReadDatabase
): FirestoreAdvisoryResultReconciliationHandler {
  // A. Instantiate the source exactly once at composition time
  const source = new FirestoreAdvisoryResultTaskSource(db);

  // B. Return the reusable async handler delegating to the pure boundary
  return async (authorizedIntake: AuthorizedAdvisoryResultIntake) => {
    return reconcileAdvisoryResultTask(authorizedIntake, source);
  };
}

/**
 * Production runtime factory that retrieves the active Firebase Admin Firestore instance
 * and composes the transport-neutral reconciliation gateway.
 */
export function createProductionAdvisoryResultReconciliationRuntime(): FirestoreAdvisoryResultReconciliationHandler {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getFirestore } = require('firebase-admin/firestore');
  const db = getFirestore() as unknown as AdvisoryResultFirestoreReadDatabase;
  return createFirestoreAdvisoryResultReconciliationRuntime(db);
}
