import { describe, expect, it } from 'vitest';
import type {
  LibraryQuarantineAvAuthorityPort,
  WorkerClaimAvExecutionResult,
  WorkerRecordAvScanOutcomeInput,
  WorkerRecordAvScanOutcomeResult,
} from './libraryQuarantineAvAuthorityPort';
import type { FirestoreLibraryQuarantineAvExecutionStore } from './libraryQuarantineAvExecutionService';
import type { LibraryQuarantineAvExecutionDocument } from './libraryQuarantineAvExecutionContract';

type AssertAssignable<TActual, TExpected> = TActual extends TExpected ? true : never;
type AssertExactMethodKeys<T> = keyof T extends
  | 'claimAvExecutionForWorkerTransactional'
  | 'recordWorkerAvScanOutcomeTransactional'
  ? 'claimAvExecutionForWorkerTransactional' | 'recordWorkerAvScanOutcomeTransactional' extends keyof T
    ? true
    : never
  : never;

function buildSampleExecutionDoc(
  overrides: Partial<LibraryQuarantineAvExecutionDocument> = {}
): LibraryQuarantineAvExecutionDocument {
  return {
    schemaVersion: '1.0.0',
    requestId: 'req-av-port-001',
    inspectionRequestRevision: 1,
    intakeId: 'intake-av-port-001',
    intakeRevision: 1,
    binarySafetyCaseId: 'safety-av-port-001',
    binarySafetyCaseRevision: 1,
    quarantineBucket: 'pop-quarantine-bucket',
    quarantineObjectPath: 'quarantine/intake-av-port-001/payload.pdf',
    quarantineGcsGeneration: '1700000000000001',
    expectedSha256: 'a'.repeat(64),
    expectedByteSize: 4096,
    confirmedMimeType: 'application/pdf',
    currentState: 'AV_SCAN_RUNNING',
    revision: 2,
    executionAttemptCount: 1,
    latestWorkerRunId: 'worker-run-001',
    cloudRunJobExecutionName: 'projects/pop/locations/me-central2/jobs/av/executions/exec-001',
    dispatchedByUid: 'admin-uid-001',
    dispatchedAt: '2026-11-11T10:00:00.000Z',
    claimedAt: '2026-11-11T10:00:05.000Z',
    completedAt: null,
    engineName: null,
    engineVersion: null,
    signatureVersion: null,
    signatureUpdatedAt: null,
    scannedBytes: null,
    exitCode: null,
    failureReasonCode: null,
    staleReasonCode: null,
    isSanitized: false,
    isVerifiedSafe: false,
    isRightsApproved: false,
    isPublished: false,
    isReadyForPeia: false,
    createdAt: '2026-11-11T09:59:00.000Z',
    updatedAt: '2026-11-11T10:00:05.000Z',
    ...overrides,
  };
}

class InMemoryFakeAvAuthorityPort implements LibraryQuarantineAvAuthorityPort {
  public readonly claimCalls: Array<{
    readonly requestId: string;
    readonly workerRunId: string;
    readonly nowIso: string;
  }> = [];

  public readonly recordCalls: WorkerRecordAvScanOutcomeInput[] = [];

  private nextClaimResult: WorkerClaimAvExecutionResult;
  private nextRecordResult: WorkerRecordAvScanOutcomeResult;

  public constructor(params: {
    readonly initialClaimResult: WorkerClaimAvExecutionResult;
    readonly initialRecordResult: WorkerRecordAvScanOutcomeResult;
  }) {
    this.nextClaimResult = params.initialClaimResult;
    this.nextRecordResult = params.initialRecordResult;
  }

  public setNextClaimResult(result: WorkerClaimAvExecutionResult): void {
    this.nextClaimResult = result;
  }

  public setNextRecordResult(result: WorkerRecordAvScanOutcomeResult): void {
    this.nextRecordResult = result;
  }

  public async claimAvExecutionForWorkerTransactional(params: {
    readonly requestId: string;
    readonly workerRunId: string;
    readonly nowIso: string;
  }): Promise<WorkerClaimAvExecutionResult> {
    this.claimCalls.push({ ...params });
    return this.nextClaimResult;
  }

