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
  LIBRARY_BINARY_SAFETY_CASE_UI_ENV_VAR,
  LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_SCHEMA_VERSION,
  LIBRARY_QUARANTINE_BINARY_SAFETY_DISPOSITIONS,
  LibraryQuarantineBinarySafetyCaseController,
  QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS,
  canUserManageBinarySafetyCases,
  isLibraryQuarantineBinarySafetyCaseEnabled,
  validateClientBinarySafetyCaseInput,
  validateGetQuarantineBinarySafetyCaseResponseDto,
  validateReadinessIndicatorsDto,
  validateSanitizedBinarySafetyCaseDto,
  validateSaveQuarantineBinarySafetyCaseResponseDto,
  type SanitizedLibraryQuarantineBinarySafetyCaseDto,
} from '../src/services/libraryQuarantineBinarySafetyCaseClient';
import { LibraryQuarantineBinarySafetyCasePanel } from '../src/components/library/LibraryQuarantineBinarySafetyCasePanel';

const RECEIPT_ID_A = '0123456789abcdef0123456789abcdef';
const RECEIPT_ID_B = 'fedcba9876543210fedcba9876543210';
const DOC_ID_A = `qcat-${RECEIPT_ID_A}`;
const ISO_1 = '2026-11-10T10:00:00.000Z';
const ISO_2 = '2026-11-10T10:05:00.000Z';

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

