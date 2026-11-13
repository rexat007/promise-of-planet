import assert from 'node:assert/strict';
import process from 'node:process';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { React: typeof React }).React = React;

import {
  AdminPermission,
  AdminRole,
  type AdminUser,
} from '../src/types/admin';
import type { SanitizedLibraryQuarantineAdminReceiptDto } from '../src/services/libraryAdminClient';
import type { SanitizedLibraryQuarantineReviewWorkbenchItemDto } from '../src/services/libraryQuarantineReviewWorkbenchClient';
import {
  HUMAN_REVIEW_CLIENT_SAFE_ERRORS,
  LibraryQuarantineHumanReviewClient,
  buildGetQuarantineHumanReviewCasePayload,
  buildSaveQuarantineHumanReviewCasePayload,
  canOpenLibraryQuarantineHumanReviewCase,
  isLibraryQuarantineHumanReviewEnabled,
  isQuarantineWorkbenchItemEligibleForHumanReviewCase,
  validateGetLibraryQuarantineHumanReviewCaseResponse,
  validateSanitizedLibraryQuarantineHumanReviewCaseDto,
  validateSaveLibraryQuarantineHumanReviewCaseResponse,
  type GetLibraryQuarantineHumanReviewCaseResponseDto,
  type SanitizedLibraryQuarantineHumanReviewCaseDto,
  type SaveLibraryQuarantineHumanReviewCaseEditorialInput,
  type SaveLibraryQuarantineHumanReviewCaseResponseDto,
} from '../src/services/libraryQuarantineHumanReviewClient';
import {
  HUMAN_REVIEW_CLIENT_SAVE_UNCONFIRMED_CODE,
  LibraryQuarantineHumanReviewModal,
  LibraryQuarantineHumanReviewModalController,
  doHumanReviewEditorialFieldsExactlyMatch,
} from '../src/components/library/LibraryQuarantineHumanReviewModal';
import { AdminLibraryManagement } from '../src/components/library/AdminLibraryManagement';

function buildHexReceiptId(index: number): string {
  return index.toString(16).padStart(32, '0');
}

function buildHexSha256(index: number): string {
  return index.toString(16).padStart(64, 'a');
}

function buildSanitizedAdminReceipt(
  index = 1,
  overrides: Partial<SanitizedLibraryQuarantineAdminReceiptDto> = {}
): SanitizedLibraryQuarantineAdminReceiptDto {
  const receiptId = overrides.receiptId ?? buildHexReceiptId(index);
  const state = overrides.state ?? 'Quarantined';
  const isQuarantined = state === 'Quarantined';
  const isNeedsReconciliation = state === 'NeedsReconciliation';

  return Object.freeze({
    receiptId,
    uploaderUid: 'admin-curator',
    originalFilename: `biodiversity-treaty-${index}.pdf`,
    sanitizedFilename: `biodiversity-treaty-${index}.pdf`,
    format: 'PDF' as const,
    canonicalExtension: 'pdf' as const,
    canonicalMimeType: 'application/pdf' as const,
    byteSize: 12288 + index,
    sha256: buildHexSha256(index),
    state,
    deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER' as const,
    hasVerifiedStorageWrite: isQuarantined,
    reconciliationRequired: isNeedsReconciliation,
    reconciliationReason: isNeedsReconciliation
      ? 'GCS conditional write outcome was ambiguous.'
      : null,
    rejectionReasonCode:
      state === 'Rejected' ? 'PDF_ACTIVE_CONTENT_DETECTED' : null,
    createdAt: '2026-11-09T09:00:00.000Z',
    updatedAt: '2026-11-09T09:05:00.000Z',
    isQuarantinedPrivateOnly: isQuarantined,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
    ...overrides,
  });
}

function buildSanitizedCaseDto(
  receiptId: string,
  revision = 1,
  overrides: Partial<SanitizedLibraryQuarantineHumanReviewCaseDto> = {}
): SanitizedLibraryQuarantineHumanReviewCaseDto {
  return Object.freeze({
    schemaVersion: 1 as const,
    receiptId,
    sourceRevision: 2,
    sourceUpdatedAt: '2026-11-09T09:05:00.000Z',
    draftSourceRevision: 2,
    revision,
    status: 'METADATA_RECORDED' as const,
    titleAr: 'اتفاقية حماية التنوع البيولوجي البحري',
    titleEn: 'Marine Biodiversity Protection Convention',
    issuingOrganization: 'برنامج الأمم المتحدة للبيئة (UNEP)',
    summaryAr: 'ملخص تحريري أولي لبنود الاتفاقية الإقليمية.',
    summaryEn: 'Preliminary editorial summary of the regional convention.',
    sourceEvidenceNotes: 'وثيقة رسمية من أرشيف المعاهدات الدولية 2026.',
    rightsEvidenceNotes: 'وثيقة أممية — بانتظار المراجعة الحقوقية المستقلة.',
    editorialNotes: 'تمت مطابقة العنوان والجهة المصدرة أولياً.',
    createdAt: '2026-11-09T10:00:00.000Z',
    updatedAt: '2026-11-09T10:10:00.000Z',
    ...overrides,
  });
}

function buildAdminUser(
  role: AdminRole,
  overrides: Record<string, unknown> = {}
): AdminUser {
  return Object.freeze({
    id: `admin-${role.toLowerCase()}`,
    email: `${role.toLowerCase()}@promiseofplanet.org`,
    name: `${role} User`,
    role,
    isActive: true,
    ...overrides,
  }) as AdminUser;
}

