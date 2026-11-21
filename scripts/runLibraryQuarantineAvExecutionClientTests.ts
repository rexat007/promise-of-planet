import assert from 'node:assert/strict';
import process from 'node:process';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AdminPermission,
  AdminRole,
  type AdminUser,
} from '../src/types/admin';
import type { SanitizedLibraryQuarantineHumanReviewCaseDto } from '../src/services/libraryQuarantineHumanReviewClient';
import {
  LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_SCHEMA_VERSION,
  LibraryQuarantineBinarySafetyCaseController,
  QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS,
  type SanitizedLibraryQuarantineBinarySafetyCaseDto,
} from '../src/services/libraryQuarantineBinarySafetyCaseClient';
import {
  LIBRARY_AV_EXECUTION_UI_ENV_VAR,
  LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL,
  LIBRARY_QUARANTINE_AV_EXECUTION_FAILURE_REASON_CODES,
  LIBRARY_QUARANTINE_AV_EXECUTION_SCHEMA_VERSION,
  LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_SCHEMA_VERSION,
  LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_STATE,
  LibraryQuarantineIsolatedInspectionRequestController,
  QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
  canUserDispatchAvInspection,
  isLibraryQuarantineAvExecutionEnabled,
  validateDispatchQuarantineAvInspectionResponseDto,
  validateGetQuarantineAvInspectionStatusResponseDto,
  validateSanitizedAvExecutionDto,
  type LibraryQuarantineAvExecutionFailureReasonCode,
  type SanitizedLibraryQuarantineAvExecutionDto,
  type SanitizedLibraryQuarantineIsolatedInspectionRequestDto,
} from '../src/services/libraryQuarantineIsolatedInspectionRequestClient';
import { LibraryQuarantineBinarySafetyCasePanel } from '../src/components/library/LibraryQuarantineBinarySafetyCasePanel';
import {
  formatLibraryQuarantineHoldGuidance,
  LibraryQuarantinePublishedBinaryReleaseSection,
} from '../src/components/library/LibraryQuarantineHumanReviewModal';
import { LibraryQuarantinePublishedBinaryReleasePanelController } from '../src/services/libraryPublishedBinaryClient';

const RECEIPT_ID_A = '0123456789abcdef0123456789abcdef';
const RECEIPT_ID_B = 'fedcba9876543210fedcba9876543210';
const DOC_ID_A = `qcat-${RECEIPT_ID_A}`;
const REQUEST_ID_A = `${RECEIPT_ID_A}_2_1`;
const ISO_1 = '2026-11-11T10:00:00.000Z';
const ISO_2 = '2026-11-11T10:05:00.000Z';
const ISO_3 = '2026-11-11T10:10:00.000Z';

const ownerUser: AdminUser = Object.freeze({
  id: 'owner_01',
  name: 'Owner Admin',
  email: 'owner@planet.org',
  role: AdminRole.Owner,
  isActive: true,
});

const inactiveOwnerUser: AdminUser = Object.freeze({
  id: 'owner_inactive',
  name: 'Inactive Owner',
  email: 'inactive@planet.org',
  role: AdminRole.Owner,
  isActive: false,
});

const curatorUser: AdminUser = Object.freeze({
  id: 'curator_01',
  name: 'Curator Admin',
  email: 'curator@planet.org',
  role: AdminRole.LibraryCurator,
  isActive: true,
});

const rightsReviewerUser: AdminUser = Object.freeze({
  id: 'rights_01',
  name: 'Rights Reviewer',
  email: 'rights@planet.org',
  role: AdminRole.RightsReviewer,
  isActive: true,
});

const ALL_FIVE_FLAGS_ON = Object.freeze({
  VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED: 'true',
  VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED: 'true',
  VITE_LIBRARY_CATALOG_HANDOFF_ENABLED: 'true',
  VITE_LIBRARY_BINARY_SAFETY_CASE_ENABLED: 'true',
  VITE_LIBRARY_ISOLATED_INSPECTION_REQUEST_ENABLED: 'true',
});

const ALL_SIX_FLAGS_ON = Object.freeze({
  ...ALL_FIVE_FLAGS_ON,
  VITE_LIBRARY_AV_EXECUTION_ENABLED: 'true',
});

function makeSanitizedSafetyCaseDto(
  overrides?: Partial<SanitizedLibraryQuarantineBinarySafetyCaseDto>
): SanitizedLibraryQuarantineBinarySafetyCaseDto {
  return Object.freeze({
    schemaVersion: LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_SCHEMA_VERSION,
    receiptId: RECEIPT_ID_A,
    documentId: DOC_ID_A,
    revision: 1,
    sourceRevision: 2,
    sourceUpdatedAt: ISO_1,
    sourceFormat: 'PDF' as const,
    deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER' as const,
    effectiveHumanCaseRevision: 2,
    effectiveHumanCaseUpdatedAt: ISO_1,
    catalogUpdatedAt: ISO_1,
    disposition: 'ISOLATED_ASSESSMENT_REQUIRED' as const,
    evidenceReference: 'TICKET-101',
    evidenceNotes: 'Isolated PDF parser referral logged.',
    reviewNotes: 'Awaiting isolated parser analysis.',
    createdAt: ISO_1,
    updatedAt: ISO_2,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
    ...overrides,
  });
}

