import { describe, expect, it } from 'vitest';
import type {
  LibraryQuarantineAvAuthorityPort,
  WorkerClaimAvExecutionResult,
  WorkerRecordAvScanOutcomeInput,
  WorkerRecordAvScanOutcomeResult,
} from './libraryQuarantineAvAuthorityPort';
import {
  AV_EXECUTION_SAFE_MESSAGES,
  type FirestoreLibraryQuarantineAvExecutionStore,
} from './libraryQuarantineAvExecutionService';
import {
  LIBRARY_QUARANTINE_AV_EXECUTION_SCHEMA_VERSION,
  validatePersistedLibraryQuarantineAvExecution,
  type LibraryQuarantinePersistedAvExecution,
} from './libraryQuarantineAvExecutionContract';
import {
  LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_SCHEMA_VERSION,
  LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_STATE,
  deriveLibraryQuarantineIsolatedInspectionRequestId,
  validatePersistedLibraryQuarantineIsolatedInspectionRequest,
  type LibraryQuarantinePersistedIsolatedInspectionRequest,
} from './libraryQuarantineIsolatedInspectionRequestContract';
import type { EligibleIsolatedInspectionChainSnapshot } from './firestoreLibraryQuarantineIsolatedInspectionRequestStore';
import { LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION } from './firestoreLibraryQuarantineReceiptStore';
import {
  LIBRARY_QUARANTINE_REVIEW_DRAFT_SCHEMA_VERSION,
  LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE,
} from './firestoreLibraryQuarantineReviewDraftStore';
import { LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_SCHEMA_VERSION } from './libraryQuarantineHumanReviewCaseContract';
import {
  LIBRARY_QUARANTINE_CATALOG_HANDOFF_SCHEMA_VERSION,
  deriveQuarantineCatalogDocumentId,
} from './libraryQuarantineCatalogHandoffService';
import { LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_SCHEMA_VERSION } from './libraryQuarantineBinarySafetyCaseContract';
import { LibraryQuarantineReceiptState } from './libraryQuarantineReceiptContract';
import {
  LibraryDocumentType,
  LibraryRightsStatus,
} from '../shared/libraryContract';
import { WorkflowState } from '../shared/workflowContract';

type AssertAssignable<TActual, TExpected> = TActual extends TExpected ? true : never;
type AssertExactMethodKeys<T> = keyof T extends
  | 'claimAvExecutionForWorkerTransactional'
  | 'recordWorkerAvScanOutcomeTransactional'
  ? 'claimAvExecutionForWorkerTransactional' | 'recordWorkerAvScanOutcomeTransactional' extends keyof T
    ? true
    : never
  : never;

const SAMPLE_RECEIPT_ID = 'a'.repeat(32);
const SAMPLE_DOCUMENT_ID = deriveQuarantineCatalogDocumentId(SAMPLE_RECEIPT_ID);
const SAMPLE_SOURCE_REVISION = 2;
const SAMPLE_SAFETY_CASE_REVISION = 1;
const SAMPLE_EFFECTIVE_HUMAN_CASE_REVISION = 2;
const SAMPLE_REQUEST_ID = deriveLibraryQuarantineIsolatedInspectionRequestId(
  SAMPLE_RECEIPT_ID,
  SAMPLE_SOURCE_REVISION,
  SAMPLE_SAFETY_CASE_REVISION
);
const SAMPLE_SOURCE_SHA256 = 'b'.repeat(64);
const SAMPLE_SOURCE_GENERATION = '1731350000001';
const SAMPLE_SOURCE_BYTE_SIZE = 4096;
const SAMPLE_SOURCE_UPDATED_AT = '2026-11-11T08:05:00.000Z';
const SAMPLE_CATALOG_UPDATED_AT = '2026-11-11T08:30:00.000Z';