const ALL_FLAGS_ON = Object.freeze({
  VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED: 'true',
  VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED: 'true',
  VITE_LIBRARY_CATALOG_HANDOFF_ENABLED: 'true',
  VITE_LIBRARY_BINARY_SAFETY_CASE_ENABLED: 'true',
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

function makeReadyGetResponse(
  overrides?: Record<string, unknown>
): Record<string, unknown> {
  return {
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
    currentRevision: 0,
    isCaseCurrent: true,
    requiresFreshEvidence: false,
    readiness: QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS,
    binarySafetyCase: null,
    isSanitized: false,
    isVerifiedSafe: false,
    isRightsApproved: false,
    isPublished: false,
    isReadyForPeia: false,
    ...overrides,
  };
}

async function runClientTests(): Promise<void> {
  console.log('STARTING LIB-FILE-BINARY-SAFETY-CASE-R1 CLIENT TESTS...');

  // =========================================================================
  // PASS 1: 4-Flag UI Release Gate & Owner-Only RBAC
  // =========================================================================
  assert.equal(
    LIBRARY_BINARY_SAFETY_CASE_UI_ENV_VAR,
    'VITE_LIBRARY_BINARY_SAFETY_CASE_ENABLED'
  );
  assert.equal(isLibraryQuarantineBinarySafetyCaseEnabled(ALL_FLAGS_ON), true);
  assert.equal(isLibraryQuarantineBinarySafetyCaseEnabled({}), false);
  assert.equal(
    isLibraryQuarantineBinarySafetyCaseEnabled({
      ...ALL_FLAGS_ON,
      VITE_LIBRARY_BINARY_SAFETY_CASE_ENABLED: 'false',
    }),
    false
  );

  assert.equal(canUserManageBinarySafetyCases(ownerUser), true);
  assert.equal(canUserManageBinarySafetyCases(inactiveOwnerUser), false);
  assert.equal(canUserManageBinarySafetyCases(curatorUser), false);
  assert.equal(canUserManageBinarySafetyCases(rightsReviewerUser), false);
  assert.equal(canUserManageBinarySafetyCases(null), false);
  assert.equal(
    canUserManageBinarySafetyCases({
      ...ownerUser,
      permissions: [AdminPermission.View],
    } as AdminUser),
    false
  );

  // =========================================================================
  // PASS 2: Strict DTO & Editorial Input Validators
  // =========================================================================
  assert.notEqual(
    validateReadinessIndicatorsDto(QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS),
    null
  );
  assert.equal(
    validateReadinessIndicatorsDto({
      ...QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS,
      binarySafety: 'VERIFIED',
    }),
    null
  );

  const validCaseDto = makeSanitizedSafetyCaseDto();
  assert.notEqual(
    validateSanitizedBinarySafetyCaseDto(validCaseDto, RECEIPT_ID_A),
    null
  );
  // Reject leaked sourceSha256 or true posture flag or unknown sourceFormat
  assert.equal(
    validateSanitizedBinarySafetyCaseDto({
      ...validCaseDto,
      sourceSha256: 'a'.repeat(64),
    }),
    null
  );
  assert.equal(
    validateSanitizedBinarySafetyCaseDto({
      ...validCaseDto,
      isVerifiedSafe: true,
    }),
    null
  );
  assert.equal(
    validateSanitizedBinarySafetyCaseDto({
      ...validCaseDto,
      sourceFormat: 'unknown',
    }),
    null
  );

  assert.notEqual(
    validateGetQuarantineBinarySafetyCaseResponseDto(
      makeReadyGetResponse(),
      RECEIPT_ID_A
    ),
    null
  );
  assert.equal(
    validateGetQuarantineBinarySafetyCaseResponseDto({
      ...makeReadyGetResponse(),
      storagePath: 'library/quarantine/secret.pdf',
    }),
    null
  );

  assert.equal(
    validateClientBinarySafetyCaseInput({
      disposition: 'EXTERNAL_REPORT_NOT_VERIFIED',
      evidenceReference: '',
      evidenceNotes: 'Missing reference',
    }).ok,
    false
  );
  assert.equal(
    validateClientBinarySafetyCaseInput({
      disposition: 'DO_NOT_PROCESS',
      evidenceReference: 'REF-1',
      evidenceNotes: 'Note',
      reviewNotes: '',
    }).ok,
    false
  );
  assert.equal(
    validateClientBinarySafetyCaseInput({
      disposition: 'ISOLATED_ASSESSMENT_REQUIRED',
      evidenceReference: '<script>alert(1)</script>',
      evidenceNotes: 'Note',
    }).ok,
    false
  );

  // =========================================================================
  // PASS 3: Controller Load, Explicit Case Acknowledgement, Stale Renewal,
  //         Dirty-Case Lock, Duplicate Submit Lock, CONFLICT & UNKNOWN
  // =========================================================================
  let backendCalls = 0;
  const controller = new LibraryQuarantineBinarySafetyCaseController(
    RECEIPT_ID_A,
    {
      envOverride: ALL_FLAGS_ON,
      currentUser: ownerUser,
      invokeCallable: async (action, data) => {
        backendCalls += 1;
        if (action === 'getQuarantineBinarySafetyCase') {
          return makeReadyGetResponse({
            currentRevision: 1,
            isCaseCurrent: false,
            requiresFreshEvidence: true,
            effectiveHumanCaseRevision: 3,
            currentHumanCaseRevision: 3,
            binarySafetyCase: makeSanitizedSafetyCaseDto({
              revision: 1,
              effectiveHumanCaseRevision: 2,
            }),
          });
        }
        if (action === 'saveQuarantineBinarySafetyCase') {
          assert.equal(data.acknowledgedHumanCaseRevision, 3);
          return {
            ok: true,
            status: 'SAVED',
            outcome: 'SAVED',
            caseSaveOutcome: 'UPDATED',
            caseSaved: true,
            receiptId: RECEIPT_ID_A,
            documentId: DOC_ID_A,
            revision: 2,
            currentRevision: 2,
            sourceRevision: 2,
            sourceUpdatedAt: ISO_1,
            sourceFormat: 'PDF',
            deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER',
            catalogHandoffCaseRevision: 2,
            currentHumanCaseRevision: 3,
            effectiveHumanCaseRevision: 3,
            effectiveHumanCaseUpdatedAt: ISO_2,
            catalogUpdatedAt: ISO_2,
            isCaseCurrent: true,
            requiresFreshEvidence: false,
            readiness: QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS,
            binarySafetyCase: makeSanitizedSafetyCaseDto({
              revision: 2,
              effectiveHumanCaseRevision: 3,
              effectiveHumanCaseUpdatedAt: ISO_2,
              catalogUpdatedAt: ISO_2,
              evidenceReference: 'TICKET-202',
              evidenceNotes: 'Fresh evidence for human case v3.',
            }),
            isSanitized: false,
            isVerifiedSafe: false,
            isRightsApproved: false,
            isPublished: false,
            isReadyForPeia: false,
          };
        }
        return { ok: false };
      },
    }
  );

  await controller.loadCase();
  assert.equal(controller.getState().phase, 'ready');
  assert.equal(controller.getState().snapshot?.requiresFreshEvidence, true);
  assert.equal(
    controller.getState().snapshot?.stalePreviousCase?.revision,
    1
  );

  // Save without acknowledging current human case revision -> blocked with 0 backend calls
  const callsBeforeUnack = backendCalls;
  const unackRes = (await controller.saveCase(1, {
    disposition: 'ISOLATED_ASSESSMENT_REQUIRED',
    evidenceReference: 'TICKET-202',
    evidenceNotes: 'Fresh evidence for human case v3.',
    reviewNotes: 'Updated notes.',
  })) as { errorCode?: string };
  assert.equal(unackRes.errorCode, 'UNACKNOWLEDGED_CASE_REVISION_HOLD');
  assert.equal(backendCalls, callsBeforeUnack);

  // Save with dirty human review case edits -> blocked with 0 backend calls
  const dirtyRes = (await controller.saveCase(
    1,
    {
      disposition: 'ISOLATED_ASSESSMENT_REQUIRED',
      evidenceReference: 'TICKET-202',
      evidenceNotes: 'Fresh evidence for human case v3.',
      reviewNotes: 'Updated notes.',
    },
    {
      acknowledgedHumanCaseRevision: 3,
      hasUnsavedCaseEdits: true,
    }
  )) as { errorCode?: string };
  assert.equal(dirtyRes.errorCode, 'DIRTY_HUMAN_REVIEW_CASE_LOCK');
  assert.equal(backendCalls, callsBeforeUnack);

  // Save reusing verbatim stale evidence when requiresFreshEvidence is true -> blocked
  const staleReuseRes = (await controller.saveCase(
    1,
    {
      disposition: 'ISOLATED_ASSESSMENT_REQUIRED',
      evidenceReference: 'TICKET-101',
      evidenceNotes: 'Isolated PDF parser referral logged.',
      reviewNotes: 'Awaiting isolated parser analysis.',
    },
    {
      acknowledgedHumanCaseRevision: 3,
    }
  )) as { errorCode?: string };
  assert.equal(staleReuseRes.errorCode, 'STALE_BINARY_SAFETY_EVIDENCE_HOLD');
  assert.equal(backendCalls, callsBeforeUnack);

  // Valid renewal with fresh evidence and acknowledgedHumanCaseRevision: 3 -> SAVED
  const savedRes = (await controller.saveCase(
    1,
    {
      disposition: 'ISOLATED_ASSESSMENT_REQUIRED',
      evidenceReference: 'TICKET-202',
      evidenceNotes: 'Fresh evidence for human case v3.',
      reviewNotes: 'Awaiting isolated parser analysis.',
    },
    {
      acknowledgedHumanCaseRevision: 3,
    }
  )) as { ok?: boolean };
  assert.equal(savedRes.ok, true);
  assert.equal(controller.getState().snapshot?.currentRevision, 2);
  assert.equal(controller.getState().snapshot?.requiresFreshEvidence, false);

  // =========================================================================
  // PASS 4: Controlled Receipt Switching & UNKNOWN GET-Only Recovery
  // =========================================================================
  controller.switchReceipt(RECEIPT_ID_B);
  assert.equal(controller.getState().receiptId, RECEIPT_ID_B);
  assert.equal(controller.getState().snapshot, null);

  let unknownSaveAttempts = 0;
  const unknownController = new LibraryQuarantineBinarySafetyCaseController(
    RECEIPT_ID_A,
    {
      envOverride: ALL_FLAGS_ON,
      currentUser: ownerUser,
      invokeCallable: async (action) => {
        if (action === 'getQuarantineBinarySafetyCase') {
          return makeReadyGetResponse({
            currentRevision: unknownSaveAttempts > 0 ? 1 : 0,
            binarySafetyCase:
              unknownSaveAttempts > 0 ? makeSanitizedSafetyCaseDto() : null,
          });
        }
        unknownSaveAttempts += 1;
        throw new Error('Socket hang up after request sent');
      },
    }
  );

  await unknownController.loadCase();
  const uncertainOut = (await unknownController.saveCase(
    0,
    {
      disposition: 'ISOLATED_ASSESSMENT_REQUIRED',
      evidenceReference: 'TICKET-101',
      evidenceNotes: 'Notes',
      reviewNotes: 'Review',
    },
    { acknowledgedHumanCaseRevision: 2 }
  )) as { outcome?: string; caseSaved?: null };
  assert.equal(uncertainOut.outcome, 'UNKNOWN');
  assert.equal(uncertainOut.caseSaved, null);
  assert.equal(unknownController.getState().phase, 'uncertain');
  // Never auto-retries
  assert.equal(unknownSaveAttempts, 1);

  // Save is blocked while in 'uncertain' phase until GET-only verify (loadCase)
  const blockedInUncertain = (await unknownController.saveCase(
    0,
    {
      disposition: 'ISOLATED_ASSESSMENT_REQUIRED',
      evidenceReference: 'TICKET-101',
      evidenceNotes: 'Notes',
      reviewNotes: 'Review',
    },
    { acknowledgedHumanCaseRevision: 2 }
  )) as { errorCode?: string };
  assert.equal(blockedInUncertain.errorCode, 'SAVE_BLOCKED_IN_CURRENT_PHASE');
  assert.equal(unknownSaveAttempts, 1);

  // GET-only verify resolves the state to revision 1
  await unknownController.loadCase();
  assert.equal(unknownController.getState().phase, 'ready');
  assert.equal(unknownController.getState().snapshot?.currentRevision, 1);

  // =========================================================================
  // PASS 5: Bilingual AR/EN Panel Static Render & Zero Secret/URL Leakage
  // =========================================================================
  const arMarkup = renderToStaticMarkup(
    React.createElement(LibraryQuarantineBinarySafetyCasePanel, {
      receiptId: RECEIPT_ID_A,
      currentUser: ownerUser,
      lang: 'ar',
      controllerOverride: unknownController,
      savedReviewCase: makeSavedHumanReviewCase(),
      hasUnsavedCaseEdits: true,
      envOverride: ALL_FLAGS_ON,
    })
  );
  assert.equal(arMarkup.includes('سجل إحالة السلامة الثنائية'), true);
  assert.equal(arMarkup.includes('NOT_VERIFIED'), true);
  assert.equal(arMarkup.includes('BLOCKED'), true);
  assert.equal(
    arMarkup.includes('binary-safety-dirty-case-lock-banner'),
    true
  );
  assert.equal(arMarkup.includes('https://'), false);
  assert.equal(arMarkup.includes('storagePath'), false);

  const enMarkup = renderToStaticMarkup(
    React.createElement(LibraryQuarantineBinarySafetyCasePanel, {
      receiptId: RECEIPT_ID_A,
      currentUser: ownerUser,
      lang: 'en',
      controllerOverride: unknownController,
      savedReviewCase: makeSavedHumanReviewCase(),
      hasUnsavedCaseEdits: false,
      envOverride: ALL_FLAGS_ON,
    })
  );
  assert.equal(enMarkup.includes('Binary Safety Casework (PDF/DOCX)'), true);
  assert.equal(
    enMarkup.includes('binary-safety-acknowledge-case-revision-checkbox'),
    true
  );

  console.log('ALL LIB-FILE-BINARY-SAFETY-CASE-R1 CLIENT TESTS PASSED (5/5).');
}

runClientTests().catch((err) => {
  console.error('Client tests failed:', err);
  process.exit(1);
});