function makeSavedHumanReviewCase(
  overrides?: Partial<SanitizedLibraryQuarantineHumanReviewCaseDto>
): SanitizedLibraryQuarantineHumanReviewCaseDto {
  return Object.freeze({
    schemaVersion: 1 as const,
    receiptId: RECEIPT_ID_A,
    revision: 2,
    sourceRevision: 2,
    sourceUpdatedAt: ISO_1,
    draftSourceRevision: 2,
    status: 'METADATA_RECORDED' as const,
    titleAr: 'تقييم سلامة البيئة البحرية',
    titleEn: 'Marine Environment Safety Assessment',
    issuingOrganization: 'UNEP',
    summaryAr: 'ملخص مراجع',
    summaryEn: 'Reviewed summary',
    sourceEvidenceNotes: 'Official archive reference',
    rightsEvidenceNotes: 'Pending rights clearance',
    editorialNotes: 'Reviewed metadata',
    createdAt: ISO_1,
    updatedAt: ISO_1,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
    ...overrides,
  });
}

function makeSanitizedInspectionRequestDto(
  overrides?: Partial<SanitizedLibraryQuarantineIsolatedInspectionRequestDto>
): SanitizedLibraryQuarantineIsolatedInspectionRequestDto {
  return Object.freeze({
    schemaVersion: LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_SCHEMA_VERSION,
    requestId: REQUEST_ID_A,
    receiptId: RECEIPT_ID_A,
    documentId: DOC_ID_A,
    sourceRevision: 2,
    sourceUpdatedAt: ISO_1,
    sourceFormat: 'PDF' as const,
    deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER' as const,
    safetyCaseRevision: 1,
    effectiveHumanCaseRevision: 2,
    catalogUpdatedAt: ISO_1,
    requestedAt: ISO_2,
    state: LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_STATE,
    dispatched: false as const,
    scanPerformed: false as const,
    sanitized: false as const,
    isVerifiedSafe: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
    ...overrides,
  });
}

function makeSanitizedAvExecutionDto(
  overrides?: Partial<SanitizedLibraryQuarantineAvExecutionDto>
): SanitizedLibraryQuarantineAvExecutionDto {
  return Object.freeze({
    schemaVersion: LIBRARY_QUARANTINE_AV_EXECUTION_SCHEMA_VERSION,
    requestId: REQUEST_ID_A,
    receiptId: RECEIPT_ID_A,
    documentId: DOC_ID_A,
    revision: 2,
    sourceRevision: 2,
    sourceUpdatedAt: ISO_1,
    sourceFormat: 'PDF' as const,
    deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER' as const,
    safetyCaseRevision: 1,
    effectiveHumanCaseRevision: 2,
    catalogUpdatedAt: ISO_1,
    state: 'DISPATCHED_WAITING_WORKER' as const,
    dispatchedAt: ISO_2,
    workerClaimedAt: null,
    completedAt: null,
    engineName: null,
    engineVersion: null,
    signatureVersion: null,
    signatureUpdatedAt: null,
    scannedBytes: null,
    exitCode: null,
    failureReasonCode: null,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
    ...overrides,
  });
}

function makeGetRecordedRequestResponse(): Record<string, unknown> {
  return {
    ok: true,
    status: 'RECORDED',
    outcome: 'RECORDED',
    receiptId: RECEIPT_ID_A,
    documentId: DOC_ID_A,
    requestId: REQUEST_ID_A,
    sourceRevision: 2,
    sourceUpdatedAt: ISO_1,
    sourceFormat: 'PDF',
    deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER',
    safetyCaseRevision: 1,
    effectiveHumanCaseRevision: 2,
    catalogUpdatedAt: ISO_1,
    readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
    inspectionRequest: makeSanitizedInspectionRequestDto(),
    dispatched: false,
    scanPerformed: false,
    sanitized: false,
    isSanitized: false,
    isVerifiedSafe: false,
    isRightsApproved: false,
    isPublished: false,
    isReadyForPeia: false,
  };
}

function makeGetAvStatusResponse(
  status:
    | 'NOT_DISPATCHED'
    | 'DISPATCH_PENDING'
    | 'DISPATCHED_WAITING_WORKER'
    | 'RUNNING'
    | 'AV_NO_THREAT_DETECTED'
    | 'AV_THREAT_DETECTED'
    | 'AV_SCAN_FAILED'
    | 'DISPATCH_UNKNOWN' = 'NOT_DISPATCHED',
  execution: SanitizedLibraryQuarantineAvExecutionDto | null = null
): Record<string, unknown> {
  return {
    ok: true,
    status,
    outcome: status,
    receiptId: RECEIPT_ID_A,
    documentId: DOC_ID_A,
    requestId: REQUEST_ID_A,
    sourceRevision: 2,
    sourceUpdatedAt: ISO_1,
    sourceFormat: 'PDF',
    deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER',
    safetyCaseRevision: 1,
    effectiveHumanCaseRevision: 2,
    catalogUpdatedAt: ISO_1,
    inspectionRequestRecorded: true,
    inspectionRequest: makeSanitizedInspectionRequestDto(),
    execution,
    readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
    isSanitized: false,
    isVerifiedSafe: false,
    isRightsApproved: false,
    isPublished: false,
    isReadyForPeia: false,
  };
}