function buildCanonicalPersistedAvExecution(
  overrides: Partial<LibraryQuarantinePersistedAvExecution> = {}
): LibraryQuarantinePersistedAvExecution {
  return {
    schemaVersion: LIBRARY_QUARANTINE_AV_EXECUTION_SCHEMA_VERSION,
    requestId: SAMPLE_REQUEST_ID,
    receiptId: SAMPLE_RECEIPT_ID,
    documentId: SAMPLE_DOCUMENT_ID,
    revision: 2,
    sourceRevision: SAMPLE_SOURCE_REVISION,
    sourceUpdatedAt: SAMPLE_SOURCE_UPDATED_AT,
    sourceSha256: SAMPLE_SOURCE_SHA256,
    sourceGeneration: SAMPLE_SOURCE_GENERATION,
    sourceByteSize: SAMPLE_SOURCE_BYTE_SIZE,
    sourceFormat: 'PDF',
    deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER',
    safetyCaseRevision: SAMPLE_SAFETY_CASE_REVISION,
    effectiveHumanCaseRevision: SAMPLE_EFFECTIVE_HUMAN_CASE_REVISION,
    catalogUpdatedAt: SAMPLE_CATALOG_UPDATED_AT,
    state: 'RUNNING',
    dispatchedBy: 'owner_01',
    dispatchedAt: '2026-11-11T10:00:00.000Z',
    workerRunId: 'worker-run-001',
    workerClaimedAt: '2026-11-11T10:00:05.000Z',
    completedAt: null,
    engineName: null,
    engineVersion: null,
    signatureVersion: null,
    signatureUpdatedAt: null,
    scannedBytes: null,
    exitCode: null,
    failureReasonCode: null,
    isSanitized: false,
    isVerifiedSafe: false,
    isRightsApproved: false,
    isPublished: false,
    isReadyForPeia: false,
    ...overrides,
  };
}

function buildCanonicalPersistedInspectionRequest(
  overrides: Partial<LibraryQuarantinePersistedIsolatedInspectionRequest> = {}
): LibraryQuarantinePersistedIsolatedInspectionRequest {
  return {
    schemaVersion: LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_SCHEMA_VERSION,
    requestId: SAMPLE_REQUEST_ID,
    receiptId: SAMPLE_RECEIPT_ID,
    documentId: SAMPLE_DOCUMENT_ID,
    sourceRevision: SAMPLE_SOURCE_REVISION,
    sourceUpdatedAt: SAMPLE_SOURCE_UPDATED_AT,
    sourceSha256: SAMPLE_SOURCE_SHA256,
    sourceGeneration: SAMPLE_SOURCE_GENERATION,
    sourceByteSize: SAMPLE_SOURCE_BYTE_SIZE,
    sourceFormat: 'PDF',
    deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER',
    safetyCaseRevision: SAMPLE_SAFETY_CASE_REVISION,
    effectiveHumanCaseRevision: SAMPLE_EFFECTIVE_HUMAN_CASE_REVISION,
    catalogUpdatedAt: SAMPLE_CATALOG_UPDATED_AT,
    requestedBy: 'owner_01',
    requestedAt: '2026-11-11T09:00:00.000Z',
    state: LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_STATE,
    dispatched: false,
    scanPerformed: false,
    sanitized: false,
    isVerifiedSafe: false,
    isPublished: false,
    isReadyForPeia: false,
    ...overrides,
  };
}

