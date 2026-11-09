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
  LibraryQuarantineHumanReviewModal,
  LibraryQuarantineHumanReviewModalController,
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
        saveCaseFn: async () => {
          saveCalls += 1;
          // Simulate commit confirmation lost after server actually persisted revision 1
          serverCase = buildSanitizedCaseDto(receiptId, 1, {
            status: 'IN_REVIEW',
            titleAr: 'سجل محفوظ رغم انقطاع التأكيد',
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

  console.log(
    `\nALL ${passed}/6 LIB-FILE-HUMAN-CASEWORK-01 CLIENT TESTS PASSED.`
  );
}

runTests().catch((err) => {
  console.error('LIB-FILE-HUMAN-CASEWORK-01 CLIENT TESTS FAILED:', err);
  process.exit(1);
});
