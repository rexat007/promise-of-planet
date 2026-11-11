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
  LIBRARY_ISOLATED_INSPECTION_REQUEST_UI_ENV_VAR,
  LIBRARY_QUARANTINE_ISOLATED_INSPECTION_CONFIRMATION_LITERAL,
  LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_SCHEMA_VERSION,
  LIBRARY_QUARANTINE_ISOLATED_INSPECTION_REQUEST_STATE,
  LibraryQuarantineIsolatedInspectionRequestController,
  QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
  canUserRecordIsolatedInspectionRequest,
  deriveLibraryQuarantineIsolatedInspectionRequestId,
  isLibraryQuarantineIsolatedInspectionRequestEnabled,
  validateGetIsolatedInspectionRequestResponseDto,
  validateRecordIsolatedInspectionRequestResponseDto,
  validateSanitizedIsolatedInspectionRequestDto,
  type SanitizedLibraryQuarantineIsolatedInspectionRequestDto,
} from '../src/services/libraryQuarantineIsolatedInspectionRequestClient';
import { LibraryQuarantineBinarySafetyCasePanel } from '../src/components/library/LibraryQuarantineBinarySafetyCasePanel';

const RECEIPT_ID_A = '0123456789abcdef0123456789abcdef';
const RECEIPT_ID_B = 'fedcba9876543210fedcba9876543210';
const DOC_ID_A = `qcat-${RECEIPT_ID_A}`;
const REQUEST_ID_A = `${RECEIPT_ID_A}_2_1`;
const ISO_1 = '2026-11-11T10:00:00.000Z';
const ISO_2 = '2026-11-11T10:05:00.000Z';

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

function makeGetNotRecordedResponse(
  overrides?: Record<string, unknown>
): Record<string, unknown> {
  return {
    ok: true,
    status: 'NOT_RECORDED',
    outcome: 'NOT_RECORDED',
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
    inspectionRequest: null,
    dispatched: false,
    scanPerformed: false,
    sanitized: false,
    isSanitized: false,
    isVerifiedSafe: false,
    isRightsApproved: false,
    isPublished: false,
    isReadyForPeia: false,
    ...overrides,
  };
}

