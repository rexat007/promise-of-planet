import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { React: typeof React }).React = React;
import {
  AdminPermission,
  AdminRole,
  type AdminUser,
} from '../src/types/admin';
import type {
  SanitizedLibraryQuarantineAdminReceiptDto,
} from '../src/services/libraryAdminClient';
import {
  LibraryQuarantineReviewWorkbenchClient,
  WORKBENCH_CLIENT_SAFE_ERRORS,
  buildLinkQuarantineReviewDraftPayload,
  buildListQuarantineReviewWorkbenchPayload,
  canPrepareLibraryQuarantineReviewDraft,
  isLibraryQuarantineReviewWorkbenchEnabled,
  isQuarantineWorkbenchItemEligibleForDraftLink,
  toFallbackUnavailableWorkbenchDisplayItems,
  validateLibraryQuarantineReviewDraftLinkResponse,
  validateLibraryQuarantineReviewWorkbenchListResponse,
  type LibraryQuarantineReviewDraftCallableBridgeFailureDto,
  type LibraryQuarantineReviewDraftCallableBridgeResponseDto,
  type LibraryQuarantineReviewDraftCallableBridgeSuccessDto,
  type SanitizedLibraryQuarantineReviewWorkbenchItemDto,
} from '../src/services/libraryQuarantineReviewWorkbenchClient';
import {
  AdminLibraryManagement,
  LibraryQuarantineReceiptsInboxController,
} from '../src/components/library/AdminLibraryManagement';

function buildHexReceiptId(index: number): string {
  return index.toString(16).padStart(32, '0');
}

function buildHexSha256(index: number): string {
  return index.toString(16).padStart(64, 'b');
}