function buildCanonicalEligibleChainSnapshot(): EligibleIsolatedInspectionChainSnapshot {
  const effectiveHumanCaseUpdatedAt = '2026-11-11T08:20:00.000Z';

  return {
    requestId: SAMPLE_REQUEST_ID,
    sourceGeneration: SAMPLE_SOURCE_GENERATION,
    sourceByteSize: SAMPLE_SOURCE_BYTE_SIZE,
    safetyCaseRevision: SAMPLE_SAFETY_CASE_REVISION,
    chainSnapshot: {
      receiptId: SAMPLE_RECEIPT_ID,
      documentId: SAMPLE_DOCUMENT_ID,
      receiptEnvelope: {
        schemaVersion: LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION,
        revision: SAMPLE_SOURCE_REVISION,
        state: LibraryQuarantineReceiptState.Quarantined,
        receipt: {
          receiptId: SAMPLE_RECEIPT_ID,
          uploaderUid: 'admin_curator_01',
          originalFilename: 'coastal-assessment-1.pdf',
          sanitizedFilename: 'coastal-assessment-1.pdf',
          format: 'PDF',
          canonicalExtension: 'pdf',
          canonicalMimeType: 'application/pdf',
          byteSize: SAMPLE_SOURCE_BYTE_SIZE,
          sha256: SAMPLE_SOURCE_SHA256,
          deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER',
          storagePath: `library/quarantine/${SAMPLE_RECEIPT_ID}/source.pdf`,
          state: LibraryQuarantineReceiptState.Quarantined,
          generation: SAMPLE_SOURCE_GENERATION,
          reconciliationReason: null,
          rejectionReasonCode: null,
          createdAt: '2026-11-11T08:00:00.000Z',
          updatedAt: SAMPLE_SOURCE_UPDATED_AT,
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
        },
      },
      reviewDraft: {
        schemaVersion: LIBRARY_QUARANTINE_REVIEW_DRAFT_SCHEMA_VERSION,
        receiptId: SAMPLE_RECEIPT_ID,
        sourceRevision: SAMPLE_SOURCE_REVISION,
        sourceUpdatedAt: SAMPLE_SOURCE_UPDATED_AT,
        sourceSha256: SAMPLE_SOURCE_SHA256,
        format: 'PDF',
        uploaderUid: 'admin_curator_01',
        reviewState: LIBRARY_QUARANTINE_REVIEW_DRAFT_STATE,
        createdBy: 'admin_curator_01',
        createdAt: '2026-11-11T08:10:00.000Z',
        isSanitized: false,
        isVerifiedSafe: false,
        isRightsApproved: false,
        isPublished: false,
        isReadyForPeia: false,
      },
      humanReviewCase: {
        schemaVersion: LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_SCHEMA_VERSION,
        receiptId: SAMPLE_RECEIPT_ID,
        sourceRevision: SAMPLE_SOURCE_REVISION,
        sourceUpdatedAt: SAMPLE_SOURCE_UPDATED_AT,
        sourceSha256: SAMPLE_SOURCE_SHA256,
        draftSourceRevision: SAMPLE_SOURCE_REVISION,
        revision: SAMPLE_EFFECTIVE_HUMAN_CASE_REVISION,
        status: 'METADATA_RECORDED',
        titleAr: 'تقييم السواحل والبيئة البحرية',
        titleEn: 'Coastal and Marine Assessment',
        issuingOrganization: 'برنامج الأمم المتحدة للبيئة (UNEP)',
        summaryAr: 'ملخص تحريري مراجع لتقييم السواحل.',
        summaryEn: 'Reviewed editorial summary for coastal assessment.',
        sourceEvidenceNotes: 'وثيقة رسمية موثقة في أرشيف الأمم المتحدة.',
        rightsEvidenceNotes: 'ملاحظات أولية بانتظار مراجع الحقوق.',
        editorialNotes: 'تمت المراجعة الأولية للبيانات الوصفية.',
        createdBy: 'admin_curator_01',
        createdAt: '2026-11-11T08:15:00.000Z',
        updatedBy: 'admin_curator_01',
        updatedAt: effectiveHumanCaseUpdatedAt,
      },
      catalogHandoff: {
        schemaVersion: LIBRARY_QUARANTINE_CATALOG_HANDOFF_SCHEMA_VERSION,
        receiptId: SAMPLE_RECEIPT_ID,
        documentId: SAMPLE_DOCUMENT_ID,
        sourceRevision: SAMPLE_SOURCE_REVISION,
        sourceUpdatedAt: SAMPLE_SOURCE_UPDATED_AT,
        sourceSha256: SAMPLE_SOURCE_SHA256,
        draftSourceRevision: SAMPLE_SOURCE_REVISION,
        caseRevision: SAMPLE_EFFECTIVE_HUMAN_CASE_REVISION,
        caseUpdatedAt: effectiveHumanCaseUpdatedAt,
        organizationId: 'org-unep',
        sourceId: 'src-unep-verified',
        createdBy: 'admin_curator_01',
        createdAt: SAMPLE_CATALOG_UPDATED_AT,
        isSanitized: false,
        isVerifiedSafe: false,
        isRightsApproved: false,
        isPublished: false,
        isReadyForPeia: false,
      },
      catalogDocument: {
        id: SAMPLE_DOCUMENT_ID,
        titleAr: 'تقييم السواحل والبيئة البحرية',
        titleEn: 'Coastal and Marine Assessment',
        documentType: LibraryDocumentType.InstitutionalReport,
        organizationId: 'org-unep',
        sourceId: 'src-unep-verified',
        geographyAr: 'إقليمي',
        geographyEn: 'Regional',
        publicationDate: '2026-06-01',
        language: 'bilingual',
        summaryAr: 'ملخص تحريري مراجع لتقييم السواحل.',
        summaryEn: 'Reviewed editorial summary for coastal assessment.',
        topicsAr: ['البيئة البحرية'],
        topicsEn: ['Marine Environment'],
        environmentalDomains: ['Biodiversity'],
        rightsStatus: LibraryRightsStatus.ReviewRequired,
        workflowState: WorkflowState.Draft,
        legalStatusDescriptionAr: 'تقرير إرشادي غير ملزم',
        legalStatusDescriptionEn: 'Non-binding technical report',
        createdAt: SAMPLE_CATALOG_UPDATED_AT,
        updatedAt: SAMPLE_CATALOG_UPDATED_AT,
        versions: [
          {
            id: `ver-${SAMPLE_DOCUMENT_ID}-1`,
            documentId: SAMPLE_DOCUMENT_ID,
            versionNumber: '1.0',
            publishedDate: '2026-06-01',
            changeDescriptionAr: 'مسودة فهرس أولية من الحجر',
            changeDescriptionEn: 'Initial quarantine catalog draft',
          },
        ],
      },
      alignment: null,
      sourceFormat: 'PDF',
      deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER',
      effectiveHumanCaseRevision: SAMPLE_EFFECTIVE_HUMAN_CASE_REVISION,
      effectiveHumanCaseUpdatedAt,
      catalogUpdatedAt: SAMPLE_CATALOG_UPDATED_AT,
      binarySafetyCase: {
        schemaVersion: LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_SCHEMA_VERSION,
        receiptId: SAMPLE_RECEIPT_ID,
        documentId: SAMPLE_DOCUMENT_ID,
        revision: SAMPLE_SAFETY_CASE_REVISION,
        sourceRevision: SAMPLE_SOURCE_REVISION,
        sourceUpdatedAt: SAMPLE_SOURCE_UPDATED_AT,
        sourceSha256: SAMPLE_SOURCE_SHA256,
        sourceFormat: 'PDF',
        deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER',
        effectiveHumanCaseRevision: SAMPLE_EFFECTIVE_HUMAN_CASE_REVISION,
        effectiveHumanCaseUpdatedAt,
        catalogUpdatedAt: SAMPLE_CATALOG_UPDATED_AT,
        disposition: 'ISOLATED_ASSESSMENT_REQUIRED',
        evidenceReference: 'TICKET-ISO-1',
        evidenceNotes: 'Referred to isolated inspection queue.',
        reviewNotes: 'Pending isolated parser execution.',
        createdBy: 'owner_01',
        createdAt: '2026-11-11T08:40:00.000Z',
        updatedBy: 'owner_01',
        updatedAt: '2026-11-11T08:40:00.000Z',
        isSanitized: false,
        isVerifiedSafe: false,
        isRightsApproved: false,
        isPublished: false,
        isReadyForPeia: false,
      },
      isCaseCurrent: true,
      requiresFreshEvidence: false,
    },
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

describe('LibraryQuarantineAvAuthorityPort contract (C1-R1)', () => {
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

  it('supports injectable in-memory CLAIMED, ALREADY_RUNNING, and HOLD claim responses using canonical schemas and false security posture flags', async () => {
    const claimedExecution = buildCanonicalPersistedAvExecution({
      state: 'RUNNING',
      revision: 2,
    });
    const inspectionRequest = buildCanonicalPersistedInspectionRequest();
    const eligibleChain = buildCanonicalEligibleChainSnapshot();

    const executionValidation = validatePersistedLibraryQuarantineAvExecution(
      claimedExecution,
      SAMPLE_REQUEST_ID
    );
    expect(executionValidation.ok).toBe(true);

    const requestValidation = validatePersistedLibraryQuarantineIsolatedInspectionRequest(
      inspectionRequest,
      SAMPLE_REQUEST_ID
    );
    expect(requestValidation.ok).toBe(true);

    const fakePort = new InMemoryFakeAvAuthorityPort({
      initialClaimResult: {
        status: 'CLAIMED',
        execution: claimedExecution,
        inspectionRequest,
        eligibleChain,
      },
      initialRecordResult: {
        status: 'HOLD',
        errorCode: 'AV_EXECUTION_NOT_FOUND',
        errorMessage: AV_EXECUTION_SAFE_MESSAGES.AV_EXECUTION_NOT_FOUND,
      },
    });

    const claimedResponse = await fakePort.claimAvExecutionForWorkerTransactional({
      requestId: SAMPLE_REQUEST_ID,
      workerRunId: 'worker-run-001',
      nowIso: '2026-11-11T10:00:05.000Z',
    });

    expect(claimedResponse.status).toBe('CLAIMED');
    if (claimedResponse.status === 'CLAIMED') {
      expect(claimedResponse.execution.schemaVersion).toBe(1);
      expect(claimedResponse.execution.requestId).toBe(SAMPLE_REQUEST_ID);
      expect(claimedResponse.execution.state).toBe('RUNNING');
      expect(claimedResponse.execution.isSanitized).toBe(false);
      expect(claimedResponse.execution.isVerifiedSafe).toBe(false);
      expect(claimedResponse.execution.isRightsApproved).toBe(false);
      expect(claimedResponse.execution.isPublished).toBe(false);
      expect(claimedResponse.execution.isReadyForPeia).toBe(false);
      expect(claimedResponse.inspectionRequest.requestId).toBe(SAMPLE_REQUEST_ID);
      expect(claimedResponse.inspectionRequest.state).toBe('RECORDED_NOT_DISPATCHED');
      expect(claimedResponse.eligibleChain.requestId).toBe(SAMPLE_REQUEST_ID);
      expect(claimedResponse.eligibleChain.sourceGeneration).toBe(SAMPLE_SOURCE_GENERATION);
    }

    fakePort.setNextClaimResult({
      status: 'ALREADY_RUNNING',
      execution: claimedExecution,
    });

    const alreadyRunningResponse = await fakePort.claimAvExecutionForWorkerTransactional({
      requestId: SAMPLE_REQUEST_ID,
      workerRunId: 'worker-run-001',
      nowIso: '2026-11-11T10:00:06.000Z',
    });

    expect(alreadyRunningResponse.status).toBe('ALREADY_RUNNING');
    if (alreadyRunningResponse.status === 'ALREADY_RUNNING') {
      expect(alreadyRunningResponse.execution.workerRunId).toBe('worker-run-001');
      expect(alreadyRunningResponse.execution.state).toBe('RUNNING');
      expect(alreadyRunningResponse.execution.isSanitized).toBe(false);
      expect(alreadyRunningResponse.execution.isVerifiedSafe).toBe(false);
      expect(alreadyRunningResponse.execution.isRightsApproved).toBe(false);
      expect(alreadyRunningResponse.execution.isPublished).toBe(false);
      expect(alreadyRunningResponse.execution.isReadyForPeia).toBe(false);
    }

    fakePort.setNextClaimResult({
      status: 'HOLD',
      errorCode: 'INSPECTION_REQUEST_INCOMPATIBLE_WITH_SOURCE',
      errorMessage:
        AV_EXECUTION_SAFE_MESSAGES.INSPECTION_REQUEST_INCOMPATIBLE_WITH_SOURCE,
    });

    const holdResponse = await fakePort.claimAvExecutionForWorkerTransactional({
      requestId: SAMPLE_REQUEST_ID,
      workerRunId: 'worker-run-002',
      nowIso: '2026-11-11T10:00:07.000Z',
    });

    expect(holdResponse).toEqual({
      status: 'HOLD',
      errorCode: 'INSPECTION_REQUEST_INCOMPATIBLE_WITH_SOURCE',
      errorMessage:
        AV_EXECUTION_SAFE_MESSAGES.INSPECTION_REQUEST_INCOMPATIBLE_WITH_SOURCE,
    });
    expect(fakePort.claimCalls).toHaveLength(3);
    expect(fakePort.recordCalls).toHaveLength(0);
  });

  it('supports injectable in-memory RECORDED and HOLD (revision conflict) scan outcome responses with all 5 false security posture flags', async () => {
    const recordedCleanExecution = buildCanonicalPersistedAvExecution({
      state: 'AV_NO_THREAT_DETECTED',
      revision: 3,
      completedAt: '2026-11-11T10:00:12.000Z',
      engineName: 'ClamAV',
      engineVersion: 'ClamAV 1.3.1',
      signatureVersion: '27200',
      signatureUpdatedAt: '2026-11-10T00:00:00.000Z',
      scannedBytes: SAMPLE_SOURCE_BYTE_SIZE,
      exitCode: 0,
      failureReasonCode: null,
    });

    const recordedValidation = validatePersistedLibraryQuarantineAvExecution(
      recordedCleanExecution,
      SAMPLE_REQUEST_ID
    );
    expect(recordedValidation.ok).toBe(true);

    const fakePort = new InMemoryFakeAvAuthorityPort({
      initialClaimResult: {
        status: 'HOLD',
        errorCode: 'AV_EXECUTION_NOT_FOUND',
        errorMessage: AV_EXECUTION_SAFE_MESSAGES.AV_EXECUTION_NOT_FOUND,
      },
      initialRecordResult: {
        status: 'RECORDED',
        execution: recordedCleanExecution,
      },
    });

    const recordInput: WorkerRecordAvScanOutcomeInput = {
      requestId: SAMPLE_REQUEST_ID,
      expectedRevision: 2,
      workerRunId: 'worker-run-001',
      nowIso: '2026-11-11T10:00:12.000Z',
      targetState: 'AV_NO_THREAT_DETECTED',
      engineName: 'ClamAV',
      engineVersion: 'ClamAV 1.3.1',
      signatureVersion: '27200',
      signatureUpdatedAt: '2026-11-10T00:00:00.000Z',
      scannedBytes: SAMPLE_SOURCE_BYTE_SIZE,
      exitCode: 0,
      failureReasonCode: null,
      observedGcsGeneration: SAMPLE_SOURCE_GENERATION,
      observedSha256: SAMPLE_SOURCE_SHA256,
      observedByteSize: SAMPLE_SOURCE_BYTE_SIZE,
    };

    const recordedResponse = await fakePort.recordWorkerAvScanOutcomeTransactional(recordInput);

    expect(recordedResponse.status).toBe('RECORDED');
    if (recordedResponse.status === 'RECORDED') {
      expect(recordedResponse.execution.schemaVersion).toBe(1);
      expect(recordedResponse.execution.state).toBe('AV_NO_THREAT_DETECTED');
      expect(recordedResponse.execution.revision).toBe(3);
      expect(recordedResponse.execution.engineName).toBe('ClamAV');
      expect(recordedResponse.execution.exitCode).toBe(0);
      expect(recordedResponse.execution.isSanitized).toBe(false);
      expect(recordedResponse.execution.isVerifiedSafe).toBe(false);
      expect(recordedResponse.execution.isRightsApproved).toBe(false);
      expect(recordedResponse.execution.isPublished).toBe(false);
      expect(recordedResponse.execution.isReadyForPeia).toBe(false);
    }

    fakePort.setNextRecordResult({
      status: 'HOLD',
      errorCode: 'AV_EXECUTION_REVISION_CONFLICT',
      errorMessage: AV_EXECUTION_SAFE_MESSAGES.AV_EXECUTION_REVISION_CONFLICT,
    });

    const holdResponse = await fakePort.recordWorkerAvScanOutcomeTransactional({
      ...recordInput,
      expectedRevision: 99,
    });

    expect(holdResponse).toEqual({
      status: 'HOLD',
      errorCode: 'AV_EXECUTION_REVISION_CONFLICT',
      errorMessage: AV_EXECUTION_SAFE_MESSAGES.AV_EXECUTION_REVISION_CONFLICT,
    });
    expect(fakePort.recordCalls).toHaveLength(2);
    expect(fakePort.claimCalls).toHaveLength(0);
  });
});
