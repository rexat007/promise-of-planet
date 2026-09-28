import { getFirestore } from 'firebase-admin/firestore';
import {
  createFirestoreTaskGateway,
  type FirestoreTaskGatewayHandler,
} from './firestoreTaskGatewayComposition';
import { type FirestoreReadDatabase as MachineCredentialFirestoreReadDatabase } from './firestoreMachineCredentialRepository';
import { type FirestoreReadDatabase as PendingTaskFirestoreReadDatabase } from './firestorePendingTaskSource';

/**
 * Internal dependencies for the runtime binding, enabling testability.
 */
export interface FirebaseTaskGatewayRuntimeDependencies {
  readonly getFirestore: () => unknown;
  readonly createGateway: typeof createFirestoreTaskGateway;
}

/**
 * Pure factory that composes the Firebase runtime using injected dependencies.
 * Wire-up logic ensures that both credential and task databases point to the same Firestore instance.
 *
 * Requirements:
 * - getFirestore() called exactly once
 * - createGateway() called exactly once
 * - Same Firestore instance supplied to both credentialDb and taskDb
 * - Returns the resulting handler unchanged
 */
export function createFirebaseTaskGatewayRuntimeWithDependencies(
  deps: FirebaseTaskGatewayRuntimeDependencies
): FirestoreTaskGatewayHandler {
  // A. Obtain the Firestore instance exactly once
  const firestore = deps.getFirestore();

  // B. Compose the gateway using the same instance for both narrow interfaces
  // Explicit structural assertions bridge the SDK types to the accepted narrow boundaries.
  return deps.createGateway({
    credentialDb: firestore as MachineCredentialFirestoreReadDatabase,
    taskDb: firestore as PendingTaskFirestoreReadDatabase,
  });
}

/**
 * Production convenience factory using the real Firebase Admin SDK and local composition.
 * This unit is runtime binding only and does not initialize the app or expose HTTP.
 */
export function createFirebaseTaskGatewayRuntime(): FirestoreTaskGatewayHandler {
  return createFirebaseTaskGatewayRuntimeWithDependencies({
    getFirestore,
    createGateway: createFirestoreTaskGateway,
  });
}