function buildSanitizedAdminReceipt(
  index = 1,
  overrides: Partial<SanitizedLibraryQuarantineAdminReceiptDto> = {}
): SanitizedLibraryQuarantineAdminReceiptDto {
  const receiptId = overrides.receiptId ?? buildHexReceiptId(index);
  const format = overrides.format ?? 'PDF';
  const ext = format === 'PDF' ? 'pdf' : 'docx';
  const mime =
    format === 'PDF'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const inspection =
    format === 'PDF'
      ? 'PDF_REQUIRES_ISOLATED_PARSER'
      : 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION';
  const state = overrides.state ?? 'Quarantined';
  const minute = String(index % 60).padStart(2, '0');
  const createdAt = `2026-11-08T10:${minute}:00.000Z`;
  const updatedAt = `2026-11-08T10:${minute}:03.000Z`;

  const hasVerifiedStorageWrite =
    overrides.hasVerifiedStorageWrite ?? state === 'Quarantined';
  const isQuarantinedPrivateOnly =
    overrides.isQuarantinedPrivateOnly ?? state === 'Quarantined';
  const reconciliationRequired =
    overrides.reconciliationRequired ?? state === 'NeedsReconciliation';
  const reconciliationReason =
    overrides.reconciliationReason !== undefined
      ? overrides.reconciliationReason
      : state === 'NeedsReconciliation'
        ? 'GCS conditional write outcome was ambiguous during finalize.'
        : null;
  const rejectionReasonCode =
    overrides.rejectionReasonCode !== undefined
      ? overrides.rejectionReasonCode
      : state === 'Rejected'
        ? 'PDF_ACTIVE_CONTENT_DETECTED'
        : null;

  return Object.freeze({
    receiptId,
    uploaderUid: 'admin-curator',
    originalFilename: `climate-report-${index}.${ext}`,
    sanitizedFilename: `climate-report-${index}.${ext}`,
    format,
    canonicalExtension: ext,
    canonicalMimeType: mime,
    byteSize: 8192 + index,
    sha256: buildHexSha256(index),
    state,
    deepInspectionStatus: inspection,
    hasVerifiedStorageWrite,
    reconciliationRequired,
    reconciliationReason,
    rejectionReasonCode,
    createdAt,
    updatedAt,
    isQuarantinedPrivateOnly,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
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

function build13KeySuccessDto(
  receiptId: string,
  disposition: 'CREATED' | 'IDEMPOTENT_EXISTING' = 'CREATED'
): LibraryQuarantineReviewDraftCallableBridgeSuccessDto {
  return Object.freeze({
    ok: true as const,
    status: 'LINKED_PENDING_HUMAN_REVIEW' as const,
    receiptId,
    sourceRevision: 3,
    reviewState: 'PENDING_HUMAN_REVIEW' as const,
    disposition,
    draftCreationOutcome: disposition,
    draftCreated: disposition === 'CREATED',
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
}

function build13KeyFailureDto(
  receiptId: string | null,
  draftCreationOutcome: 'NOT_CREATED' | 'UNKNOWN',
  errorCode: LibraryQuarantineReviewDraftCallableBridgeFailureDto['errorCode'] = 'DRAFT_STORE_WRITE_FAILED_HOLD'
): LibraryQuarantineReviewDraftCallableBridgeFailureDto {
  return Object.freeze({
    ok: false as const,
    status: 'HOLD' as const,
    callableStatus:
      draftCreationOutcome === 'UNKNOWN' ? 'aborted' : 'failed-precondition',
    errorCode,
    errorMessage:
      draftCreationOutcome === 'UNKNOWN'
        ? 'Quarantine review draft transaction outcome is ambiguous; manual verification is required.'
        : 'Quarantine review draft was not created due to a precondition hold.',
    receiptId,
    draftCreationOutcome,
    draftCreated: draftCreationOutcome === 'UNKNOWN' ? null : false,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
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
  const inactiveCurator = buildAdminUser(AdminRole.LibraryCurator, {
    id: 'admin-inactive',
    isActive: false,
  });
  const aiAssistant = buildAdminUser(AdminRole.AIAssistant);
  const contentEditor = buildAdminUser(AdminRole.ContentEditor);
  const viewerUser = buildAdminUser(AdminRole.Viewer);

  // =========================================================================
  // TEST 1: Feature Flag Gating & Reviewer RBAC
  // =========================================================================
  {
    assert.equal(isLibraryQuarantineReviewWorkbenchEnabled({}), false);
    assert.equal(
      isLibraryQuarantineReviewWorkbenchEnabled({
        VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED: 'false',
      }),
      false
    );
    assert.equal(
      isLibraryQuarantineReviewWorkbenchEnabled({
        VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED: '1',
      }),
      false
    );
    assert.equal(
      isLibraryQuarantineReviewWorkbenchEnabled({
        VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED: 'true',
      }),
      true
    );

    assert.equal(canPrepareLibraryQuarantineReviewDraft(owner), true);
    assert.equal(canPrepareLibraryQuarantineReviewDraft(curator), true);
    assert.equal(canPrepareLibraryQuarantineReviewDraft(rightsReviewer), true);

    assert.equal(canPrepareLibraryQuarantineReviewDraft(viewOnlyCurator), false);
    assert.equal(canPrepareLibraryQuarantineReviewDraft(inactiveCurator), false);
    assert.equal(canPrepareLibraryQuarantineReviewDraft(aiAssistant), false);
    assert.equal(canPrepareLibraryQuarantineReviewDraft(contentEditor), false);
    assert.equal(canPrepareLibraryQuarantineReviewDraft(viewerUser), false);
    assert.equal(canPrepareLibraryQuarantineReviewDraft(null), false);
    assert.equal(canPrepareLibraryQuarantineReviewDraft(undefined), false);

    passed += 1;
    console.log(
      '✓ 1. Feature flag gate (VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED) defaults to false and reviewer RBAC enforces active human Library Review permission'
    );
  }

  // =========================================================================
  // TEST 2: Exact Callable Payloads & Strict Workbench List Contract Validation
  // =========================================================================
  {
    const listPayload = buildListQuarantineReviewWorkbenchPayload();
    assert.deepEqual(listPayload, { action: 'listQuarantineReviewWorkbench' });

    const r1Id = buildHexReceiptId(1);
    const linkPayload = buildLinkQuarantineReviewDraftPayload(r1Id);
    assert.deepEqual(linkPayload, {
      action: 'linkQuarantineReviewDraft',
      receiptId: r1Id,
    });

    assert.throws(
      () => buildLinkQuarantineReviewDraftPayload('INVALID-RECEIPT-ID'),
      /INVALID_RECEIPT_ID/
    );

    const validListItems: SanitizedLibraryQuarantineReviewWorkbenchItemDto[] = [
      {
        revision: 3,
        adminReceipt: buildSanitizedAdminReceipt(1, { state: 'Quarantined' }),
        draftStatus: 'NOT_LINKED',
      },
      {
        revision: 4,
        adminReceipt: buildSanitizedAdminReceipt(2, { state: 'Quarantined' }),
        draftStatus: 'PENDING_HUMAN_REVIEW',
      },
      {
        revision: 2,
        adminReceipt: buildSanitizedAdminReceipt(3, {
          state: 'NeedsReconciliation',
        }),
        draftStatus: 'NEEDS_RECONCILIATION_HOLD',
      },
      {
        revision: 1,
        adminReceipt: buildSanitizedAdminReceipt(4, { state: 'Rejected' }),
        draftStatus: 'NOT_ELIGIBLE',
      },
    ];

    const validatedList = validateLibraryQuarantineReviewWorkbenchListResponse({
      receipts: validListItems,
    });
    assert.equal(validatedList.length, 4);
    assert.equal(validatedList[0].draftStatus, 'NOT_LINKED');
    assert.equal(validatedList[1].draftStatus, 'PENDING_HUMAN_REVIEW');
    assert.equal(validatedList[2].draftStatus, 'NEEDS_RECONCILIATION_HOLD');
    assert.equal(validatedList[3].draftStatus, 'NOT_ELIGIBLE');

    // Reject > 20 items
    const twentyOneItems = Array.from({ length: 21 }, (_, idx) => ({
      revision: 3,
      adminReceipt: buildSanitizedAdminReceipt(idx + 1),
      draftStatus: 'NOT_LINKED',
    }));
    assert.throws(
      () =>
        validateLibraryQuarantineReviewWorkbenchListResponse({
          receipts: twentyOneItems,
        }),
      /WORKBENCH_LIST_CONTRACT_INVALID/
    );

    // Reject duplicate receiptId
    assert.throws(
      () =>
        validateLibraryQuarantineReviewWorkbenchListResponse({
          receipts: [validListItems[0], validListItems[0]],
        }),
      /WORKBENCH_LIST_CONTRACT_INVALID/
    );

    // Reject illegal state -> draftStatus transition (e.g., NeedsReconciliation with NOT_LINKED)
    assert.throws(
      () =>
        validateLibraryQuarantineReviewWorkbenchListResponse({
          receipts: [
            {
              revision: 2,
              adminReceipt: buildSanitizedAdminReceipt(3, {
                state: 'NeedsReconciliation',
              }),
              draftStatus: 'NOT_LINKED',
            },
          ],
        }),
      /WORKBENCH_LIST_CONTRACT_INVALID/
    );

    // Reject leaked createdBy or storagePath
    assert.throws(
      () =>
        validateLibraryQuarantineReviewWorkbenchListResponse({
          receipts: [
            {
              ...validListItems[0],
              createdBy: 'admin-curator',
            },
          ],
        }),
      /WORKBENCH_LIST_CONTRACT_INVALID/
    );

    passed += 1;
    console.log(
      '✓ 2. Validates exact callable payloads and workbench list contract (<=20 bound, unique IDs, state->draftStatus invariants, zero private leaks)'
    );
  }

  // =========================================================================
  // TEST 3: Strict 13-Key Link Bridge DTO Validation (CREATED, IDEMPOTENT_EXISTING, NOT_CREATED, UNKNOWN)
  // =========================================================================
  {
    const receiptId = buildHexReceiptId(7);

    const createdDto = validateLibraryQuarantineReviewDraftLinkResponse(
      build13KeySuccessDto(receiptId, 'CREATED'),
      receiptId
    );
    assert.equal(createdDto.ok, true);
    if (createdDto.ok) {
      assert.equal(createdDto.disposition, 'CREATED');
      assert.equal(createdDto.draftCreated, true);
    }

    const idempotentDto = validateLibraryQuarantineReviewDraftLinkResponse(
      build13KeySuccessDto(receiptId, 'IDEMPOTENT_EXISTING'),
      receiptId
    );
    assert.equal(idempotentDto.ok, true);
    if (idempotentDto.ok) {
      assert.equal(idempotentDto.disposition, 'IDEMPOTENT_EXISTING');
      assert.equal(idempotentDto.draftCreated, false);
    }

    const notCreatedDto = validateLibraryQuarantineReviewDraftLinkResponse(
      build13KeyFailureDto(receiptId, 'NOT_CREATED'),
      receiptId
    );
    assert.equal(notCreatedDto.ok, false);
    if (!notCreatedDto.ok) {
      assert.equal(notCreatedDto.draftCreationOutcome, 'NOT_CREATED');
      assert.equal(notCreatedDto.draftCreated, false);
    }

    const unknownDto = validateLibraryQuarantineReviewDraftLinkResponse(
      build13KeyFailureDto(receiptId, 'UNKNOWN'),
      receiptId
    );
    assert.equal(unknownDto.ok, false);
    if (!unknownDto.ok) {
      assert.equal(unknownDto.draftCreationOutcome, 'UNKNOWN');
      assert.equal(unknownDto.draftCreated, null);
    }

    // Reject inconsistent outcome/flag (e.g., UNKNOWN with draftCreated: false)
    assert.throws(
      () =>
        validateLibraryQuarantineReviewDraftLinkResponse(
          {
            ...build13KeyFailureDto(receiptId, 'UNKNOWN'),
            draftCreated: false,
          },
          receiptId
        ),
      /WORKBENCH_LINK_CONTRACT_INVALID/
    );

    // Reject extra 14th key or leaked storagePath/candidate
    assert.throws(
      () =>
        validateLibraryQuarantineReviewDraftLinkResponse(
          {
            ...build13KeySuccessDto(receiptId, 'CREATED'),
            candidate: {},
          },
          receiptId
        ),
      /WORKBENCH_LINK_CONTRACT_INVALID/
    );

    // Reject posture flag escalation
    assert.throws(
      () =>
        validateLibraryQuarantineReviewDraftLinkResponse(
          {
            ...build13KeySuccessDto(receiptId, 'CREATED'),
            isSanitized: true,
          },
          receiptId
        ),
      /WORKBENCH_LINK_CONTRACT_INVALID/
    );

    passed += 1;
    console.log(
      '✓ 3. Validates 13-key link bridge DTOs (CREATED/true, IDEMPOTENT_EXISTING/false, NOT_CREATED/false, UNKNOWN/null) and rejects extra keys or posture escalation'
    );
  }

  // =========================================================================
  // TEST 4: Controller Fallback Mode, Server WORKBENCH_NOT_RELEASED Fallback,
  //         Post-Click Server Refresh, Duplicate Click Guard, UNKNOWN Hold, and Session Staleness
  // =========================================================================
  {
    const r1 = buildSanitizedAdminReceipt(1, { state: 'Quarantined' });
    const r2 = buildSanitizedAdminReceipt(2, { state: 'NeedsReconciliation' });

    // 4a. Default fallback mode (workbenchEnabled: false): does not call listWorkbenchFn
    let legacyCalls = 0;
    let workbenchCalls = 0;
    const fallbackController = new LibraryQuarantineReceiptsInboxController(
      curator,
      async () => {
        legacyCalls += 1;
        return [
          { revision: 3, adminReceipt: r1 },
          { revision: 2, adminReceipt: r2 },
        ];
      },
      undefined,
      {
        workbenchEnabled: false,
        listWorkbenchFn: async () => {
          workbenchCalls += 1;
          return [];
        },
      }
    );

    await fallbackController.loadReceipts();
    assert.equal(legacyCalls, 1);
    assert.equal(workbenchCalls, 0);
    assert.equal(fallbackController.getSnapshot().workbenchEnabled, false);
    assert.equal(
      fallbackController.getSnapshot().draftStatusByReceiptId[r1.receiptId],
      'UNAVAILABLE'
    );
    assert.equal(
      await fallbackController.prepareReviewDraft(r1.receiptId),
      null
    );
    assert.equal(
      toFallbackUnavailableWorkbenchDisplayItems([
        { revision: 3, adminReceipt: r1 },
      ])[0].draftStatus,
      'UNAVAILABLE'
    );

    // 4b. Server WORKBENCH_NOT_RELEASED fallback when UI flag is true
    let fallbackLegacyCalls = 0;
    const serverNotReleasedController =
      new LibraryQuarantineReceiptsInboxController(
        curator,
        async () => {
          fallbackLegacyCalls += 1;
          return [{ revision: 3, adminReceipt: r1 }];
        },
        undefined,
        {
          workbenchEnabled: true,
          listWorkbenchFn: async () => {
            throw new Error(WORKBENCH_CLIENT_SAFE_ERRORS.WORKBENCH_NOT_RELEASED);
          },
        }
      );

    await serverNotReleasedController.loadReceipts();
    assert.equal(fallbackLegacyCalls, 1);
    assert.equal(
      serverNotReleasedController.getSnapshot().workbenchEnabled,
      false
    );
    assert.equal(
      serverNotReleasedController.getSnapshot().draftStatusByReceiptId[
        r1.receiptId
      ],
      'UNAVAILABLE'
    );

    // 4c. Duplicate click prevention + post-action status comes from fresh server read (NOT synthesized)
    let serverDraftStatusForR1: 'NOT_LINKED' | 'PENDING_HUMAN_REVIEW' =
      'NOT_LINKED';
    let listReadCount = 0;
    let linkCallCount = 0;
    let resolveLink!: (
      res: LibraryQuarantineReviewDraftCallableBridgeResponseDto
    ) => void;

    const activeController = new LibraryQuarantineReceiptsInboxController(
      curator,
      undefined,
      undefined,
      {
        workbenchEnabled: true,
        listWorkbenchFn: async () => {
          listReadCount += 1;
          return [
            {
              revision: 3,
              adminReceipt: r1,
              draftStatus: serverDraftStatusForR1,
            },
            {
              revision: 2,
              adminReceipt: r2,
              draftStatus: 'NEEDS_RECONCILIATION_HOLD',
            },
          ];
        },
        linkDraftFn: () => {
          linkCallCount += 1;
          return new Promise((resolve) => {
            resolveLink = resolve;
          });
        },
      }
    );

    await activeController.loadReceipts();
    assert.equal(listReadCount, 1);
    assert.equal(
      activeController.getSnapshot().draftStatusByReceiptId[r1.receiptId],
      'NOT_LINKED'
    );

    // Start manual Prepare review draft click
    const firstClickPromise = activeController.prepareReviewDraft(r1.receiptId);
    assert.equal(
      activeController.getSnapshot().linkingReceiptId,
      r1.receiptId
    );

    // Duplicate click while in-flight is ignored
    const duplicateClick = await activeController.prepareReviewDraft(
      r1.receiptId
    );
    assert.equal(duplicateClick, null);
    assert.equal(linkCallCount, 1);

    // Resolve link with CREATED, and update server state so the fresh server read returns PENDING_HUMAN_REVIEW
    serverDraftStatusForR1 = 'PENDING_HUMAN_REVIEW';
    resolveLink(build13KeySuccessDto(r1.receiptId, 'CREATED'));
    const linkResult = await firstClickPromise;
    assert.equal(linkResult?.ok, true);
    assert.equal(listReadCount, 2); // Fresh server read was triggered!
    assert.equal(
      activeController.getSnapshot().draftStatusByReceiptId[r1.receiptId],
      'PENDING_HUMAN_REVIEW'
    );

    // 4d. UNKNOWN (draftCreated: null) records persistent uncertainty hold and stops without auto-retry
    const r3 = buildSanitizedAdminReceipt(3, { state: 'Quarantined' });
    let unknownLinkCalls = 0;
    const unknownController = new LibraryQuarantineReceiptsInboxController(
      curator,
      undefined,
      undefined,
      {
        workbenchEnabled: true,
        listWorkbenchFn: async () => [
          {
            revision: 3,
            adminReceipt: r3,
            draftStatus: 'NOT_LINKED',
          },
        ],
        linkDraftFn: async () => {
          unknownLinkCalls += 1;
          return build13KeyFailureDto(r3.receiptId, 'UNKNOWN');
        },
      }
    );

    await unknownController.loadReceipts();
    const unknownRes = await unknownController.prepareReviewDraft(r3.receiptId);
    assert.equal(unknownRes?.ok, false);
    assert.equal(unknownLinkCalls, 1);
    assert.equal(
      unknownController.getSnapshot().uncertainHoldByReceiptId[r3.receiptId]
        ?.draftCreationOutcome,
      'UNKNOWN'
    );
    assert.equal(
      unknownController.getSnapshot().uncertainHoldByReceiptId[r3.receiptId]
        ?.draftCreated,
      null
    );

    // Immediate retry click while uncertain hold is active is blocked until manual refresh
    const blockedRetry = await unknownController.prepareReviewDraft(
      r3.receiptId
    );
    assert.equal(blockedRetry, null);
    assert.equal(unknownLinkCalls, 1);

    // 4e. Stale response discarded on account switch / signout
    let resolveStaleLink!: (
      res: LibraryQuarantineReviewDraftCallableBridgeResponseDto
    ) => void;
    const staleController = new LibraryQuarantineReceiptsInboxController(
      curator,
      undefined,
      undefined,
      {
        workbenchEnabled: true,
        listWorkbenchFn: async () => [
          {
            revision: 3,
            adminReceipt: r3,
            draftStatus: 'NOT_LINKED',
          },
        ],
        linkDraftFn: () =>
          new Promise((resolve) => {
            resolveStaleLink = resolve;
          }),
      }
    );
    await staleController.loadReceipts();
    const staleClick = staleController.prepareReviewDraft(r3.receiptId);
    // Switch user while link is in flight
    staleController.setCurrentUser(owner);
    resolveStaleLink(build13KeySuccessDto(r3.receiptId, 'CREATED'));
    const staleOutcome = await staleClick;
    assert.equal(staleOutcome, null);
    assert.equal(staleController.getSnapshot().receipts.length, 0);

    passed += 1;
    console.log(
      '✓ 4. Controller enforces fallback UNAVAILABLE status, duplicate-click lock, fresh server read after CREATED, UNKNOWN hold without auto-retry, and stale session invalidation'
    );
  }

  // =========================================================================
  // TEST 5: Bilingual (AR/RTL & EN/LTR) Single-Inbox Responsive Markup & Browser Boundary
  // =========================================================================
  {
    const rUnlinked = buildSanitizedAdminReceipt(1, {
      originalFilename: 'marine-protection-2026.pdf',
      state: 'Quarantined',
    });
    const rLinked = buildSanitizedAdminReceipt(2, {
      originalFilename: 'clean-air-act-2026.pdf',
      state: 'Quarantined',
    });
    const rReconcile = buildSanitizedAdminReceipt(3, {
      originalFilename: 'biodiversity-protocol.docx',
      format: 'DOCX',
      canonicalExtension: 'docx',
      canonicalMimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      deepInspectionStatus: 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION',
      state: 'NeedsReconciliation',
    });

    const workbenchItems: readonly SanitizedLibraryQuarantineReviewWorkbenchItemDto[] =
      [
        {
          revision: 3,
          adminReceipt: rUnlinked,
          draftStatus: 'NOT_LINKED',
        },
        {
          revision: 4,
          adminReceipt: rLinked,
          draftStatus: 'PENDING_HUMAN_REVIEW',
        },
        {
          revision: 2,
          adminReceipt: rReconcile,
          draftStatus: 'NEEDS_RECONCILIATION_HOLD',
        },
      ];

    // 5a. Reviewer in Arabic (RTL) with Workbench enabled
    const reviewerHtmlAr = renderToStaticMarkup(
      React.createElement(AdminLibraryManagement, {
        currentUser: curator,
        initialTab: 'intake',
        initialLoading: false,
        initialQuarantineWorkbenchItems: workbenchItems,
        quarantineWorkbenchEnabledOverride: true,
        languageOverride: 'ar',
      })
    );

    // Exactly one quarantine-receipts-inbox-section (no duplicate panel)
    const sectionMatches = reviewerHtmlAr.match(
      /data-testid="quarantine-receipts-inbox-section"/g
    );
    assert.equal(sectionMatches?.length, 1);

    // Upload trigger preserved
    assert.equal(
      reviewerHtmlAr.includes('open-library-quarantine-upload-btn'),
      true
    );

    // Both desktop table and mobile cards include all 3 statuses and reviewer action button ONLY for rUnlinked
    assert.equal(
      reviewerHtmlAr.includes(
        `prepare-quarantine-review-draft-btn-${rUnlinked.receiptId}`
      ),
      true
    );
    assert.equal(
      reviewerHtmlAr.includes(
        `prepare-quarantine-review-draft-mobile-btn-${rUnlinked.receiptId}`
      ),
      true
    );
    assert.equal(
      reviewerHtmlAr.includes(
        `prepare-quarantine-review-draft-btn-${rLinked.receiptId}`
      ),
      false
    );
    assert.equal(
      reviewerHtmlAr.includes(
        `prepare-quarantine-review-draft-btn-${rReconcile.receiptId}`
      ),
      false
    );
    assert.equal(
      reviewerHtmlAr.includes('بانتظار المراجعة البشرية (PENDING_HUMAN_REVIEW)'),
      true
    );
    assert.equal(
      reviewerHtmlAr.includes('موقوف للمطابقة — لا يمكن إنشاء مسودة (NEEDS_RECONCILIATION_HOLD)'),
      true
    );

    // 5b. View-only Library user in English (LTR) sees statuses but NO action button
    const viewOnlyHtmlEn = renderToStaticMarkup(
      React.createElement(AdminLibraryManagement, {
        currentUser: viewOnlyCurator,
        initialTab: 'intake',
        initialLoading: false,
        initialQuarantineWorkbenchItems: workbenchItems,
        quarantineWorkbenchEnabledOverride: true,
        languageOverride: 'en',
      })
    );
    assert.equal(
      viewOnlyHtmlEn.includes(
        `prepare-quarantine-review-draft-btn-${rUnlinked.receiptId}`
      ),
      false
    );
    assert.equal(
      viewOnlyHtmlEn.includes(
        'View only — Review permission required to prepare review draft'
      ),
      true
    );
    assert.equal(
      viewOnlyHtmlEn.includes('Pending Human Review (PENDING_HUMAN_REVIEW)'),
      true
    );

    // 5c. Fallback mode (workbench disabled) shows "Review link status unavailable"
    const fallbackHtmlEn = renderToStaticMarkup(
      React.createElement(AdminLibraryManagement, {
        currentUser: curator,
        initialTab: 'intake',
        initialLoading: false,
        initialQuarantineReceipts: [{ revision: 3, adminReceipt: rUnlinked }],
        quarantineWorkbenchEnabledOverride: false,
        languageOverride: 'en',
      })
    );
    assert.equal(
      fallbackHtmlEn.includes('Review link status unavailable'),
      true
    );
    assert.equal(
      fallbackHtmlEn.includes(
        `prepare-quarantine-review-draft-btn-${rUnlinked.receiptId}`
      ),
      false
    );

    // 5d. Verify browser/Node import boundary on workbench client and AdminLibraryManagement.tsx
    const clientSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'src/services/libraryQuarantineReviewWorkbenchClient.ts'
      ),
      'utf8'
    );
    assert.equal(clientSource.includes('functions/src/'), false);
    assert.equal(clientSource.includes('firebase-admin'), false);
    assert.equal(clientSource.includes('node:'), false);

    // Verify client invoker wiring
    const clientListViaInvoker =
      await LibraryQuarantineReviewWorkbenchClient.listQuarantineReviewWorkbench(
        {
          invoker: async (payload) => {
            assert.deepEqual(payload, {
              action: 'listQuarantineReviewWorkbench',
            });
            return { receipts: workbenchItems, data: { receipts: workbenchItems } };
          },
        }
      );
    assert.equal(clientListViaInvoker.length, 3);
    assert.equal(
      isQuarantineWorkbenchItemEligibleForDraftLink(clientListViaInvoker[0]),
      true
    );
    assert.equal(
      isQuarantineWorkbenchItemEligibleForDraftLink(clientListViaInvoker[1]),
      false
    );

    passed += 1;
    console.log(
      '✓ 5. Renders bilingual AR/EN single-inbox responsive markup, reviewer-only action button, fallback unavailable state, and clean browser import boundary'
    );
  }

  console.log(
    `\nALL ${passed} LIB-FILE-WORKBENCH-01 CLIENT & UI TESTS PASSED.`
  );
}

runTests().catch((err) => {
  console.error('LIB-FILE-WORKBENCH-01 client test failure:', err);
  process.exit(1);
});