function makeRecordSuccessResponse(
  status: 'RECORDED' | 'ALREADY_RECORDED' = 'RECORDED'
): Record<string, unknown> {
  const req = makeSanitizedInspectionRequestDto();
  return {
    ok: true,
    status,
    outcome: status,
    requestOutcome: status,
    requestRecorded: true,
    receiptId: RECEIPT_ID_A,
    documentId: DOC_ID_A,
    requestId: req.requestId,
    sourceRevision: req.sourceRevision,
    sourceUpdatedAt: req.sourceUpdatedAt,
    sourceFormat: req.sourceFormat,
    deepInspectionStatus: req.deepInspectionStatus,
    safetyCaseRevision: req.safetyCaseRevision,
    effectiveHumanCaseRevision: req.effectiveHumanCaseRevision,
    catalogUpdatedAt: req.catalogUpdatedAt,
    readiness: QUARANTINE_ISOLATED_INSPECTION_READINESS_INDICATORS,
    inspectionRequest: req,
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

async function runClientTests(): Promise<void> {
  console.log(
    'STARTING LIB-FILE-ISOLATED-INSPECTION-REQUEST-01 CLIENT TESTS...'
  );

  // =========================================================================
  // PASS 1: 5-Flag UI Release Gate (Default OFF) & Owner-Only RBAC
  // =========================================================================
  assert.equal(
    LIBRARY_ISOLATED_INSPECTION_REQUEST_UI_ENV_VAR,
    'VITE_LIBRARY_ISOLATED_INSPECTION_REQUEST_ENABLED'
  );
  assert.equal(
    isLibraryQuarantineIsolatedInspectionRequestEnabled(ALL_FIVE_FLAGS_ON),
    true
  );
  assert.equal(isLibraryQuarantineIsolatedInspectionRequestEnabled({}), false);
  assert.equal(
    isLibraryQuarantineIsolatedInspectionRequestEnabled({
      ...ALL_FIVE_FLAGS_ON,
      VITE_LIBRARY_ISOLATED_INSPECTION_REQUEST_ENABLED: 'false',
    }),
    false
  );
  assert.equal(
    isLibraryQuarantineIsolatedInspectionRequestEnabled({
      ...ALL_FIVE_FLAGS_ON,
      VITE_LIBRARY_BINARY_SAFETY_CASE_ENABLED: 'false',
    }),
    false
  );

  assert.equal(canUserRecordIsolatedInspectionRequest(ownerUser), true);
  assert.equal(canUserRecordIsolatedInspectionRequest(inactiveOwnerUser), false);
  assert.equal(canUserRecordIsolatedInspectionRequest(curatorUser), false);
  assert.equal(
    canUserRecordIsolatedInspectionRequest(rightsReviewerUser),
    false
  );
  assert.equal(canUserRecordIsolatedInspectionRequest(null), false);
  assert.equal(
    canUserRecordIsolatedInspectionRequest({
      ...ownerUser,
      permissions: [AdminPermission.View],
    } as AdminUser),
    false
  );

  // =========================================================================
  // PASS 2: Strict 19-Field DTO & Envelope Validators (Reject Secrets/True Flags)
  // =========================================================================
  const validReqDto = makeSanitizedInspectionRequestDto();
  assert.equal(
    validateSanitizedIsolatedInspectionRequestDto(validReqDto, RECEIPT_ID_A).ok,
    true
  );

  // Reject leaked private fields or true security posture flags
  for (const badOverride of [
    { sourceSha256: 'a'.repeat(64) },
    { sourceGeneration: '1731300000001' },
    { sourceByteSize: 32768 },
    { requestedBy: 'owner_01' },
    { storagePath: 'library/quarantine/secret.pdf' },
    { dispatched: true },
    { scanPerformed: true },
    { sanitized: true },
    { isVerifiedSafe: true },
    { state: 'DISPATCHED' },
  ]) {
    assert.equal(
      validateSanitizedIsolatedInspectionRequestDto({
        ...validReqDto,
        ...badOverride,
      }).ok,
      false,
      `DTO validator failed to reject override: ${JSON.stringify(badOverride)}`
    );
  }

  assert.equal(
    validateGetIsolatedInspectionRequestResponseDto(
      makeGetNotRecordedResponse(),
      RECEIPT_ID_A
    ).ok,
    true
  );
  assert.equal(
    validateGetIsolatedInspectionRequestResponseDto(
      makeGetNotRecordedResponse({
        status: 'RECORDED',
        outcome: 'RECORDED',
        inspectionRequest: validReqDto,
      }),
      RECEIPT_ID_A
    ).ok,
    true
  );
  assert.equal(
    validateRecordIsolatedInspectionRequestResponseDto(
      makeRecordSuccessResponse('RECORDED'),
      RECEIPT_ID_A
    ).ok,
    true
  );
  assert.equal(
    validateRecordIsolatedInspectionRequestResponseDto(
      makeRecordSuccessResponse('ALREADY_RECORDED'),
      RECEIPT_ID_A
    ).ok,
    true
  );

  // =========================================================================
  // PASS 3: Controller Guards (Confirmation Checkbox, Dirty Case Lock, Stale
  //         Safety Case Lock, Non-Eligible Disposition Lock, Idempotent Record)
  // =========================================================================
  let callableInvocations = 0;
  let recordedOnServer = false;

  const inspectionCtrl = new LibraryQuarantineIsolatedInspectionRequestController(
    RECEIPT_ID_A,
    {
      envOverride: ALL_FIVE_FLAGS_ON,
      currentUser: ownerUser,
      callableOverride: async (payload) => {
        callableInvocations += 1;
        if (payload.action === 'getQuarantineIsolatedInspectionRequest') {
          return {
            data: recordedOnServer
              ? makeGetNotRecordedResponse({
                  status: 'RECORDED',
                  outcome: 'RECORDED',
                  inspectionRequest: makeSanitizedInspectionRequestDto(),
                })
              : makeGetNotRecordedResponse(),
          };
        }
        if (payload.action === 'recordQuarantineIsolatedInspectionRequest') {
          assert.equal(
            payload.confirmation,
            LIBRARY_QUARANTINE_ISOLATED_INSPECTION_CONFIRMATION_LITERAL
          );
          const firstTime = !recordedOnServer;
          recordedOnServer = true;
          return {
            data: makeRecordSuccessResponse(
              firstTime ? 'RECORDED' : 'ALREADY_RECORDED'
            ),
          };
        }
        return { data: { ok: false } };
      },
    }
  );

  await inspectionCtrl.loadRequest();
  assert.equal(inspectionCtrl.getState().phase, 'ready');
  assert.equal(inspectionCtrl.getState().snapshot?.status, 'NOT_RECORDED');

  const callsBeforeGuards = callableInvocations;

  // Guard 1: Unchecked confirmation checkbox -> blocked with 0 backend calls
  const unconfirmedRes = await inspectionCtrl.recordRequest({
    expectedSafetyCaseRevision: 1,
    acknowledgedHumanCaseRevision: 2,
  });
  assert.equal(unconfirmedRes.ok, false);
  if (!unconfirmedRes.ok && unconfirmedRes.status === 'HOLD') {
    assert.equal(
      unconfirmedRes.errorCode,
      'CONFIRMATION_LITERAL_REQUIRED_HOLD'
    );
  }
  assert.equal(callableInvocations, callsBeforeGuards);

  inspectionCtrl.setConfirmedRequestOnly(true);

  // Guard 2: Dirty human review case edits -> blocked with 0 backend calls
  const dirtyRes = await inspectionCtrl.recordRequest({
    expectedSafetyCaseRevision: 1,
    acknowledgedHumanCaseRevision: 2,
    hasUnsavedCaseEdits: true,
  });
  assert.equal(dirtyRes.ok, false);
  if (!dirtyRes.ok && dirtyRes.status === 'HOLD') {
    assert.equal(dirtyRes.errorCode, 'DIRTY_HUMAN_CASE_EDITS_HOLD');
  }
  assert.equal(callableInvocations, callsBeforeGuards);

  // Guard 3: Stale binary safety case -> blocked with 0 backend calls
  const staleRes = await inspectionCtrl.recordRequest({
    expectedSafetyCaseRevision: 1,
    acknowledgedHumanCaseRevision: 2,
    isSafetyCaseStale: true,
  });
  assert.equal(staleRes.ok, false);
  if (!staleRes.ok && staleRes.status === 'HOLD') {
    assert.equal(staleRes.errorCode, 'STALE_BINARY_SAFETY_CASE_HOLD');
  }
  assert.equal(callableInvocations, callsBeforeGuards);

  // Guard 4: Non-eligible disposition -> blocked with 0 backend calls
  const badDispRes = await inspectionCtrl.recordRequest({
    expectedSafetyCaseRevision: 1,
    acknowledgedHumanCaseRevision: 2,
    safetyCaseDisposition: 'DO_NOT_PROCESS',
  });
  assert.equal(badDispRes.ok, false);
  if (!badDispRes.ok && badDispRes.status === 'HOLD') {
    assert.equal(
      badDispRes.errorCode,
      'BINARY_SAFETY_DISPOSITION_NOT_ELIGIBLE_HOLD'
    );
  }
  assert.equal(callableInvocations, callsBeforeGuards);

  // Valid record call -> RECORDED
  const recordedRes = await inspectionCtrl.recordRequest({
    expectedSafetyCaseRevision: 1,
    acknowledgedHumanCaseRevision: 2,
    safetyCaseDisposition: 'ISOLATED_ASSESSMENT_REQUIRED',
  });
  assert.equal(recordedRes.ok, true);
  assert.equal(inspectionCtrl.getState().snapshot?.status, 'RECORDED');
  assert.equal(
    inspectionCtrl.getState().snapshot?.inspectionRequest?.requestId,
    deriveLibraryQuarantineIsolatedInspectionRequestId(RECEIPT_ID_A, 2, 1)
  );
  assert.equal(inspectionCtrl.getState().confirmedRequestOnly, false);

  // =========================================================================
  // PASS 4: Receipt Switching Reset & UNKNOWN GET-Only Recovery (No Auto-Retry)
  // =========================================================================
  inspectionCtrl.switchReceipt(RECEIPT_ID_B);
  assert.equal(inspectionCtrl.getState().receiptId, RECEIPT_ID_B);
  assert.equal(inspectionCtrl.getState().snapshot, null);

  let unknownRecordAttempts = 0;
  const unknownInspectionCtrl =
    new LibraryQuarantineIsolatedInspectionRequestController(RECEIPT_ID_A, {
      envOverride: ALL_FIVE_FLAGS_ON,
      currentUser: ownerUser,
      callableOverride: async (payload) => {
        if (payload.action === 'getQuarantineIsolatedInspectionRequest') {
          return {
            data:
              unknownRecordAttempts > 0
                ? makeGetNotRecordedResponse({
                    status: 'RECORDED',
                    outcome: 'RECORDED',
                    inspectionRequest: makeSanitizedInspectionRequestDto(),
                  })
                : makeGetNotRecordedResponse(),
          };
        }
        unknownRecordAttempts += 1;
        throw new Error('Network connection lost after request sent');
      },
    });

  await unknownInspectionCtrl.loadRequest();
  unknownInspectionCtrl.setConfirmedRequestOnly(true);
  const uncertainRes = await unknownInspectionCtrl.recordRequest({
    expectedSafetyCaseRevision: 1,
    acknowledgedHumanCaseRevision: 2,
  });
  assert.equal(uncertainRes.ok, false);
  assert.equal(uncertainRes.status, 'UNKNOWN');
  if (!uncertainRes.ok && uncertainRes.status === 'UNKNOWN') {
    assert.equal(uncertainRes.requestRecorded, null);
    assert.equal(uncertainRes.errorCode, 'TRANSACTION_COMMIT_UNCERTAIN');
  }
  assert.equal(unknownInspectionCtrl.getState().phase, 'unknown');
  assert.equal(unknownRecordAttempts, 1);

  // Second attempt while in 'unknown' phase is blocked until GET-only verify
  const blockedInUnknown = await unknownInspectionCtrl.recordRequest({
    expectedSafetyCaseRevision: 1,
    acknowledgedHumanCaseRevision: 2,
  });
  assert.equal(blockedInUnknown.ok, false);
  if (!blockedInUnknown.ok && blockedInUnknown.status === 'HOLD') {
    assert.equal(
      blockedInUnknown.errorCode,
      'UNKNOWN_COMMIT_REQUIRES_GET_VERIFY'
    );
  }
  assert.equal(unknownRecordAttempts, 1);

  // GET-only recovery resolves state to RECORDED
  await unknownInspectionCtrl.loadRequest();
  assert.equal(unknownInspectionCtrl.getState().phase, 'ready');
  assert.equal(unknownInspectionCtrl.getState().snapshot?.status, 'RECORDED');

  // =========================================================================
  // PASS 5: Bilingual AR/EN Panel Render with Secondary Isolated Inspection
  //         Section, Non-Dispatch Notice, Status Badges, and Zero Secret Leaks
  // =========================================================================
  const safetyCtrl = new LibraryQuarantineBinarySafetyCaseController(
    RECEIPT_ID_A,
    {
      envOverride: ALL_FIVE_FLAGS_ON,
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

  const arRecordedMarkup = renderToStaticMarkup(
    React.createElement(LibraryQuarantineBinarySafetyCasePanel, {
      receiptId: RECEIPT_ID_A,
      currentUser: ownerUser,
      lang: 'ar',
      controllerOverride: safetyCtrl,
      inspectionControllerOverride: unknownInspectionCtrl,
      savedReviewCase: makeSavedHumanReviewCase(),
      hasUnsavedCaseEdits: false,
      envOverride: ALL_FIVE_FLAGS_ON,
    })
  );

  assert.equal(
    arRecordedMarkup.includes('إحالة إلى فحص معزول — تسجيل فقط'),
    true
  );
  assert.equal(
    arRecordedMarkup.includes(
      'تم تسجيل طلب الفحص فقط — لم يُرسل إلى عامل فحص ولم يبدأ أي فحص تقني'
    ),
    true
  );
  assert.equal(
    arRecordedMarkup.includes('طُلب ولم يُرسل لعامل فحص'),
    true
  );
  assert.equal(
    arRecordedMarkup.includes(
      'أؤكد طلب الفحص لهذه النسخة؛ لا يعني هذا تشغيل الفحص أو اعتماده'
    ),
    true
  );
  assert.equal(arRecordedMarkup.includes(REQUEST_ID_A), true);
  assert.equal(arRecordedMarkup.includes('RECORDED_NOT_DISPATCHED'), true);
  assert.equal(arRecordedMarkup.includes('https://'), false);
  assert.equal(arRecordedMarkup.includes('storagePath'), false);
  assert.equal(arRecordedMarkup.includes('sourceGeneration'), false);
  assert.equal(arRecordedMarkup.includes('sourceSha256'), false);

  const enRecordedMarkup = renderToStaticMarkup(
    React.createElement(LibraryQuarantineBinarySafetyCasePanel, {
      receiptId: RECEIPT_ID_A,
      currentUser: ownerUser,
      lang: 'en',
      controllerOverride: safetyCtrl,
      inspectionControllerOverride: unknownInspectionCtrl,
      savedReviewCase: makeSavedHumanReviewCase(),
      hasUnsavedCaseEdits: false,
      envOverride: ALL_FIVE_FLAGS_ON,
    })
  );

  assert.equal(
    enRecordedMarkup.includes('Isolated inspection — record request only'),
    true
  );
  assert.equal(
    enRecordedMarkup.includes('Requested — not dispatched to worker'),
    true
  );
  assert.equal(
    enRecordedMarkup.includes('record-isolated-inspection-request-btn'),
    true
  );

  console.log(
    'ALL LIB-FILE-ISOLATED-INSPECTION-REQUEST-01 CLIENT TESTS PASSED (5/5).'
  );
}

runClientTests().catch((err) => {
  console.error('Isolated inspection client tests failed:', err);
  process.exit(1);
});