  public async recordWorkerAvScanOutcomeTransactional(
    input: WorkerRecordAvScanOutcomeInput
  ): Promise<WorkerRecordAvScanOutcomeResult> {
    this.recordCalls.push({ ...input });
    return this.nextRecordResult;
  }
}

describe('LibraryQuarantineAvAuthorityPort contract (C1)', () => {
  it('enforces compile-time structural compatibility with FirestoreLibraryQuarantineAvExecutionStore', () => {
    const storeSatisfiesAuthorityPort: AssertAssignable<
      FirestoreLibraryQuarantineAvExecutionStore,
      LibraryQuarantineAvAuthorityPort
    > = true;
    const portHasExactTwoCanonicalMethods: AssertExactMethodKeys<LibraryQuarantineAvAuthorityPort> =
      true;

    const assertStructuralCompatibility = (
      store: FirestoreLibraryQuarantineAvExecutionStore
    ): LibraryQuarantineAvAuthorityPort => store;

    expect(storeSatisfiesAuthorityPort).toBe(true);
    expect(portHasExactTwoCanonicalMethods).toBe(true);
    expect(typeof assertStructuralCompatibility).toBe('function');
  });

  it('supports injectable in-memory CLAIMED, ALREADY_RUNNING, and HOLD claim responses with all 5 readiness/publication flags false', async () => {
    const claimedDoc = buildSampleExecutionDoc({
      currentState: 'AV_SCAN_RUNNING',
      revision: 2,
    });

    const fakePort = new InMemoryFakeAvAuthorityPort({
      initialClaimResult: {
        outcome: 'CLAIMED',
        executionDoc: claimedDoc,
      },
      initialRecordResult: {
        outcome: 'HOLD',
        reasonCode: 'AV_EXECUTION_NOT_RUNNING',
      },
    });

    const claimedResponse = await fakePort.claimAvExecutionForWorkerTransactional({
      requestId: 'req-av-port-001',
      workerRunId: 'worker-run-001',
      nowIso: '2026-11-11T10:00:05.000Z',
    });

    expect(claimedResponse.outcome).toBe('CLAIMED');
    if (claimedResponse.outcome === 'CLAIMED') {
      expect(claimedResponse.executionDoc.requestId).toBe('req-av-port-001');
      expect(claimedResponse.executionDoc.currentState).toBe('AV_SCAN_RUNNING');
      expect(claimedResponse.executionDoc.isSanitized).toBe(false);
      expect(claimedResponse.executionDoc.isVerifiedSafe).toBe(false);
      expect(claimedResponse.executionDoc.isRightsApproved).toBe(false);
      expect(claimedResponse.executionDoc.isPublished).toBe(false);
      expect(claimedResponse.executionDoc.isReadyForPeia).toBe(false);
    }

    fakePort.setNextClaimResult({
      outcome: 'ALREADY_RUNNING',
      executionDoc: claimedDoc,
    });

    const alreadyRunningResponse = await fakePort.claimAvExecutionForWorkerTransactional({
      requestId: 'req-av-port-001',
      workerRunId: 'worker-run-001',
      nowIso: '2026-11-11T10:00:06.000Z',
    });

    expect(alreadyRunningResponse.outcome).toBe('ALREADY_RUNNING');
    if (alreadyRunningResponse.outcome === 'ALREADY_RUNNING') {
      expect(alreadyRunningResponse.executionDoc.latestWorkerRunId).toBe('worker-run-001');
      expect(alreadyRunningResponse.executionDoc.isSanitized).toBe(false);
      expect(alreadyRunningResponse.executionDoc.isVerifiedSafe).toBe(false);
      expect(alreadyRunningResponse.executionDoc.isRightsApproved).toBe(false);
      expect(alreadyRunningResponse.executionDoc.isPublished).toBe(false);
      expect(alreadyRunningResponse.executionDoc.isReadyForPeia).toBe(false);
    }

    fakePort.setNextClaimResult({
      outcome: 'HOLD',
      reasonCode: 'INSPECTION_REQUEST_LINEAGE_MISMATCH',
    });

    const holdResponse = await fakePort.claimAvExecutionForWorkerTransactional({
      requestId: 'req-av-port-001',
      workerRunId: 'worker-run-002',
      nowIso: '2026-11-11T10:00:07.000Z',
    });

    expect(holdResponse).toEqual({
      outcome: 'HOLD',
      reasonCode: 'INSPECTION_REQUEST_LINEAGE_MISMATCH',
    });
    expect(fakePort.claimCalls).toHaveLength(3);
    expect(fakePort.recordCalls).toHaveLength(0);
  });

  it('supports injectable in-memory RECORDED and HOLD scan outcome responses with all 5 readiness/publication flags false', async () => {
    const cleanRecordedDoc = buildSampleExecutionDoc({
      currentState: 'AV_NO_THREAT_DETECTED',
      revision: 3,
      completedAt: '2026-11-11T10:00:12.000Z',
      engineName: 'ClamAV',
      engineVersion: 'ClamAV 1.3.1',
      signatureVersion: '27200',
      signatureUpdatedAt: '2026-11-10T00:00:00.000Z',
      scannedBytes: 4096,
      exitCode: 0,
      failureReasonCode: null,
      staleReasonCode: null,
    });

    const fakePort = new InMemoryFakeAvAuthorityPort({
      initialClaimResult: {
        outcome: 'HOLD',
        reasonCode: 'AV_EXECUTION_RECORD_MISSING',
      },
      initialRecordResult: {
        outcome: 'RECORDED',
        executionDoc: cleanRecordedDoc,
      },
    });

    const recordInput: WorkerRecordAvScanOutcomeInput = {
      requestId: 'req-av-port-001',
      expectedRevision: 2,
      workerRunId: 'worker-run-001',
      nowIso: '2026-11-11T10:00:12.000Z',
      targetState: 'AV_NO_THREAT_DETECTED',
      engineName: 'ClamAV',
      engineVersion: 'ClamAV 1.3.1',
      signatureVersion: '27200',
      signatureUpdatedAt: '2026-11-10T00:00:00.000Z',
      scannedBytes: 4096,
      exitCode: 0,
      failureReasonCode: null,
      observedGcsGeneration: '1700000000000001',
      observedSha256: 'a'.repeat(64),
      observedByteSize: 4096,
    };

    const recordedResponse = await fakePort.recordWorkerAvScanOutcomeTransactional(recordInput);

    expect(recordedResponse.outcome).toBe('RECORDED');
    if (recordedResponse.outcome === 'RECORDED') {
      expect(recordedResponse.executionDoc.currentState).toBe('AV_NO_THREAT_DETECTED');
      expect(recordedResponse.executionDoc.revision).toBe(3);
      expect(recordedResponse.executionDoc.engineName).toBe('ClamAV');
      expect(recordedResponse.executionDoc.exitCode).toBe(0);
      expect(recordedResponse.executionDoc.isSanitized).toBe(false);
      expect(recordedResponse.executionDoc.isVerifiedSafe).toBe(false);
      expect(recordedResponse.executionDoc.isRightsApproved).toBe(false);
      expect(recordedResponse.executionDoc.isPublished).toBe(false);
      expect(recordedResponse.executionDoc.isReadyForPeia).toBe(false);
    }

    fakePort.setNextRecordResult({
      outcome: 'HOLD',
      reasonCode: 'AV_EXECUTION_REVISION_CONFLICT',
    });

    const holdResponse = await fakePort.recordWorkerAvScanOutcomeTransactional({
      ...recordInput,
      expectedRevision: 99,
    });

    expect(holdResponse).toEqual({
      outcome: 'HOLD',
      reasonCode: 'AV_EXECUTION_REVISION_CONFLICT',
    });
    expect(fakePort.recordCalls).toHaveLength(2);
    expect(fakePort.claimCalls).toHaveLength(0);
  });
});