async function runTests(): Promise<void> {
  let passed = 0;

  const owner = buildAdminUser(AdminRole.Owner);
  const curator = buildAdminUser(AdminRole.LibraryCurator);
  const rightsReviewer = buildAdminUser(AdminRole.RightsReviewer);
  const viewOnlyCurator = buildAdminUser(AdminRole.LibraryCurator, {
    id: 'admin-view-only',
    permissions: [AdminPermission.View],
  });
  const aiAssistant = buildAdminUser(AdminRole.AIAssistant);
  const viewerUser = buildAdminUser(AdminRole.Viewer);

  // =========================================================================
  // TEST 1: Dual Feature Flags, RBAC, and Row Eligibility
  // =========================================================================
  {
    assert.equal(isLibraryQuarantineHumanReviewEnabled({}), false);
    assert.equal(
      isLibraryQuarantineHumanReviewEnabled({
        VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED: 'true',
      }),
      false
    );
    assert.equal(
      isLibraryQuarantineHumanReviewEnabled({
        VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED: 'true',
      }),
      false
    );
    assert.equal(
      isLibraryQuarantineHumanReviewEnabled({
        VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED: 'true',
        VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED: 'true',
      }),
      true
    );

    assert.equal(canOpenLibraryQuarantineHumanReviewCase(owner), true);
    assert.equal(canOpenLibraryQuarantineHumanReviewCase(curator), true);
    assert.equal(canOpenLibraryQuarantineHumanReviewCase(rightsReviewer), true);
    assert.equal(canOpenLibraryQuarantineHumanReviewCase(viewOnlyCurator), false);
    assert.equal(canOpenLibraryQuarantineHumanReviewCase(aiAssistant), false);
    assert.equal(canOpenLibraryQuarantineHumanReviewCase(viewerUser), false);

    const quarantinedReceipt = buildSanitizedAdminReceipt(1);
    assert.equal(
      isQuarantineWorkbenchItemEligibleForHumanReviewCase({
        adminReceipt: quarantinedReceipt,
        draftStatus: 'PENDING_HUMAN_REVIEW',
      }),
      true
    );
    assert.equal(
      isQuarantineWorkbenchItemEligibleForHumanReviewCase({
        adminReceipt: quarantinedReceipt,
        draftStatus: 'NOT_LINKED',
      }),
      false
    );
    assert.equal(
      isQuarantineWorkbenchItemEligibleForHumanReviewCase({
        adminReceipt: buildSanitizedAdminReceipt(2, {
          state: 'NeedsReconciliation',
        }),
        draftStatus: 'NEEDS_RECONCILIATION_HOLD',
      }),
      false
    );

    passed += 1;
    console.log(
      'PASS [1/6]: Dual feature flags, reviewer RBAC, and Quarantined + PENDING_HUMAN_REVIEW row eligibility verified'
    );
  }

  // =========================================================================
  // TEST 2: Payload Builders & Strict Sanitized DTO / Response Validators
  // =========================================================================
  {
    const receiptId = buildHexReceiptId(2);
    const adminReceipt = buildSanitizedAdminReceipt(2, { receiptId });
    const validCase = buildSanitizedCaseDto(receiptId, 1);

    const getPayload = buildGetQuarantineHumanReviewCasePayload(receiptId);
    assert.deepEqual(getPayload, {
      action: 'getQuarantineHumanReviewCase',
      receiptId,
    });

    const savePayload = buildSaveQuarantineHumanReviewCasePayload({
      receiptId,
      expectedRevision: 1,
      input: {
        status: 'METADATA_RECORDED',
        titleAr: 'عنوان عربي',
        sourceEvidenceNotes: 'الجريدة الرسمية',
      },
    });
    assert.equal(savePayload.action, 'saveQuarantineHumanReviewCase');
    assert.equal(savePayload.expectedRevision, 1);

    // Validate 17-field DTO & reject leaked internal fields
    const validatedDto = validateSanitizedLibraryQuarantineHumanReviewCaseDto(
      validCase,
      receiptId
    );
    assert.equal(validatedDto.revision, 1);

    for (const forbiddenField of [
      'sourceSha256',
      'createdBy',
      'updatedBy',
      'storagePath',
      'generation',
      'signedUrl',
    ]) {
      assert.throws(() => {
        validateSanitizedLibraryQuarantineHumanReviewCaseDto(
          {
            ...validCase,
            [forbiddenField]: 'leaked',
          },
          receiptId
        );
      });
    }

    // Validate GET READY response
    const getReady = validateGetLibraryQuarantineHumanReviewCaseResponse(
      {
        ok: true,
        status: 'READY',
        receiptId,
        sourceRevision: 2,
        draftStatus: 'PENDING_HUMAN_REVIEW',
        adminReceipt,
        currentRevision: 1,
        reviewCase: validCase,
        isSanitized: false,
        isVerifiedSafe: false,
        isRightsApproved: false,
        isPublished: false,
        isReadyForPeia: false,
      },
      receiptId
    );
    assert.equal(getReady.ok, true);

    // Validate SAVE SAVED, CONFLICT, and UNKNOWN responses
    const saveSaved = validateSaveLibraryQuarantineHumanReviewCaseResponse(
      {
        ok: true,
        status: 'SAVED',
        caseSaveOutcome: 'CREATED',
        caseSaved: true,
        receiptId,
        sourceRevision: 2,
        currentRevision: 1,
        reviewCase: validCase,
        isSanitized: false,
        isVerifiedSafe: false,
        isRightsApproved: false,
        isPublished: false,
        isReadyForPeia: false,
      },
      receiptId
    );
    assert.equal(saveSaved.status, 'SAVED');

    const saveConflict = validateSaveLibraryQuarantineHumanReviewCaseResponse(
      {
        ok: false,
        status: 'CONFLICT',
        caseSaveOutcome: 'NOT_SAVED',
        caseSaved: false,
        errorCode: 'CASE_REVISION_CONFLICT',
        errorMessage: 'Revision changed concurrently.',
        receiptId,
        currentRevision: 1,
        currentCase: validCase,
        isSanitized: false,
        isVerifiedSafe: false,
        isRightsApproved: false,
        isPublished: false,
        isReadyForPeia: false,
      },
      receiptId
    );
    assert.equal(saveConflict.status, 'CONFLICT');

    const saveUnknown = validateSaveLibraryQuarantineHumanReviewCaseResponse(
      {
        ok: false,
        status: 'UNKNOWN',
        caseSaveOutcome: 'UNKNOWN',
        caseSaved: null,
        errorCode: 'TRANSACTION_COMMIT_UNCERTAIN',
        errorMessage: 'Commit confirmation lost.',
        receiptId,
        isSanitized: false,
        isVerifiedSafe: false,
        isRightsApproved: false,
        isPublished: false,
        isReadyForPeia: false,
      },
      receiptId
    );
    assert.equal(saveUnknown.status, 'UNKNOWN');
    assert.equal(saveUnknown.caseSaved, null);

    passed += 1;
    console.log(
      'PASS [2/6]: Payload builders and strict client DTO/response validators verified'
    );
  }

  // =========================================================================
  // TEST 3: Modal Controller Save, Fresh Readback, Duplicate-Click Lock & Conflict
  // =========================================================================
  {
    const receiptId = buildHexReceiptId(3);
    const adminReceipt = buildSanitizedAdminReceipt(3, { receiptId });
    let serverRevision = 0;
    let serverCase: SanitizedLibraryQuarantineHumanReviewCaseDto | null = null;
    let getCalls = 0;
    let saveCalls = 0;

    const controller = new LibraryQuarantineHumanReviewModalController(
      curator,
      {
        humanReviewEnabled: true,
        getCaseFn: async () => {
          getCalls += 1;
          return {
            ok: true,
            status: 'READY',
            receiptId,
            sourceRevision: 2,
            draftStatus: 'PENDING_HUMAN_REVIEW',
            adminReceipt,
            currentRevision: serverRevision,
            reviewCase: serverCase,
            isSanitized: false,
            isVerifiedSafe: false,
            isRightsApproved: false,
            isPublished: false,
            isReadyForPeia: false,
          };
        },
        saveCaseFn: async ({ expectedRevision, input }) => {
          saveCalls += 1;
          if (expectedRevision !== serverRevision) {
            return {
              ok: false,
              status: 'CONFLICT',
              caseSaveOutcome: 'NOT_SAVED',
              caseSaved: false,
              errorCode: 'CASE_REVISION_CONFLICT',
              errorMessage: 'Concurrent revision conflict.',
              receiptId,
              currentRevision: serverRevision,
              currentCase: serverCase,
              isSanitized: false,
              isVerifiedSafe: false,
              isRightsApproved: false,
              isPublished: false,
              isReadyForPeia: false,
            };
          }
          serverRevision += 1;
          serverCase = buildSanitizedCaseDto(receiptId, serverRevision, {
            status: input.status,
            titleAr: input.titleAr ?? '',
            sourceEvidenceNotes: input.sourceEvidenceNotes ?? '',
          });
          return {
            ok: true,
            status: 'SAVED',
            caseSaveOutcome: expectedRevision === 0 ? 'CREATED' : 'UPDATED',
            caseSaved: true,
            receiptId,
            sourceRevision: 2,
            currentRevision: serverRevision,
            reviewCase: serverCase,
            isSanitized: false,
            isVerifiedSafe: false,
            isRightsApproved: false,
            isPublished: false,
            isReadyForPeia: false,
          };
        },
      }
    );

    await controller.openCase(adminReceipt, 2);
    assert.equal(getCalls, 1);
    assert.equal(controller.getSnapshot().currentRevision, 0);

    controller.updateFormField('status', 'METADATA_RECORDED');
    controller.updateFormField('titleAr', 'قانون البيئة البحرية');
    controller.updateFormField(
      'sourceEvidenceNotes',
      'الجريدة الرسمية عدد 500'
    );

    const saveRes = await controller.saveCase();
    assert.equal(saveRes?.status, 'SAVED');
    assert.equal(saveCalls, 1);
    // Fresh readback after save incremented getCalls to 2
    assert.equal(getCalls, 2);
    assert.equal(controller.getSnapshot().currentRevision, 1);
    assert.equal(controller.getSnapshot().lastSaveOutcome, 'CREATED');

    // Simulate concurrent server update to revision 2
    serverRevision = 2;
    serverCase = buildSanitizedCaseDto(receiptId, 2, {
      titleAr: 'تحديث مراجع آخر للنسخة 2',
    });

    controller.updateFormField('titleAr', 'تعديل محلي قديم');
    const conflictRes = await controller.saveCase();
    assert.equal(conflictRes?.status, 'CONFLICT');
    assert.equal(controller.getSnapshot().conflictState?.serverRevision, 2);

    // Apply latest server version from conflict banner
    controller.applyConflictServerVersion();
    assert.equal(controller.getSnapshot().currentRevision, 2);
    assert.equal(
      controller.getSnapshot().form.titleAr,
      'تحديث مراجع آخر للنسخة 2'
    );
    assert.equal(controller.getSnapshot().conflictState, null);

    passed += 1;
    console.log(
      'PASS [3/6]: Modal controller save, fresh server readback, and conflict recovery verified'
    );
  }

  // =========================================================================
  // TEST 4: UNKNOWN Commit Uncertainty Blocks Save Until Manual Verify
  // =========================================================================
  {
    const receiptId = buildHexReceiptId(4);
    const adminReceipt = buildSanitizedAdminReceipt(4, { receiptId });
    let saveCalls = 0;
    let getCalls = 0;
    let serverCase: SanitizedLibraryQuarantineHumanReviewCaseDto | null = null;

    const controller = new LibraryQuarantineHumanReviewModalController(
      curator,
      {
        humanReviewEnabled: true,
        getCaseFn: async () => {
          getCalls += 1;
          return {
            ok: true,
            status: 'READY',
            receiptId,
            sourceRevision: 2,
            draftStatus: 'PENDING_HUMAN_REVIEW',
            adminReceipt,
            currentRevision: serverCase ? serverCase.revision : 0,
            reviewCase: serverCase,
            isSanitized: false,
            isVerifiedSafe: false,
            isRightsApproved: false,
            isPublished: false,
            isReadyForPeia: false,
          };
        },
        saveCaseFn: async ({ input }) => {
          saveCalls += 1;
          // Simulate commit confirmation lost after server actually persisted revision 1
          serverCase = buildSanitizedCaseDto(receiptId, 1, {
            status: input.status,
            titleAr: input.titleAr ?? '',
            titleEn: input.titleEn ?? '',
            issuingOrganization: input.issuingOrganization ?? '',
            summaryAr: input.summaryAr ?? '',
            summaryEn: input.summaryEn ?? '',
            sourceEvidenceNotes: input.sourceEvidenceNotes ?? '',
            rightsEvidenceNotes: input.rightsEvidenceNotes ?? '',
            editorialNotes: input.editorialNotes ?? '',
          });
          return {
            ok: false,
            status: 'UNKNOWN',
            caseSaveOutcome: 'UNKNOWN',
            caseSaved: null,
            errorCode: 'TRANSACTION_COMMIT_UNCERTAIN',
            errorMessage: 'Commit confirmation lost.',
            receiptId,
            isSanitized: false,
            isVerifiedSafe: false,
            isRightsApproved: false,
            isPublished: false,
            isReadyForPeia: false,
          };
        },
      }
    );

    await controller.openCase(adminReceipt, 2);
    controller.updateFormField('titleAr', 'سجل محفوظ رغم انقطاع التأكيد');
    const res = await controller.saveCase();

    assert.equal(res?.status, 'UNKNOWN');
    assert.equal(saveCalls, 1);
    assert.notEqual(controller.getSnapshot().uncertainState, null);

    // Attempting to save again while in UNKNOWN state is blocked (no auto-retry or duplicate save)
    const blockedRetry = await controller.saveCase();
    assert.equal(blockedRetry, null);
    assert.equal(saveCalls, 1);

    // Manual "Verify case record" (`reloadCase`) loads revision 1 and clears uncertainState
    await controller.reloadCase();
    assert.equal(getCalls, 2);
    assert.equal(controller.getSnapshot().uncertainState, null);
    assert.equal(controller.getSnapshot().currentRevision, 1);
    assert.equal(
      controller.getSnapshot().form.titleAr,
      'سجل محفوظ رغم انقطاع التأكيد'
    );

    passed += 1;
    console.log(
      'PASS [4/6]: UNKNOWN outcome halts further saves with zero auto-retry until manual Verify case record'
    );
  }

  // =========================================================================
  // TEST 5: User Switch / Close Modal Invalidates In-Flight Responses
  // =========================================================================
  {
    const receiptId = buildHexReceiptId(5);
    const adminReceipt = buildSanitizedAdminReceipt(5, { receiptId });
    let resolveDelayedGet:
      | ((val: GetLibraryQuarantineHumanReviewCaseResponseDto) => void)
      | null = null;

    const controller = new LibraryQuarantineHumanReviewModalController(
      curator,
      {
        humanReviewEnabled: true,
        getCaseFn: () =>
          new Promise<GetLibraryQuarantineHumanReviewCaseResponseDto>((res) => {
            resolveDelayedGet = res;
          }),
      }
    );

    const openPromise = controller.openCase(adminReceipt, 2);
    assert.equal(controller.getSnapshot().isOpen, true);

    // Switch user to viewOnlyCurator while request is in flight
    controller.setCurrentUser(viewOnlyCurator);
    assert.equal(controller.getSnapshot().isOpen, false);

    resolveDelayedGet!({
      ok: true,
      status: 'READY',
      receiptId,
      sourceRevision: 2,
      draftStatus: 'PENDING_HUMAN_REVIEW',
      adminReceipt,
      currentRevision: 1,
      reviewCase: buildSanitizedCaseDto(receiptId, 1),
      isSanitized: false,
      isVerifiedSafe: false,
      isRightsApproved: false,
      isPublished: false,
      isReadyForPeia: false,
    });

    const lateResult = await openPromise;
    assert.equal(lateResult, null);
    assert.equal(controller.getSnapshot().isOpen, false);
    assert.equal(controller.getSnapshot().reviewCase, null);

    passed += 1;
    console.log(
      'PASS [5/6]: User change / modal close invalidates late async responses without cross-user contamination'
    );
  }

  // =========================================================================
  // TEST 6: Bilingual AR/EN Rendering in AdminLibraryManagement & Modal + Flag Disabled Preservation
  // =========================================================================
  {
    const rPending = buildSanitizedAdminReceipt(61);
    const rNotLinked = buildSanitizedAdminReceipt(62);
    const workbenchItems: readonly SanitizedLibraryQuarantineReviewWorkbenchItemDto[] =
      [
        {
          revision: 2,
          adminReceipt: rPending,
          draftStatus: 'PENDING_HUMAN_REVIEW',
        },
        {
          revision: 1,
          adminReceipt: rNotLinked,
          draftStatus: 'NOT_LINKED',
        },
      ];

    // 6a. When human review flag is disabled, Workbench renders normally without Open review case button
    const disabledHtml = renderToStaticMarkup(
      React.createElement(AdminLibraryManagement, {
        currentUser: curator,
        initialTab: 'intake',
        initialLoading: false,
        quarantineWorkbenchEnabledOverride: true,
        quarantineHumanReviewEnabledOverride: false,
        initialQuarantineWorkbenchItems: workbenchItems,
        languageOverride: 'ar',
      })
    );
    assert.equal(
      disabledHtml.includes(
        `open-quarantine-human-review-case-btn-${rPending.receiptId}`
      ),
      false
    );
    assert.equal(
      disabledHtml.includes(
        `prepare-quarantine-review-draft-btn-${rNotLinked.receiptId}`
      ),
      true
    );

    // 6b. When human review flag is enabled, Quarantined + PENDING_HUMAN_REVIEW row renders Open review case button in AR and EN
    const enabledArHtml = renderToStaticMarkup(
      React.createElement(AdminLibraryManagement, {
        currentUser: curator,
        initialTab: 'intake',
        initialLoading: false,
        quarantineWorkbenchEnabledOverride: true,
        quarantineHumanReviewEnabledOverride: true,
        initialQuarantineWorkbenchItems: workbenchItems,
        languageOverride: 'ar',
      })
    );
    assert.equal(
      enabledArHtml.includes(
        `open-quarantine-human-review-case-btn-${rPending.receiptId}`
      ),
      true
    );
    assert.equal(enabledArHtml.includes('فتح سجل المراجعة'), true);
    // NOT_LINKED row must NOT show Open review case button
    assert.equal(
      enabledArHtml.includes(
        `open-quarantine-human-review-case-btn-${rNotLinked.receiptId}`
      ),
      false
    );

    // 6c. Render open modal in Arabic and English and verify accessibility & zero binary/storage leaks
    const modalController = new LibraryQuarantineHumanReviewModalController(
      curator,
      {
        humanReviewEnabled: true,
        getCaseFn: async () => ({
          ok: true,
          status: 'READY',
          receiptId: rPending.receiptId,
          sourceRevision: 2,
          draftStatus: 'PENDING_HUMAN_REVIEW',
          adminReceipt: rPending,
          currentRevision: 1,
          reviewCase: buildSanitizedCaseDto(rPending.receiptId, 1),
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
        }),
        saveCaseFn: async (
          params: {
            readonly receiptId: string;
            readonly expectedRevision: number;
            readonly input: SaveLibraryQuarantineHumanReviewCaseEditorialInput;
          }
        ): Promise<SaveLibraryQuarantineHumanReviewCaseResponseDto> => ({
          ok: true,
          status: 'SAVED',
          caseSaveOutcome: 'UPDATED',
          caseSaved: true,
          receiptId: params.receiptId,
          sourceRevision: 2,
          currentRevision: 2,
          reviewCase: buildSanitizedCaseDto(params.receiptId, 2),
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
        }),
      }
    );

    await modalController.openCase(rPending, 2);

    const modalArHtml = renderToStaticMarkup(
      React.createElement(LibraryQuarantineHumanReviewModal, {
        controller: modalController,
        isAr: true,
      })
    );
    const modalEnHtml = renderToStaticMarkup(
      React.createElement(LibraryQuarantineHumanReviewModal, {
        controller: modalController,
        isAr: false,
      })
    );

    assert.equal(modalArHtml.includes('role="dialog"'), true);
    assert.equal(modalArHtml.includes('aria-modal="true"'), true);
    assert.equal(
      modalArHtml.includes('سجل المراجعة البشرية للملف المحجور'),
      true
    );
    assert.equal(
      modalEnHtml.includes('Quarantined File Human Review Case'),
      true
    );
    assert.equal(modalArHtml.includes('library/quarantine/'), false);
    assert.equal(modalArHtml.includes('gs://'), false);
    assert.equal(modalEnHtml.includes('library/quarantine/'), false);

    // Also verify LibraryQuarantineHumanReviewClient surface
    assert.equal(
      typeof LibraryQuarantineHumanReviewClient.getQuarantineHumanReviewCase,
      'function'
    );
    assert.equal(
      typeof LibraryQuarantineHumanReviewClient.saveQuarantineHumanReviewCase,
      'function'
    );
    assert.equal(
      Boolean(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.BACKEND_UNAVAILABLE),
      true
    );

    passed += 1;
    console.log(
      'PASS [6/6]: Bilingual AR/EN UI rendering, flag-off preservation, dialog accessibility, and zero path leaks verified'
    );
  }

  // =========================================================================
  // TEST 7 (Case A): Rejected Callable (`HUMAN_REVIEW_SAVE_CALL_FAILED`) After Server Persistence
  //                  -> Enters `SAVE_RESULT_UNCONFIRMED` Hold -> Blocks Repeat Save -> Reconciles
  //                  via `reloadCase()` Without Second Write and Fires `onCaseSaved` Exactly Once
  // =========================================================================
  {
    const receiptId = buildHexReceiptId(70);
    const adminReceipt = buildSanitizedAdminReceipt(70, { receiptId });
    let saveCalls = 0;
    let getCalls = 0;
    const savedCallbacks: SanitizedLibraryQuarantineHumanReviewCaseDto[] = [];
    let persistedServerCase: SanitizedLibraryQuarantineHumanReviewCaseDto | null =
      null;

    const controller = new LibraryQuarantineHumanReviewModalController(
      curator,
      {
        humanReviewEnabled: true,
        onCaseSaved: (saved) => {
          savedCallbacks.push(saved);
        },
        getCaseFn: async () => {
          getCalls += 1;
          return {
            ok: true,
            status: 'READY',
            receiptId,
            sourceRevision: 2,
            draftStatus: 'PENDING_HUMAN_REVIEW',
            adminReceipt,
            currentRevision: persistedServerCase
              ? persistedServerCase.revision
              : 0,
            reviewCase: persistedServerCase,
            isSanitized: false,
            isVerifiedSafe: false,
            isRightsApproved: false,
            isPublished: false,
            isReadyForPeia: false,
          };
        },
        saveCaseFn: async ({ expectedRevision, input }) => {
          saveCalls += 1;
          persistedServerCase = buildSanitizedCaseDto(
            receiptId,
            expectedRevision + 1,
            {
              status: input.status,
              titleAr: input.titleAr ?? '',
              titleEn: input.titleEn ?? '',
              issuingOrganization: input.issuingOrganization ?? '',
              summaryAr: input.summaryAr ?? '',
              summaryEn: input.summaryEn ?? '',
              sourceEvidenceNotes: input.sourceEvidenceNotes ?? '',
              rightsEvidenceNotes: input.rightsEvidenceNotes ?? '',
              editorialNotes: input.editorialNotes ?? '',
            }
          );
          throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.SAVE_CALL_FAILED);
        },
      }
    );

    await controller.openCase(adminReceipt, 2);
    controller.updateFormField('status', 'METADATA_RECORDED');
    controller.updateFormField('titleAr', '  التقرير الوطني للانبعاثات 2026  ');
    controller.updateFormField('titleEn', '  National Emissions Report 2026  ');
    controller.updateFormField('issuingOrganization', '  وزارة البيئة والمناخ  ');
    controller.updateFormField('summaryAr', '  ملخص عربي شامل  ');
    controller.updateFormField('summaryEn', '  Comprehensive English summary  ');
    controller.updateFormField('sourceEvidenceNotes', '  قرار وزاري رقم 14  ');
    controller.updateFormField('rightsEvidenceNotes', '  وثيقة حكومية عامة  ');
    controller.updateFormField('editorialNotes', '  ملاحظة المراجع البشري  ');

    const failedSaveRes = await controller.saveCase();
    assert.equal(failedSaveRes, null);
    assert.equal(saveCalls, 1);
    assert.equal(savedCallbacks.length, 0);

    const snapDuringHold = controller.getSnapshot();
    assert.equal(snapDuringHold.saving, false);
    assert.equal(snapDuringHold.saveError, null);
    assert.notEqual(snapDuringHold.uncertainState, null);
    assert.equal(
      snapDuringHold.uncertainState?.errorCode,
      HUMAN_REVIEW_CLIENT_SAVE_UNCONFIRMED_CODE
    );
    assert.equal(snapDuringHold.uncertainState?.caseSaveOutcome, 'UNKNOWN');
    assert.equal(snapDuringHold.uncertainState?.caseSaved, null);
    assert.equal(
      snapDuringHold.uncertainState?.origin,
      'CLIENT_SAVE_UNCONFIRMED'
    );
    assert.equal(snapDuringHold.uncertainState?.expectedRevision, 0);
    assert.equal(snapDuringHold.uncertainState?.verificationStatus, 'UNVERIFIED');

    // All 9 normalized fields are preserved in form during hold
    assert.equal(snapDuringHold.form.status, 'METADATA_RECORDED');
    assert.equal(snapDuringHold.form.titleAr, 'التقرير الوطني للانبعاثات 2026');
    assert.equal(snapDuringHold.form.titleEn, 'National Emissions Report 2026');
    assert.equal(snapDuringHold.form.issuingOrganization, 'وزارة البيئة والمناخ');
    assert.equal(snapDuringHold.form.summaryAr, 'ملخص عربي شامل');
    assert.equal(snapDuringHold.form.summaryEn, 'Comprehensive English summary');
    assert.equal(snapDuringHold.form.sourceEvidenceNotes, 'قرار وزاري رقم 14');
    assert.equal(snapDuringHold.form.rightsEvidenceNotes, 'وثيقة حكومية عامة');
    assert.equal(snapDuringHold.form.editorialNotes, 'ملاحظة المراجع البشري');

    // Blind repeat save or field edit while uncertain is blocked
    controller.updateFormField('titleAr', 'محاولة تعديل أثناء القفل');
    assert.equal(
      controller.getSnapshot().form.titleAr,
      'التقرير الوطني للانبعاثات 2026'
    );
    const blockedSave = await controller.saveCase();
    assert.equal(blockedSave, null);
    assert.equal(saveCalls, 1);

    // Clicking "Verify case record" (`reloadCase`) reads back revision 1 and reconciles all 9 fields without a second write
    const verifyRes = await controller.reloadCase();
    assert.equal(verifyRes?.ok, true);
    assert.equal(saveCalls, 1);
    assert.equal(getCalls, 2);
    assert.equal(savedCallbacks.length, 1);
    assert.equal(savedCallbacks[0].revision, 1);

    const snapAfterVerify = controller.getSnapshot();
    assert.equal(snapAfterVerify.uncertainState, null);
    assert.equal(snapAfterVerify.currentRevision, 1);
    assert.equal(snapAfterVerify.lastSaveOutcome, 'CREATED');
    assert.equal(
      doHumanReviewEditorialFieldsExactlyMatch(
        snapAfterVerify.reviewCase,
        snapAfterVerify.form
      ),
      true
    );

    passed += 1;
    console.log(
      'PASS [7/15] (Case A): Rejected callable after server persistence reconciles cleanly via Verify case record without second write'
    );
  }

  // =========================================================================
  // TEST 8 (Case B): Rejected Callable (`HUMAN_REVIEW_SAVE_CALL_FAILED`) Without Server Persistence
  //                  -> `reloadCase()` Sees `expectedRevision`, Preserves All 9 Attempted Fields,
  //                  Keeps Hold Active Until Explicit Human Acknowledgment, Zero Auto-Save
  // =========================================================================
  {
    const receiptId = buildHexReceiptId(80);
    const adminReceipt = buildSanitizedAdminReceipt(80, { receiptId });
    let saveCalls = 0;
    let getCalls = 0;
    let shouldFailSave = true;
    let serverCase: SanitizedLibraryQuarantineHumanReviewCaseDto | null =
      buildSanitizedCaseDto(receiptId, 1, {
        status: 'IN_REVIEW',
        titleAr: 'عنوان قديم على الخادم',
        titleEn: 'Old Server Title',
        issuingOrganization: 'Old Org',
        summaryAr: 'ملخص قديم',
        summaryEn: 'Old summary',
        sourceEvidenceNotes: 'مصدر قديم',
        rightsEvidenceNotes: 'حقوق قديمة',
        editorialNotes: 'ملاحظات قديمة',
      });

    const controller = new LibraryQuarantineHumanReviewModalController(
      curator,
      {
        humanReviewEnabled: true,
        getCaseFn: async () => {
          getCalls += 1;
          return {
            ok: true,
            status: 'READY',
            receiptId,
            sourceRevision: 2,
            draftStatus: 'PENDING_HUMAN_REVIEW',
            adminReceipt,
            currentRevision: serverCase ? serverCase.revision : 0,
            reviewCase: serverCase,
            isSanitized: false,
            isVerifiedSafe: false,
            isRightsApproved: false,
            isPublished: false,
            isReadyForPeia: false,
          };
        },
        saveCaseFn: async ({ expectedRevision, input }) => {
          saveCalls += 1;
          if (shouldFailSave) {
            throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.SAVE_CALL_FAILED);
          }
          serverCase = buildSanitizedCaseDto(receiptId, expectedRevision + 1, {
            status: input.status,
            titleAr: input.titleAr ?? '',
            titleEn: input.titleEn ?? '',
            issuingOrganization: input.issuingOrganization ?? '',
            summaryAr: input.summaryAr ?? '',
            summaryEn: input.summaryEn ?? '',
            sourceEvidenceNotes: input.sourceEvidenceNotes ?? '',
            rightsEvidenceNotes: input.rightsEvidenceNotes ?? '',
            editorialNotes: input.editorialNotes ?? '',
          });
          return {
            ok: true,
            status: 'SAVED',
            caseSaveOutcome: 'UPDATED',
            caseSaved: true,
            receiptId,
            sourceRevision: 2,
            currentRevision: expectedRevision + 1,
            reviewCase: serverCase,
            isSanitized: false,
            isVerifiedSafe: false,
            isRightsApproved: false,
            isPublished: false,
            isReadyForPeia: false,
          };
        },
      }
    );

    await controller.openCase(adminReceipt, 2);
    assert.equal(controller.getSnapshot().currentRevision, 1);

    const attemptedNineFields = {
      status: 'METADATA_RECORDED' as const,
      titleAr: 'عنوان محدّث لم يُحفظ بعد',
      titleEn: 'Updated Unsaved English Title',
      issuingOrganization: 'الهيئة الإقليمية لحماية البيئة',
      summaryAr: 'ملخص تحريري جديد بالعربية',
      summaryEn: 'New editorial summary in English',
      sourceEvidenceNotes: 'الجريدة الرسمية ملحق 7',
      rightsEvidenceNotes: 'مشاع إبداعي حكومي',
      editorialNotes: 'استيفاء جميع الحقول التسعة',
    };
    controller.updateFormField('status', attemptedNineFields.status);
    controller.updateFormField('titleAr', attemptedNineFields.titleAr);
    controller.updateFormField('titleEn', attemptedNineFields.titleEn);
    controller.updateFormField(
      'issuingOrganization',
      attemptedNineFields.issuingOrganization
    );
    controller.updateFormField('summaryAr', attemptedNineFields.summaryAr);
    controller.updateFormField('summaryEn', attemptedNineFields.summaryEn);
    controller.updateFormField(
      'sourceEvidenceNotes',
      attemptedNineFields.sourceEvidenceNotes
    );
    controller.updateFormField(
      'rightsEvidenceNotes',
      attemptedNineFields.rightsEvidenceNotes
    );
    controller.updateFormField(
      'editorialNotes',
      attemptedNineFields.editorialNotes
    );

    await controller.saveCase();
    assert.equal(saveCalls, 1);
    assert.equal(
      controller.getSnapshot().uncertainState?.errorCode,
      HUMAN_REVIEW_CLIENT_SAVE_UNCONFIRMED_CODE
    );

    assert.equal(controller.acknowledgeUncommittedSaveAfterVerify(), false);

    await controller.reloadCase();
    assert.equal(getCalls, 2);
    assert.equal(saveCalls, 1);

    const snapAfterVerify = controller.getSnapshot();
    assert.notEqual(snapAfterVerify.uncertainState, null);
    assert.equal(
      snapAfterVerify.uncertainState?.verificationStatus,
      'STILL_AT_EXPECTED_REVISION'
    );
    assert.equal(snapAfterVerify.uncertainState?.verifiedServerRevision, 1);
    assert.equal(snapAfterVerify.currentRevision, 1);

    // All 9 attempted fields in `form` were NOT overwritten by the old server case
    assert.equal(
      doHumanReviewEditorialFieldsExactlyMatch(
        snapAfterVerify.form,
        attemptedNineFields
      ),
      true
    );

    assert.equal(controller.acknowledgeUncommittedSaveAfterVerify(), true);
    assert.equal(controller.getSnapshot().uncertainState, null);
    assert.equal(controller.getSnapshot().currentRevision, 1);
    assert.equal(saveCalls, 1);
    assert.equal(
      doHumanReviewEditorialFieldsExactlyMatch(
        controller.getSnapshot().form,
        attemptedNineFields
      ),
      true
    );

    shouldFailSave = false;
    const manualRetryRes = await controller.saveCase();
    assert.equal(manualRetryRes?.status, 'SAVED');
    assert.equal(saveCalls, 2);
    assert.equal(controller.getSnapshot().currentRevision, 2);
    assert.equal(controller.getSnapshot().lastSaveOutcome, 'UPDATED');

    passed += 1;
    console.log(
      'PASS [8/15] (Case B): Unchanged server revision preserves all 9 attempted fields and requires explicit acknowledgment before CAS-protected manual save'
    );
  }

  // =========================================================================
  // TEST 9 (Case C): `GET` Failure or Server `HOLD` During Uncertainty
  //                  -> Fails Closed, `uncertainState` and All 9 Attempted Fields Remain Intact
  // =========================================================================
  {
    const receiptId = buildHexReceiptId(90);
    const adminReceipt = buildSanitizedAdminReceipt(90, { receiptId });
    let saveCalls = 0;
    let getMode: 'READY' | 'THROW' | 'HOLD' = 'READY';

    const controller = new LibraryQuarantineHumanReviewModalController(
      curator,
      {
        humanReviewEnabled: true,
        getCaseFn: async () => {
          if (getMode === 'THROW') {
            throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.GET_CALL_FAILED);
          }
          if (getMode === 'HOLD') {
            return {
              ok: false,
              status: 'HOLD',
              errorCode: 'REVIEW_DRAFT_NOT_PENDING_HOLD',
              errorMessage: 'Draft is on hold.',
              receiptId,
              isSanitized: false,
              isVerifiedSafe: false,
              isRightsApproved: false,
              isPublished: false,
              isReadyForPeia: false,
            };
          }
          return {
            ok: true,
            status: 'READY',
            receiptId,
            sourceRevision: 2,
            draftStatus: 'PENDING_HUMAN_REVIEW',
            adminReceipt,
            currentRevision: 0,
            reviewCase: null,
            isSanitized: false,
            isVerifiedSafe: false,
            isRightsApproved: false,
            isPublished: false,
            isReadyForPeia: false,
          };
        },
        saveCaseFn: async () => {
          saveCalls += 1;
          throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.SAVE_CALL_FAILED);
        },
      }
    );

    await controller.openCase(adminReceipt, 2);
    controller.updateFormField('status', 'METADATA_RECORDED');
    controller.updateFormField('titleAr', 'وثيقة محمية ضد فقدان البيانات');
    controller.updateFormField('sourceEvidenceNotes', 'مصدر موثق رقم 55');

    await controller.saveCase();
    assert.notEqual(controller.getSnapshot().uncertainState, null);

    getMode = 'THROW';
    await controller.reloadCase();
    assert.equal(saveCalls, 1);
    assert.notEqual(controller.getSnapshot().uncertainState, null);
    assert.equal(
      controller.getSnapshot().uncertainState?.verificationStatus,
      'VERIFY_CALL_FAILED'
    );
    assert.equal(
      controller.getSnapshot().form.titleAr,
      'وثيقة محمية ضد فقدان البيانات'
    );
    assert.equal(
      controller.getSnapshot().form.sourceEvidenceNotes,
      'مصدر موثق رقم 55'
    );
    assert.equal(controller.acknowledgeUncommittedSaveAfterVerify(), false);

    getMode = 'HOLD';
    await controller.reloadCase();
    assert.equal(saveCalls, 1);
    assert.notEqual(controller.getSnapshot().uncertainState, null);
    assert.equal(
      controller.getSnapshot().uncertainState?.verificationStatus,
      'VERIFY_HOLD'
    );
    assert.equal(
      controller.getSnapshot().form.titleAr,
      'وثيقة محمية ضد فقدان البيانات'
    );

    passed += 1;
    console.log(
      'PASS [9/15] (Case C): GET failure or server HOLD during uncertainty keeps uncertainState and all attempted form fields intact'
    );
  }

  // =========================================================================
  // TEST 10 (Case D): Concurrent Mismatching Case, Future Revision, or Changed Source Context
  //                   During Uncertainty -> No False Success, No Overwrite, Remain Held
  // =========================================================================
  {
    const receiptId = buildHexReceiptId(100);
    const adminReceipt = buildSanitizedAdminReceipt(100, { receiptId });
    let onCaseSavedCount = 0;
    let serverSourceRevision = 2;
    let serverRevision = 0;
    let serverCase: SanitizedLibraryQuarantineHumanReviewCaseDto | null = null;

    const controller = new LibraryQuarantineHumanReviewModalController(
      curator,
      {
        humanReviewEnabled: true,
        onCaseSaved: () => {
          onCaseSavedCount += 1;
        },
        getCaseFn: async () => ({
          ok: true,
          status: 'READY',
          receiptId,
          sourceRevision: serverSourceRevision,
          draftStatus: 'PENDING_HUMAN_REVIEW',
          adminReceipt,
          currentRevision: serverRevision,
          reviewCase: serverCase,
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
        }),
        saveCaseFn: async () => {
          throw new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.SAVE_CALL_FAILED);
        },
      }
    );

    await controller.openCase(adminReceipt, 2);
    controller.updateFormField('status', 'METADATA_RECORDED');
    controller.updateFormField('titleAr', 'مسودة المراجع الأول');
    controller.updateFormField('sourceEvidenceNotes', 'مصدر المراجع الأول');

    await controller.saveCase();
    assert.notEqual(controller.getSnapshot().uncertainState, null);

    // 10a. Server is at expectedRevision + 1 (revision 1), but with DIFFERENT editorial content
    serverRevision = 1;
    serverCase = buildSanitizedCaseDto(receiptId, 1, {
      status: 'METADATA_RECORDED',
      titleAr: 'مسودة مراجع آخر مختلف تماماً',
      sourceEvidenceNotes: 'مصدر آخر',
    });

    await controller.reloadCase();
    assert.equal(onCaseSavedCount, 0);
    assert.notEqual(controller.getSnapshot().uncertainState, null);
    assert.equal(
      controller.getSnapshot().uncertainState?.verificationStatus,
      'REVISION_OR_CONTENT_MISMATCH'
    );
    assert.equal(
      controller.getSnapshot().form.titleAr,
      'مسودة المراجع الأول'
    );
    assert.equal(controller.acknowledgeUncommittedSaveAfterVerify(), false);

    // 10b. Server jumped to future revision 3 even with matching fields -> still mismatch
    serverRevision = 3;
    serverCase = buildSanitizedCaseDto(receiptId, 3, {
      status: 'METADATA_RECORDED',
      titleAr: 'مسودة المراجع الأول',
      titleEn: '',
      issuingOrganization: '',
      summaryAr: '',
      summaryEn: '',
      sourceEvidenceNotes: 'مصدر المراجع الأول',
      rightsEvidenceNotes: '',
      editorialNotes: '',
    });

    await controller.reloadCase();
    assert.equal(onCaseSavedCount, 0);
    assert.notEqual(controller.getSnapshot().uncertainState, null);
    assert.equal(
      controller.getSnapshot().uncertainState?.verificationStatus,
      'REVISION_OR_CONTENT_MISMATCH'
    );
    assert.equal(
      controller.getSnapshot().form.titleAr,
      'مسودة المراجع الأول'
    );

    // 10c. Source revision changed on server (sourceRevision 2 -> 5)
    serverSourceRevision = 5;
    serverRevision = 1;
    serverCase = buildSanitizedCaseDto(receiptId, 1, {
      sourceRevision: 5,
      status: 'METADATA_RECORDED',
      titleAr: 'مسودة المراجع الأول',
      titleEn: '',
      issuingOrganization: '',
      summaryAr: '',
      summaryEn: '',
      sourceEvidenceNotes: 'مصدر المراجع الأول',
      rightsEvidenceNotes: '',
      editorialNotes: '',
    });

    await controller.reloadCase();
    assert.equal(onCaseSavedCount, 0);
    assert.notEqual(controller.getSnapshot().uncertainState, null);
    assert.equal(
      controller.getSnapshot().uncertainState?.verificationStatus,
      'SOURCE_CHANGED'
    );
    assert.equal(
      controller.getSnapshot().form.titleAr,
      'مسودة المراجع الأول'
    );

    passed += 1;
    console.log(
      'PASS [10/15] (Case D): Concurrent mismatching case, future revision, or changed sourceRevision never triggers false success or overwrites form'
    );
  }

  // =========================================================================
  // TEST 11 (Case E): Malformed Save Response (`SAVE_RESPONSE_CONTRACT_INVALID` / `CASE_DTO_CONTRACT_INVALID`)
  //                   Enters Conservative Unconfirmed-Save Hold (`SAVE_RESULT_UNCONFIRMED`)
  // =========================================================================
  {
    const receiptId = buildHexReceiptId(110);
    const adminReceipt = buildSanitizedAdminReceipt(110, { receiptId });
    let errorToThrow: string =
      HUMAN_REVIEW_CLIENT_SAFE_ERRORS.SAVE_RESPONSE_CONTRACT_INVALID;

    const controller = new LibraryQuarantineHumanReviewModalController(
      curator,
      {
        humanReviewEnabled: true,
        getCaseFn: async () => ({
          ok: true,
          status: 'READY',
          receiptId,
          sourceRevision: 2,
          draftStatus: 'PENDING_HUMAN_REVIEW',
          adminReceipt,
          currentRevision: 0,
          reviewCase: null,
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
        }),
        saveCaseFn: async () => {
          throw new Error(errorToThrow);
        },
      }
    );

    await controller.openCase(adminReceipt, 2);
    controller.updateFormField('titleAr', 'اختبار استجابة غير صالحة');
    await controller.saveCase();

    assert.equal(
      controller.getSnapshot().uncertainState?.errorCode,
      HUMAN_REVIEW_CLIENT_SAVE_UNCONFIRMED_CODE
    );
    assert.equal(controller.getSnapshot().saveError, null);
    assert.equal(
      controller.getSnapshot().form.titleAr,
      'اختبار استجابة غير صالحة'
    );

    errorToThrow = HUMAN_REVIEW_CLIENT_SAFE_ERRORS.CASE_DTO_CONTRACT_INVALID;
    await controller.openCase(adminReceipt, 2);
    controller.updateFormField('titleAr', 'اختبار عقد السجل');
    await controller.saveCase();

    assert.equal(
      controller.getSnapshot().uncertainState?.errorCode,
      HUMAN_REVIEW_CLIENT_SAVE_UNCONFIRMED_CODE
    );
    assert.equal(controller.getSnapshot().form.titleAr, 'اختبار عقد السجل');

    passed += 1;
    console.log(
      'PASS [11/15] (Case E): Malformed save response (SAVE_RESPONSE_CONTRACT_INVALID / CASE_DTO_CONTRACT_INVALID) enters conservative unconfirmed-save hold'
    );
  }

  // =========================================================================
  // TEST 12 (Case F): Explicit Server `UNKNOWN` (`TRANSACTION_COMMIT_UNCERTAIN`) Preserves
  //                   9-Field Non-Destructive Verification & Server `HOLD` Path Remains Intact
  // =========================================================================
  {
    const receiptId = buildHexReceiptId(120);
    const adminReceipt = buildSanitizedAdminReceipt(120, { receiptId });
    let saveMode: 'UNKNOWN' | 'HOLD' = 'UNKNOWN';

    const controller = new LibraryQuarantineHumanReviewModalController(
      curator,
      {
        humanReviewEnabled: true,
        getCaseFn: async () => ({
          ok: true,
          status: 'READY',
          receiptId,
          sourceRevision: 2,
          draftStatus: 'PENDING_HUMAN_REVIEW',
          adminReceipt,
          currentRevision: 0,
          reviewCase: null,
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
        }),
        saveCaseFn: async () => {
          if (saveMode === 'HOLD') {
            return {
              ok: false,
              status: 'HOLD',
              caseSaveOutcome: 'HOLD',
              caseSaved: false,
              errorCode: 'QUARANTINE_RECEIPT_NOT_FOUND_HOLD',
              errorMessage: 'Quarantine receipt not found.',
              receiptId,
              isSanitized: false,
              isVerifiedSafe: false,
              isRightsApproved: false,
              isPublished: false,
              isReadyForPeia: false,
            };
          }
          return {
            ok: false,
            status: 'UNKNOWN',
            caseSaveOutcome: 'UNKNOWN',
            caseSaved: null,
            errorCode: 'TRANSACTION_COMMIT_UNCERTAIN',
            errorMessage: 'Transaction commit confirmation lost.',
            receiptId,
            isSanitized: false,
            isVerifiedSafe: false,
            isRightsApproved: false,
            isPublished: false,
            isReadyForPeia: false,
          };
        },
      }
    );

    await controller.openCase(adminReceipt, 2);
    controller.updateFormField('titleAr', 'مسودة معاملة غير مؤكدة');
    await controller.saveCase();

    assert.equal(
      controller.getSnapshot().uncertainState?.errorCode,
      'TRANSACTION_COMMIT_UNCERTAIN'
    );
    assert.equal(
      controller.getSnapshot().uncertainState?.origin,
      'SERVER_TRANSACTION_UNCERTAIN'
    );

    await controller.reloadCase();
    assert.equal(
      controller.getSnapshot().uncertainState?.verificationStatus,
      'STILL_AT_EXPECTED_REVISION'
    );
    assert.equal(
      controller.getSnapshot().form.titleAr,
      'مسودة معاملة غير مؤكدة'
    );

    assert.equal(controller.acknowledgeUncommittedSaveAfterVerify(), true);
    saveMode = 'HOLD';
    const holdRes = await controller.saveCase();
    assert.equal(holdRes?.status, 'HOLD');
    assert.equal(controller.getSnapshot().uncertainState, null);
    assert.equal(
      controller.getSnapshot().saveError,
      'QUARANTINE_RECEIPT_NOT_FOUND_HOLD: Quarantine receipt not found.'
    );

    passed += 1;
    console.log(
      'PASS [12/15] (Case F): Explicit server UNKNOWN shares 9-field non-destructive verification and server HOLD path remains intact'
    );
  }

  // =========================================================================
  // TEST 13 (Case G): Pre-Dispatch Conditions (`FEATURE_NOT_RELEASED`, `BACKEND_UNAVAILABLE`,
  //                   Local Validation Failures) Do NOT Enter `uncertainState`
  // =========================================================================
  {
    const receiptId = buildHexReceiptId(130);
    const adminReceipt = buildSanitizedAdminReceipt(130, { receiptId });
    let saveCalls = 0;
    let saveThrowError: Error = new Error(
      HUMAN_REVIEW_CLIENT_SAFE_ERRORS.BACKEND_UNAVAILABLE
    );

    const controller = new LibraryQuarantineHumanReviewModalController(
      curator,
      {
        humanReviewEnabled: true,
        getCaseFn: async () => ({
          ok: true,
          status: 'READY',
          receiptId,
          sourceRevision: 2,
          draftStatus: 'PENDING_HUMAN_REVIEW',
          adminReceipt,
          currentRevision: 0,
          reviewCase: null,
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
        }),
        saveCaseFn: async () => {
          saveCalls += 1;
          throw saveThrowError;
        },
      }
    );

    await controller.openCase(adminReceipt, 2);

    const invalidRes = await controller.saveCase();
    assert.equal(invalidRes, null);
    assert.equal(saveCalls, 0);
    assert.equal(controller.getSnapshot().uncertainState, null);
    assert.equal(
      controller.getSnapshot().saveError,
      HUMAN_REVIEW_CLIENT_SAFE_ERRORS.EMPTY_REVIEW_CASE_NOT_ALLOWED
    );

    controller.updateFormField('titleAr', 'عنوان صالح');
    const backendUnavailRes = await controller.saveCase();
    assert.equal(backendUnavailRes, null);
    assert.equal(saveCalls, 1);
    assert.equal(controller.getSnapshot().uncertainState, null);
    assert.equal(
      controller.getSnapshot().saveError,
      HUMAN_REVIEW_CLIENT_SAFE_ERRORS.BACKEND_UNAVAILABLE
    );

    saveThrowError = new Error(
      HUMAN_REVIEW_CLIENT_SAFE_ERRORS.FEATURE_NOT_RELEASED
    );
    const notReleasedRes = await controller.saveCase();
    assert.equal(notReleasedRes, null);
    assert.equal(controller.getSnapshot().uncertainState, null);
    assert.equal(controller.getSnapshot().humanReviewEnabled, false);
    assert.equal(
      controller.getSnapshot().saveError,
      HUMAN_REVIEW_CLIENT_SAFE_ERRORS.FEATURE_NOT_RELEASED
    );

    passed += 1;
    console.log(
      'PASS [13/15] (Case G): Pre-dispatch errors (validation, BACKEND_UNAVAILABLE, FEATURE_NOT_RELEASED) do not enter uncertainState'
    );
  }

  // =========================================================================
  // TEST 14 (Case H): Session Isolation — Receipt Switch, Close, or User Switch While
  //                   `SAVE` or Verification `GET` Is In-Flight Cannot Contaminate State
  // =========================================================================
  {
    const receiptA = buildSanitizedAdminReceipt(141);
    const receiptB = buildSanitizedAdminReceipt(142);
    let rejectInFlightSaveA: ((err: Error) => void) | null = null;
    let resolveInFlightVerifyGetA:
      | ((res: GetLibraryQuarantineHumanReviewCaseResponseDto) => void)
      | null = null;
    let isVerifyGetForA = false;

    const controller = new LibraryQuarantineHumanReviewModalController(
      curator,
      {
        humanReviewEnabled: true,
        getCaseFn: (rId) => {
          if (rId === receiptA.receiptId && isVerifyGetForA) {
            return new Promise<GetLibraryQuarantineHumanReviewCaseResponseDto>(
              (res) => {
                resolveInFlightVerifyGetA = res;
              }
            );
          }
          const adminReceipt = rId === receiptA.receiptId ? receiptA : receiptB;
          return Promise.resolve({
            ok: true,
            status: 'READY',
            receiptId: rId,
            sourceRevision: 2,
            draftStatus: 'PENDING_HUMAN_REVIEW',
            adminReceipt,
            currentRevision: 0,
            reviewCase: null,
            isSanitized: false,
            isVerifiedSafe: false,
            isRightsApproved: false,
            isPublished: false,
            isReadyForPeia: false,
          });
        },
        saveCaseFn: ({ receiptId: rId }) => {
          if (rId === receiptA.receiptId && !isVerifyGetForA) {
            return new Promise<SaveLibraryQuarantineHumanReviewCaseResponseDto>(
              (_res, rej) => {
                rejectInFlightSaveA = rej;
              }
            );
          }
          return Promise.reject(
            new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.SAVE_CALL_FAILED)
          );
        },
      }
    );

    await controller.openCase(receiptA, 2);
    controller.updateFormField('titleAr', 'مسودة الإيصال أ');
    const inFlightSavePromiseA = controller.saveCase();

    await controller.openCase(receiptB, 2);
    rejectInFlightSaveA!(
      new Error(HUMAN_REVIEW_CLIENT_SAFE_ERRORS.SAVE_CALL_FAILED)
    );
    const lateSaveARes = await inFlightSavePromiseA;
    assert.equal(lateSaveARes, null);
    assert.equal(
      controller.getSnapshot().activeReceipt?.receiptId,
      receiptB.receiptId
    );
    assert.equal(controller.getSnapshot().uncertainState, null);
    assert.equal(controller.getSnapshot().form.titleAr, '');

    isVerifyGetForA = false;
    await controller.openCase(receiptA, 2);
    isVerifyGetForA = true;
    controller.updateFormField('titleAr', 'مسودة الإيصال أ للتحقق');
    await controller.saveCase();
    assert.notEqual(controller.getSnapshot().uncertainState, null);

    const verifyPromiseA = controller.reloadCase();
    controller.closeModal();

    resolveInFlightVerifyGetA!({
      ok: true,
      status: 'READY',
      receiptId: receiptA.receiptId,
      sourceRevision: 2,
      draftStatus: 'PENDING_HUMAN_REVIEW',
      adminReceipt: receiptA,
      currentRevision: 1,
      reviewCase: buildSanitizedCaseDto(receiptA.receiptId, 1, {
        status: 'IN_REVIEW',
        titleAr: 'مسودة الإيصال أ للتحقق',
        titleEn: '',
        issuingOrganization: '',
        summaryAr: '',
        summaryEn: '',
        sourceEvidenceNotes: '',
        rightsEvidenceNotes: '',
        editorialNotes: '',
      }),
      isSanitized: false,
      isVerifiedSafe: false,
      isRightsApproved: false,
      isPublished: false,
      isReadyForPeia: false,
    });

    const lateVerifyRes = await verifyPromiseA;
    assert.equal(lateVerifyRes, null);
    assert.equal(controller.getSnapshot().isOpen, false);
    assert.equal(controller.getSnapshot().uncertainState, null);

    passed += 1;
    console.log(
      'PASS [14/15] (Case H): Receipt switch and modal close during in-flight save or verification GET prevent cross-session contamination'
    );
  }

  // =========================================================================
  // TEST 15 (Case I): Bilingual AR/EN UI Rendering of `SAVE_RESULT_UNCONFIRMED` vs
  //                   `TRANSACTION_COMMIT_UNCERTAIN`, Verification Banner, and Zero Raw Leak
  // =========================================================================
  {
    const receiptId = buildHexReceiptId(150);
    const adminReceipt = buildSanitizedAdminReceipt(150, { receiptId });

    const controller = new LibraryQuarantineHumanReviewModalController(
      curator,
      {
        humanReviewEnabled: true,
        getCaseFn: async () => ({
          ok: true,
          status: 'READY',
          receiptId,
          sourceRevision: 2,
          draftStatus: 'PENDING_HUMAN_REVIEW',
          adminReceipt,
          currentRevision: 0,
          reviewCase: null,
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
        }),
        saveCaseFn: async () => {
          throw new Error(
            'FirebaseError: INTERNAL raw-stack-trace-secret gs://internal-bucket/secret.pdf'
          );
        },
      }
    );

    await controller.openCase(adminReceipt, 2);
    controller.updateFormField('titleAr', 'عنوان لاختبار واجهة عدم اليقين');
    await controller.saveCase();

    const unconfirmedArHtml = renderToStaticMarkup(
      React.createElement(LibraryQuarantineHumanReviewModal, {
        controller,
        isAr: true,
      })
    );
    const unconfirmedEnHtml = renderToStaticMarkup(
      React.createElement(LibraryQuarantineHumanReviewModal, {
        controller,
        isAr: false,
      })
    );

    assert.equal(
      unconfirmedArHtml.includes(HUMAN_REVIEW_CLIENT_SAVE_UNCONFIRMED_CODE),
      true
    );
    assert.equal(
      unconfirmedEnHtml.includes(HUMAN_REVIEW_CLIENT_SAVE_UNCONFIRMED_CODE),
      true
    );
    assert.equal(
      unconfirmedArHtml.includes('قد يكون الحفظ قد اكتمل على الخادم أو لم يكتمل'),
      true
    );
    assert.equal(
      unconfirmedEnHtml.includes(
        'the server write may or may not have completed'
      ),
      true
    );
    assert.equal(
      unconfirmedArHtml.includes('raw-stack-trace-secret'),
      false
    );
    assert.equal(unconfirmedArHtml.includes('gs://'), false);
    assert.equal(
      unconfirmedArHtml.includes(
        'acknowledge-uncommitted-human-review-save-btn'
      ),
      false
    );

    await controller.reloadCase();

    const verifiedArHtml = renderToStaticMarkup(
      React.createElement(LibraryQuarantineHumanReviewModal, {
        controller,
        isAr: true,
      })
    );
    const verifiedEnHtml = renderToStaticMarkup(
      React.createElement(LibraryQuarantineHumanReviewModal, {
        controller,
        isAr: false,
      })
    );

    assert.equal(
      verifiedArHtml.includes(
        'quarantine-human-review-uncertain-verification-status'
      ),
      true
    );
    assert.equal(
      verifiedArHtml.includes('acknowledge-uncommitted-human-review-save-btn'),
      true
    );
    assert.equal(
      verifiedEnHtml.includes('Unlock preserved draft at verified revision'),
      true
    );
    assert.equal(
      verifiedArHtml.includes('عنوان لاختبار واجهة عدم اليقين'),
      true
    );

    passed += 1;
    console.log(
      'PASS [15/15] (Case I): Bilingual AR/EN rendering of SAVE_RESULT_UNCONFIRMED, verification notice, unlock action, and zero raw error leak verified'
    );
  }

  console.log(
    `\nALL ${passed}/15 LIB-FILE-HUMAN-CASEWORK-01 & LIB-HUMAN-CASE-SAVE-RECOVERY-01 CLIENT TESTS PASSED.`
  );
}

runTests().catch((err) => {
  console.error('LIB-FILE-HUMAN-CASEWORK-01 CLIENT TESTS FAILED:', err);
  process.exit(1);
});