function makeDispatchAvSuccessResponse(
  outcome: 'DISPATCHED' | 'ALREADY_DISPATCHED' = 'DISPATCHED',
  execution: SanitizedLibraryQuarantineAvExecutionDto = makeSanitizedAvExecutionDto()
): Record<string, unknown> {
  return {
    ok: true,
    status: execution.state,
    outcome,
    dispatchOutcome: outcome,
    receiptId: RECEIPT_ID_A,
    documentId: DOC_ID_A,
    requestId: REQUEST_ID_A,
    sourceRevision: 2,
    sourceUpdatedAt: ISO_1,
    sourceFormat: 'PDF',
    deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER',
    safetyCaseRevision: 1,
    effectiveHumanCaseRevision: 2,
    catalogUpdatedAt: ISO_1,
    inspectionRequest: makeSanitizedInspectionRequestDto(),
    execution,
    readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
    isSanitized: false,
    isVerifiedSafe: false,
    isRightsApproved: false,
    isPublished: false,
    isReadyForPeia: false,
  };
}

async function runClientTests(): Promise<void> {
  console.log('STARTING LIB-FILE-ISOLATED-AV-EXECUTION-M1 CLIENT TESTS...');

  // =========================================================================
  // PASS 1: 6-Flag UI Release Gate (Default OFF) & Owner-Only RBAC
  // =========================================================================
  assert.equal(
    LIBRARY_AV_EXECUTION_UI_ENV_VAR,
    'VITE_LIBRARY_AV_EXECUTION_ENABLED'
  );
  assert.equal(isLibraryQuarantineAvExecutionEnabled({}), false);
  assert.equal(isLibraryQuarantineAvExecutionEnabled(ALL_FIVE_FLAGS_ON), false);
  assert.equal(isLibraryQuarantineAvExecutionEnabled(ALL_SIX_FLAGS_ON), true);
  assert.equal(
    isLibraryQuarantineAvExecutionEnabled({
      ...ALL_SIX_FLAGS_ON,
      VITE_LIBRARY_ISOLATED_INSPECTION_REQUEST_ENABLED: 'false',
    }),
    false
  );

  assert.equal(canUserDispatchAvInspection(ownerUser), true);
  assert.equal(canUserDispatchAvInspection(inactiveOwnerUser), false);
  assert.equal(canUserDispatchAvInspection(curatorUser), false);
  assert.equal(canUserDispatchAvInspection(rightsReviewerUser), false);
  assert.equal(canUserDispatchAvInspection(null), false);
  assert.equal(
    canUserDispatchAvInspection({
      ...ownerUser,
      permissions: [AdminPermission.View],
    } as AdminUser),
    false
  );

  // =========================================================================
  // PASS 2: Strict 28-Field Sanitized AV Execution DTO & Envelope Validators
  // =========================================================================
  const cleanExecDto = makeSanitizedAvExecutionDto({
    revision: 4,
    state: 'AV_NO_THREAT_DETECTED',
    workerClaimedAt: ISO_2,
    completedAt: ISO_3,
    engineName: 'ClamAV',
    engineVersion: 'ClamAV 1.3.1/27455',
    signatureVersion: 'daily.cvd:27455',
    signatureUpdatedAt: ISO_1,
    scannedBytes: 32768,
    exitCode: 0,
    failureReasonCode: null,
  });

  assert.equal(
    validateSanitizedAvExecutionDto(cleanExecDto, RECEIPT_ID_A).ok,
    true
  );

  // Reject leaked private fields or escalated posture flags
  for (const badOverride of [
    { sourceSha256: 'a'.repeat(64) },
    { sourceGeneration: '1731350000001' },
    { sourceByteSize: 32768 },
    { dispatchedBy: 'owner_01' },
    { workerRunId: 'worker_01' },
    { storagePath: 'library/quarantine/secret.pdf' },
    { isSanitized: true },
    { isVerifiedSafe: true },
    { isRightsApproved: true },
    { isPublished: true },
    { isReadyForPeia: true },
  ]) {
    assert.equal(
      validateSanitizedAvExecutionDto({
        ...cleanExecDto,
        ...badOverride,
      }).ok,
      false,
      `AV DTO validator failed to reject override: ${JSON.stringify(badOverride)}`
    );
  }

  assert.equal(
    validateGetQuarantineAvInspectionStatusResponseDto(
      makeGetAvStatusResponse('NOT_DISPATCHED', null),
      RECEIPT_ID_A
    ).ok,
    true
  );
  assert.equal(
    validateGetQuarantineAvInspectionStatusResponseDto(
      makeGetAvStatusResponse('AV_NO_THREAT_DETECTED', cleanExecDto),
      RECEIPT_ID_A
    ).ok,
    true
  );
  assert.equal(
    validateDispatchQuarantineAvInspectionResponseDto(
      makeDispatchAvSuccessResponse('DISPATCHED'),
      RECEIPT_ID_A
    ).ok,
    true
  );

  // =========================================================================
  // PASS 3: Controller Dispatch Guards, Single Dispatch Lock, UNKNOWN GET-Only
  //         Recovery (Zero Auto-Retry), and Receipt Switch Reset
  // =========================================================================
  let callableCalls = 0;
  let dispatchedOnServer = false;

  const ctrl = new LibraryQuarantineIsolatedInspectionRequestController(
    RECEIPT_ID_A,
    {
      envOverride: ALL_SIX_FLAGS_ON,
      currentUser: ownerUser,
      callableOverride: async (payload) => {
        callableCalls += 1;
        if (payload.action === 'getQuarantineIsolatedInspectionRequest') {
          return { data: makeGetRecordedRequestResponse() };
        }
        if (payload.action === 'getQuarantineAvInspectionStatus') {
          return {
            data: dispatchedOnServer
              ? makeGetAvStatusResponse(
                  'DISPATCHED_WAITING_WORKER',
                  makeSanitizedAvExecutionDto()
                )
              : makeGetAvStatusResponse('NOT_DISPATCHED', null),
          };
        }
        if (payload.action === 'dispatchQuarantineAvInspection') {
          assert.equal(
            payload.confirmation,
            LIBRARY_QUARANTINE_AV_DISPATCH_CONFIRMATION_LITERAL
          );
          dispatchedOnServer = true;
          return {
            data: makeDispatchAvSuccessResponse('DISPATCHED'),
          };
        }
        return { data: { ok: false } };
      },
    }
  );

  await ctrl.loadRequest();
  await ctrl.loadAvInspectionStatus();
  assert.equal(ctrl.getState().avStatusSnapshot?.status, 'NOT_DISPATCHED');

  const callsBeforeGuards = callableCalls;

  // Guard 1: Unchecked confirmation checkbox -> blocked with 0 backend calls
  const unconfirmedDisp = await ctrl.dispatchAvInspection({
    expectedRequestId: REQUEST_ID_A,
    expectedSafetyCaseRevision: 1,
    acknowledgedHumanCaseRevision: 2,
  });
  assert.equal(unconfirmedDisp.ok, false);
  assert.equal(callableCalls, callsBeforeGuards);

  ctrl.setConfirmedAvDispatch(true);

  // Guard 2: Dirty human review case edits -> blocked with 0 backend calls
  const dirtyDisp = await ctrl.dispatchAvInspection({
    expectedRequestId: REQUEST_ID_A,
    expectedSafetyCaseRevision: 1,
    acknowledgedHumanCaseRevision: 2,
    hasUnsavedCaseEdits: true,
  });
  assert.equal(dirtyDisp.ok, false);
  assert.equal(callableCalls, callsBeforeGuards);

  // Guard 3: Stale binary safety case -> blocked with 0 backend calls
  const staleDisp = await ctrl.dispatchAvInspection({
    expectedRequestId: REQUEST_ID_A,
    expectedSafetyCaseRevision: 1,
    acknowledgedHumanCaseRevision: 2,
    isSafetyCaseStale: true,
  });
  assert.equal(staleDisp.ok, false);
  assert.equal(callableCalls, callsBeforeGuards);

  // Valid dispatch call -> DISPATCHED_WAITING_WORKER
  const validDisp = await ctrl.dispatchAvInspection({
    expectedRequestId: REQUEST_ID_A,
    expectedSafetyCaseRevision: 1,
    acknowledgedHumanCaseRevision: 2,
    safetyCaseDisposition: 'ISOLATED_ASSESSMENT_REQUIRED',
  });
  assert.equal(validDisp.ok, true);
  assert.equal(
    ctrl.getState().avStatusSnapshot?.status,
    'DISPATCHED_WAITING_WORKER'
  );
  assert.equal(ctrl.getState().confirmedAvDispatch, false);

  // Transport error during dispatch -> transitions to 'unknown' phase, blocks retry until GET
  let unknownDispatchCalls = 0;
  const unknownCtrl = new LibraryQuarantineIsolatedInspectionRequestController(
    RECEIPT_ID_A,
    {
      envOverride: ALL_SIX_FLAGS_ON,
      currentUser: ownerUser,
      callableOverride: async (payload) => {
        if (payload.action === 'getQuarantineIsolatedInspectionRequest') {
          return { data: makeGetRecordedRequestResponse() };
        }
        if (payload.action === 'getQuarantineAvInspectionStatus') {
          return {
            data:
              unknownDispatchCalls > 0
                ? makeGetAvStatusResponse('AV_NO_THREAT_DETECTED', cleanExecDto)
                : makeGetAvStatusResponse('NOT_DISPATCHED', null),
          };
        }
        unknownDispatchCalls += 1;
        throw new Error('Network lost after dispatch request sent');
      },
    }
  );

  await unknownCtrl.loadRequest();
  await unknownCtrl.loadAvInspectionStatus();
  unknownCtrl.setConfirmedAvDispatch(true);

  const lostDisp = await unknownCtrl.dispatchAvInspection({
    expectedRequestId: REQUEST_ID_A,
    expectedSafetyCaseRevision: 1,
    acknowledgedHumanCaseRevision: 2,
  });
  assert.equal(lostDisp.ok, false);
  assert.equal(lostDisp.status, 'UNKNOWN');
  assert.equal(unknownCtrl.getState().avPhase, 'unknown');
  assert.equal(unknownDispatchCalls, 1);

  // Second dispatch while in 'unknown' is blocked with 0 network calls
  const blockedRetry = await unknownCtrl.dispatchAvInspection({
    expectedRequestId: REQUEST_ID_A,
    expectedSafetyCaseRevision: 1,
    acknowledgedHumanCaseRevision: 2,
  });
  assert.equal(blockedRetry.ok, false);
  assert.equal(unknownDispatchCalls, 1);

  // GET-only verification recovers terminal state
  await unknownCtrl.loadAvInspectionStatus();
  assert.equal(unknownCtrl.getState().avPhase, 'ready');
  assert.equal(
    unknownCtrl.getState().avStatusSnapshot?.status,
    'AV_NO_THREAT_DETECTED'
  );

  // =========================================================================
  // PASS 4: Panel Rendering — Default OFF Hides AV Subsection; ON Renders
  //         Exact AR/EN Status Labels, Warning Notice, and Zero Secret Leaks
  // =========================================================================
  const safetyCtrl = new LibraryQuarantineBinarySafetyCaseController(
    RECEIPT_ID_A,
    {
      envOverride: ALL_SIX_FLAGS_ON,
      currentUser: ownerUser,
      invokeCallable: async () => ({
        ok: true,
        status: 'READY',
        outcome: 'READY',
        receiptId: RECEIPT_ID_A,
        documentId: DOC_ID_A,
        sourceRevision: 2,
        sourceUpdatedAt: ISO_1,
        sourceFormat: 'PDF',
        deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER',
        catalogHandoffCaseRevision: 2,
        currentHumanCaseRevision: 2,
        effectiveHumanCaseRevision: 2,
        effectiveHumanCaseUpdatedAt: ISO_1,
        catalogUpdatedAt: ISO_1,
        currentRevision: 1,
        isCaseCurrent: true,
        requiresFreshEvidence: false,
        readiness: QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS,
        binarySafetyCase: makeSanitizedSafetyCaseDto(),
        isSanitized: false,
        isVerifiedSafe: false,
        isRightsApproved: false,
        isPublished: false,
        isReadyForPeia: false,
      }),
    }
  );
  await safetyCtrl.loadCase();

  // When 6th flag is OFF (ALL_FIVE_FLAGS_ON), isolated-av-execution-subsection is absent
  const fiveFlagsMarkup = renderToStaticMarkup(
    React.createElement(LibraryQuarantineBinarySafetyCasePanel, {
      receiptId: RECEIPT_ID_A,
      currentUser: ownerUser,
      lang: 'ar',
      controllerOverride: safetyCtrl,
      inspectionControllerOverride: unknownCtrl,
      savedReviewCase: makeSavedHumanReviewCase(),
      hasUnsavedCaseEdits: false,
      envOverride: ALL_FIVE_FLAGS_ON,
    })
  );
  assert.equal(
    fiveFlagsMarkup.includes('isolated-av-execution-subsection'),
    false
  );

  // When 6th flag is ON (ALL_SIX_FLAGS_ON), verify all required AR status labels & warning copy
  const statusScenarios: ReadonlyArray<
    readonly [
      | 'NOT_DISPATCHED'
      | 'DISPATCH_UNKNOWN'
      | 'RUNNING'
      | 'AV_NO_THREAT_DETECTED'
      | 'AV_THREAT_DETECTED'
      | 'AV_SCAN_FAILED',
      SanitizedLibraryQuarantineAvExecutionDto | null,
      string,
      string,
    ]
  > = [
    ['NOT_DISPATCHED', null, 'لم يُرسل', 'Not dispatched'],
    [
      'DISPATCH_UNKNOWN',
      makeSanitizedAvExecutionDto({ state: 'DISPATCH_UNKNOWN' }),
      'إرسال غير مؤكد/قيد الإطلاق',
      'Dispatch uncertain / launching',
    ],
    [
      'RUNNING',
      makeSanitizedAvExecutionDto({
        revision: 3,
        state: 'RUNNING',
        workerClaimedAt: ISO_2,
      }),
      'الفحص يعمل',
      'AV scan running',
    ],
    [
      'AV_NO_THREAT_DETECTED',
      cleanExecDto,
      'لم يُكتشف تهديد بواسطة AV',
      'No threat detected by AV',
    ],
    [
      'AV_THREAT_DETECTED',
      makeSanitizedAvExecutionDto({
        revision: 4,
        state: 'AV_THREAT_DETECTED',
        workerClaimedAt: ISO_2,
        completedAt: ISO_3,
        engineName: 'ClamAV',
        engineVersion: 'ClamAV 1.3.1/27455',
        signatureVersion: 'daily.cvd:27455',
        signatureUpdatedAt: ISO_1,
        scannedBytes: 32768,
        exitCode: 1,
        failureReasonCode: null,
      }),
      'رُصد تهديد',
      'Threat detected by AV',
    ],
    [
      'AV_SCAN_FAILED',
      makeSanitizedAvExecutionDto({
        revision: 4,
        state: 'AV_SCAN_FAILED',
        workerClaimedAt: ISO_2,
        completedAt: ISO_3,
        failureReasonCode: 'SCAN_EXECUTION_ERROR',
      }),
      'تعذر الفحص',
      'AV scan failed / held',
    ],
  ];

  for (const [status, execDto, expectedAr, expectedEn] of statusScenarios) {
    const scenarioCtrl =
      new LibraryQuarantineIsolatedInspectionRequestController(RECEIPT_ID_A, {
        envOverride: ALL_SIX_FLAGS_ON,
        currentUser: ownerUser,
        callableOverride: async (payload) => {
          if (payload.action === 'getQuarantineIsolatedInspectionRequest') {
            return { data: makeGetRecordedRequestResponse() };
          }
          return {
            data: makeGetAvStatusResponse(status, execDto),
          };
        },
      });
    await scenarioCtrl.loadRequest();
    await scenarioCtrl.loadAvInspectionStatus();

    const arMarkup = renderToStaticMarkup(
      React.createElement(LibraryQuarantineBinarySafetyCasePanel, {
        receiptId: RECEIPT_ID_A,
        currentUser: ownerUser,
        lang: 'ar',
        controllerOverride: safetyCtrl,
        inspectionControllerOverride: scenarioCtrl,
        savedReviewCase: makeSavedHumanReviewCase(),
        hasUnsavedCaseEdits: false,
        envOverride: ALL_SIX_FLAGS_ON,
      })
    );
    assert.equal(
      arMarkup.includes(expectedAr),
      true,
      `Missing AR label "${expectedAr}" for status ${status}`
    );
    assert.equal(
      arMarkup.includes(
        'سيتم إرسال الملف إلى فاحص AV معزول؛ نتيجة AV وحدها لا تسمح بنشر الملف'
      ),
      true
    );
    assert.equal(arMarkup.includes('storagePath'), false);
    assert.equal(arMarkup.includes('sourceSha256'), false);
    assert.equal(arMarkup.includes('sourceGeneration'), false);
    assert.equal(arMarkup.includes('workerRunId'), false);

    const enMarkup = renderToStaticMarkup(
      React.createElement(LibraryQuarantineBinarySafetyCasePanel, {
        receiptId: RECEIPT_ID_A,
        currentUser: ownerUser,
        lang: 'en',
        controllerOverride: safetyCtrl,
        inspectionControllerOverride: scenarioCtrl,
        savedReviewCase: makeSavedHumanReviewCase(),
        hasUnsavedCaseEdits: false,
        envOverride: ALL_SIX_FLAGS_ON,
      })
    );
    assert.equal(
      enMarkup.includes(expectedEn),
      true,
      `Missing EN label "${expectedEn}" for status ${status}`
    );
  }

  // Receipt switch resets AV state cleanly
  unknownCtrl.switchReceipt(RECEIPT_ID_B);
  assert.equal(unknownCtrl.getState().receiptId, RECEIPT_ID_B);
  assert.equal(unknownCtrl.getState().avStatusSnapshot, null);
  assert.equal(unknownCtrl.getState().avPhase, 'idle');

  // =========================================================================
  // PASS 5: PDF Inspection Failure Reason Codes Contract Parity & Fail-Closed
  //         Guarantees (Accept 5 PDF Codes in Failure States; Reject Unknowns
  //         and Non-Null Codes on AV_NO_THREAT_DETECTED / AV_THREAT_DETECTED)
  // =========================================================================
  const expectedPdfFailureReasonCodes: ReadonlyArray<LibraryQuarantineAvExecutionFailureReasonCode> =
    [
      'PDF_PARSER_BINARY_MISSING',
      'PDF_ENCRYPTED_OR_MALFORMED',
      'PDF_ACTIVE_CONTENT_OR_UNSAFE_STRUCTURE',
      'PDF_INSPECTION_TIMEOUT',
      'PDF_INSPECTION_FAILED',
    ];

  assert.equal(LIBRARY_QUARANTINE_AV_EXECUTION_FAILURE_REASON_CODES.length, 23);
  for (const pdfCode of expectedPdfFailureReasonCodes) {
    assert.equal(
      LIBRARY_QUARANTINE_AV_EXECUTION_FAILURE_REASON_CODES.includes(pdfCode),
      true,
      `Missing PDF failure reason code in client list: ${pdfCode}`
    );

    const failedPdfDto = makeSanitizedAvExecutionDto({
      revision: 4,
      state: 'AV_SCAN_FAILED',
      workerClaimedAt: ISO_2,
      completedAt: ISO_3,
      failureReasonCode: pdfCode,
    });

    const dtoCheck = validateSanitizedAvExecutionDto(failedPdfDto, RECEIPT_ID_A);
    assert.equal(
      dtoCheck.ok,
      true,
      `validateSanitizedAvExecutionDto must accept PDF failure code ${pdfCode}`
    );
    if (dtoCheck.ok) {
      assert.equal(dtoCheck.value.state, 'AV_SCAN_FAILED');
      assert.equal(dtoCheck.value.failureReasonCode, pdfCode);
      assert.equal(dtoCheck.value.isSanitized, false);
      assert.equal(dtoCheck.value.isVerifiedSafe, false);
      assert.equal(dtoCheck.value.isRightsApproved, false);
      assert.equal(dtoCheck.value.isPublished, false);
      assert.equal(dtoCheck.value.isReadyForPeia, false);
    }

    const statusPayload = makeGetAvStatusResponse('AV_SCAN_FAILED', failedPdfDto);
    const statusCheck = validateGetQuarantineAvInspectionStatusResponseDto(
      statusPayload,
      RECEIPT_ID_A
    );
    assert.equal(
      statusCheck.ok,
      true,
      `GET AV status validator must accept PDF failure code ${pdfCode}`
    );
    if (statusCheck.ok && statusCheck.value.ok) {
      assert.equal(statusCheck.value.status, 'AV_SCAN_FAILED');
      assert.equal(statusCheck.value.execution?.failureReasonCode, pdfCode);
      assert.equal(statusCheck.value.isSanitized, false);
      assert.equal(statusCheck.value.isVerifiedSafe, false);
      assert.equal(statusCheck.value.isRightsApproved, false);
      assert.equal(statusCheck.value.isPublished, false);
      assert.equal(statusCheck.value.isReadyForPeia, false);
      assert.equal(statusCheck.value.readiness.binarySafety, 'NOT_VERIFIED');
      assert.equal(
        statusCheck.value.readiness.fileSanitization,
        'NOT_PERFORMED'
      );
      assert.equal(statusCheck.value.readiness.publication, 'BLOCKED');
      assert.equal(statusCheck.value.readiness.catalogWorkflow, 'Draft');
    }

    const pdfFailCtrl = new LibraryQuarantineIsolatedInspectionRequestController(
      RECEIPT_ID_A,
      {
        envOverride: ALL_SIX_FLAGS_ON,
        currentUser: ownerUser,
        callableOverride: async (payload) => {
          if (payload.action === 'getQuarantineIsolatedInspectionRequest') {
            return { data: makeGetRecordedRequestResponse() };
          }
          return { data: statusPayload };
        },
      }
    );
    await pdfFailCtrl.loadRequest();
    const loadRes = await pdfFailCtrl.loadAvInspectionStatus();
    assert.equal(loadRes.ok, true);
    assert.equal(pdfFailCtrl.getState().avPhase, 'ready');
    assert.equal(pdfFailCtrl.getState().avHoldState, null);
    assert.equal(
      pdfFailCtrl.getState().avStatusSnapshot?.status,
      'AV_SCAN_FAILED'
    );
    assert.equal(
      pdfFailCtrl.getState().avStatusSnapshot?.execution?.failureReasonCode,
      pdfCode
    );

    // Failure state with PDF code must NOT convert into clean/published flags
    for (const escalatedFlag of [
      { isSanitized: true },
      { isVerifiedSafe: true },
      { isRightsApproved: true },
      { isPublished: true },
      { isReadyForPeia: true },
    ]) {
      assert.equal(
        validateSanitizedAvExecutionDto(
          { ...failedPdfDto, ...escalatedFlag },
          RECEIPT_ID_A
        ).ok,
        false,
        `Failure state ${pdfCode} must reject escalated flag ${JSON.stringify(escalatedFlag)}`
      );
      assert.equal(
        validateGetQuarantineAvInspectionStatusResponseDto(
          {
            ...makeGetAvStatusResponse('AV_SCAN_FAILED', failedPdfDto),
            ...escalatedFlag,
          },
          RECEIPT_ID_A
        ).ok,
        false,
        `GET AV status with ${pdfCode} must reject escalated flag ${JSON.stringify(escalatedFlag)}`
      );
    }

    // AV_NO_THREAT_DETECTED and AV_THREAT_DETECTED must reject non-null PDF failureReasonCode
    assert.equal(
      validateSanitizedAvExecutionDto(
        { ...cleanExecDto, failureReasonCode: pdfCode as unknown as null },
        RECEIPT_ID_A
      ).ok,
      false,
      `AV_NO_THREAT_DETECTED must reject non-null failureReasonCode ${pdfCode}`
    );
    assert.equal(
      validateSanitizedAvExecutionDto(
        {
          ...cleanExecDto,
          state: 'AV_THREAT_DETECTED',
          exitCode: 1,
          failureReasonCode: pdfCode as unknown as null,
        },
        RECEIPT_ID_A
      ).ok,
      false,
      `AV_THREAT_DETECTED must reject non-null failureReasonCode ${pdfCode}`
    );
  }

  // Reject unknown/arbitrary failureReasonCode and fail closed to MALFORMED_SERVER_RESPONSE_HOLD
  for (const unknownCode of [
    'UNKNOWN_PDF_FAILURE_CODE',
    'ARBITRARY_REASON_CODE',
    '',
  ]) {
    const unknownDto = {
      ...makeSanitizedAvExecutionDto({
        revision: 4,
        state: 'AV_SCAN_FAILED',
        workerClaimedAt: ISO_2,
        completedAt: ISO_3,
      }),
      failureReasonCode: unknownCode,
    };

    assert.equal(
      validateSanitizedAvExecutionDto(unknownDto, RECEIPT_ID_A).ok,
      false,
      `validateSanitizedAvExecutionDto must reject unknown failureReasonCode "${unknownCode}"`
    );

    const malformedPayload = {
      ...makeGetAvStatusResponse('AV_SCAN_FAILED', null),
      execution: unknownDto,
    };
    assert.equal(
      validateGetQuarantineAvInspectionStatusResponseDto(
        malformedPayload,
        RECEIPT_ID_A
      ).ok,
      false,
      `GET AV status validator must reject unknown failureReasonCode "${unknownCode}"`
    );

    const holdCtrl = new LibraryQuarantineIsolatedInspectionRequestController(
      RECEIPT_ID_A,
      {
        envOverride: ALL_SIX_FLAGS_ON,
        currentUser: ownerUser,
        callableOverride: async (payload) => {
          if (payload.action === 'getQuarantineIsolatedInspectionRequest') {
            return { data: makeGetRecordedRequestResponse() };
          }
          return { data: malformedPayload };
        },
      }
    );
    await holdCtrl.loadRequest();
    const holdRes = await holdCtrl.loadAvInspectionStatus();
    assert.equal(holdRes.ok, false);
    if (!holdRes.ok) {
      assert.equal(holdRes.errorCode, 'MALFORMED_SERVER_RESPONSE_HOLD');
    }
    assert.equal(holdCtrl.getState().avPhase, 'hold');
    assert.equal(
      holdCtrl.getState().avHoldState?.errorCode,
      'MALFORMED_SERVER_RESPONSE_HOLD'
    );
    assert.equal(holdCtrl.getState().avStatusSnapshot, null);
  }

  // =========================================================================
  // PASS 6: Published Binary Hold Guidance & Non-Mislabeled AV_SCAN_FAILED UI
  // =========================================================================
  const allGuidedHoldCodes = [
    'PDF_PARSER_BINARY_MISSING',
    'PDF_ENCRYPTED_OR_MALFORMED',
    'PDF_ACTIVE_CONTENT_OR_UNSAFE_STRUCTURE',
    'PDF_INSPECTION_TIMEOUT',
    'PDF_INSPECTION_FAILED',
    'PDF_INSPECTION_ATTESTATION_MISSING_OR_INVALID',
  ] as const;

  for (const code of allGuidedHoldCodes) {
    const arGuidance = formatLibraryQuarantineHoldGuidance(code, 'AV_SCAN_FAILED', true);
    const enGuidance = formatLibraryQuarantineHoldGuidance(code, 'AV_SCAN_FAILED', false);
    assert.equal(typeof arGuidance === 'string' && arGuidance.length > 20, true, `AR guidance missing for ${code}`);
    assert.equal(typeof enGuidance === 'string' && enGuidance.length > 20, true, `EN guidance missing for ${code}`);
  }
  assert.equal(
    typeof formatLibraryQuarantineHoldGuidance(null, 'AV_THREAT_DETECTED', true) === 'string',
    true
  );
  assert.equal(
    typeof formatLibraryQuarantineHoldGuidance(null, 'AV_SCAN_FAILED', false) === 'string',
    true
  );

  // Verify LibraryQuarantinePublishedBinaryReleaseSection renders hold guidance for AV_SCAN_FAILED
  // WITHOUT mislabeling it as "waiting for actual AV scan" and keeps publish disabled
  const failedBinaryReleaseCtrl = new LibraryQuarantinePublishedBinaryReleasePanelController(
    ownerUser,
    {
      enabled: true,
      api: {
        getPublishedLibraryBinaryReleaseStatus: async () =>
          ({
            ok: true,
            status: 'HELD',
            outcome: 'HELD',
            receiptId: RECEIPT_ID_A,
            qcatDocumentId: DOC_ID_A,
            quarantineCatalogDocumentId: DOC_ID_A,
            quarantineDraftWorkflowState: 'Draft',
            publicDocumentId: `doc-qbin-${RECEIPT_ID_A}`,
            sourceRevision: 2,
            format: 'PDF',
            byteSize: 32768,
            suggestedDownloadFilename: 'report.pdf',
            sourceFormat: 'PDF',
            sourceByteSize: 32768,
            catalogAligned: true,
            effectiveAlignedCaseRevision: 2,
            effectiveHumanCaseRevision: 2,
            rightsDecisionRevision: 1,
            rightsDecisionStatus: 'OPEN_PUBLIC_RELEASE_CLEARED',
            rightsDecisionBasis: 'OFFICIAL_RECORD',
            requiresContradictionResolution: false,
            currentPriorRightsDecision: null,
            binarySafetyCaseRevision: 1,
            binarySafetyDisposition: 'ISOLATED_ASSESSMENT_REQUIRED',
            avExecutionRequestId: REQUEST_ID_A,
            avExecutionState: 'AV_SCAN_FAILED',
            avFailureReasonCode: 'PDF_ACTIVE_CONTENT_OR_UNSAFE_STRUCTURE',
            isScanCleanForCurrentRevision: false,
            isPublished: false,
            eligibleForPublish: false,
            blockCode: 'PDF_ACTIVE_CONTENT_OR_UNSAFE_STRUCTURE',
            blockMessage: 'Held by isolated PDF inspection',
            publishedRelease: null,
            releaseRecord: null,
            publicDocument: null,
            readiness: {
              binarySafety: 'NOT_VERIFIED',
              fileSanitization: 'NOT_PERFORMED',
              publication: 'BLOCKED',
              catalogWorkflow: 'Draft',
            },
            isSanitized: false,
            isVerifiedSafe: false,
            isRightsApproved: false,
            isReadyForPeia: false,
          }) as any,
        publishQuarantinedBinaryToPublicLibrary: async () => {
          throw new Error('Publish must not be called when AV_SCAN_FAILED');
        },
      },
    }
  );
  await failedBinaryReleaseCtrl.openForSavedCase(makeSavedHumanReviewCase());

  const heldBinaryMarkupAr = renderToStaticMarkup(
    React.createElement(LibraryQuarantinePublishedBinaryReleaseSection, {
      controller: failedBinaryReleaseCtrl,
      currentUser: ownerUser,
      savedReviewCase: makeSavedHumanReviewCase(),
      hasUnsavedCaseEdits: false,
      isAr: true,
      envOverride: {
        ...ALL_SIX_FLAGS_ON,
        VITE_LIBRARY_RIGHTS_DECISION_ENABLED: 'true',
        VITE_LIBRARY_PUBLISHED_BINARY_RELEASE_ENABLED: 'true',
      },
    })
  );
  assert.equal(
    heldBinaryMarkupAr.includes('published-binary-release-hold-guidance'),
    true,
    'Hold guidance banner must render when AV_SCAN_FAILED / PDF failure code is present'
  );
  assert.equal(
    heldBinaryMarkupAr.includes('بانتظار نتيجة فحص ClamAV'),
    false,
    'AV_SCAN_FAILED must NOT be mislabeled as waiting for actual AV scan'
  );

  console.log(
    'ALL LIB-FILE-ISOLATED-AV-EXECUTION-M1 CLIENT TESTS PASSED (6/6).'
  );
}

runClientTests().catch((err) => {
  console.error('Isolated AV execution client tests failed:', err);
  process.exit(1);
});
