import {
  FirestoreMachineCredentialBindingRepository,
  type FirestoreReadDatabase as MachineCredentialFirestoreReadDatabase,
} from './firestoreMachineCredentialRepository';
import { OpaqueMachineIdentityVerifier } from './machineCredentialVerifier';
import {
  FirestorePendingTaskSource,
  type FirestoreReadDatabase as PendingTaskFirestoreReadDatabase,
} from './firestorePendingTaskSource';
import {
  executePendingTaskGatewayRequest,
  type PendingTaskGatewaySuccess,
} from './taskGatewayOrchestrator';

/**
 * Transport-neutral dependencies for the Firestore-backed task gateway.
 * Requires two separate narrow database interfaces for credential and task storage.
 */
export interface FirestoreTaskGatewayDependencies {
  readonly credentialDb: MachineCredentialFirestoreReadDatabase;
  readonly taskDb: PendingTaskFirestoreReadDatabase;
}

/**
 * Standard gateway handler type that takes an unknown input and returns a success response.
 * Errors propagate according to the specific protocol/boundary definitions.
 */
export type FirestoreTaskGatewayHandler =
  (input: unknown) => Promise<PendingTaskGatewaySuccess>;

/**
 * Factory that composes the Firestore implementations into a single gateway handler.
 * Wire-up logic is performed ONCE at factory call time.
 */
export function createFirestoreTaskGateway(
  dependencies: FirestoreTaskGatewayDependencies
): FirestoreTaskGatewayHandler {
  // A. Create the repository once
  const repository = new FirestoreMachineCredentialBindingRepository(dependencies.credentialDb);

  // B. Create the identity verifier once
  const verifier = new OpaqueMachineIdentityVerifier(repository);

  // C. Create the task source once
  const source = new FirestorePendingTaskSource(dependencies.taskDb);

  /**
   * D. Return the reusable async handler.
   * This handler delegates orchestration to the pure transport-neutral executor.
   */
  return async (input: unknown) => {
    return executePendingTaskGatewayRequest(
      input,
      verifier,
      source
    );
  };
}
