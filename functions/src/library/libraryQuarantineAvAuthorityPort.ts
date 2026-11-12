import type {
  WorkerClaimAvExecutionResult,
  WorkerRecordAvScanOutcomeInput,
  WorkerRecordAvScanOutcomeResult,
} from './libraryQuarantineAvExecutionService';

export type {
  WorkerClaimAvExecutionResult,
  WorkerRecordAvScanOutcomeInput,
  WorkerRecordAvScanOutcomeResult,
};

/**
 * Pure authority port boundary for isolated AV worker claim and terminal scan
 * outcome recording.
 *
 * Architectural boundary:
 * - Zero runtime dependencies, zero SDK imports, and zero network/transport logic.
 * - Matches the canonical worker-facing transactional methods on
 *   FirestoreLibraryQuarantineAvExecutionStore.
 * - Does not grant or imply direct Cloud Run worker Firestore authority.
 */
export interface LibraryQuarantineAvAuthorityPort {
  claimAvExecutionForWorkerTransactional(params: {
    readonly requestId: string;
    readonly workerRunId: string;
    readonly nowIso: string;
  }): Promise<WorkerClaimAvExecutionResult>;

  recordWorkerAvScanOutcomeTransactional(
    input: WorkerRecordAvScanOutcomeInput
  ): Promise<WorkerRecordAvScanOutcomeResult>;
}
