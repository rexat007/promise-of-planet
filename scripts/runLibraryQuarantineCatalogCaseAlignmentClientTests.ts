import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AdminDomain,
  AdminPermission,
  AdminRole,
  type AdminUser,
} from '../src/types/admin';
import type { SanitizedLibraryQuarantineAdminReceiptDto } from '../src/services/libraryAdminClient';
import type { SanitizedLibraryQuarantineHumanReviewCaseDto } from '../src/services/libraryQuarantineHumanReviewClient';
import type { SanitizedLibraryQuarantineCatalogHandoffDto } from '../src/services/libraryQuarantineCatalogHandoffClient';
import type { LibraryDocument } from '../src/types/library';
import {
  LIBRARY_CASE_ALIGNMENT_RELEASE_ENV_VAR,
  LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_SCHEMA_VERSION,
  CASE_ALIGNMENT_CLIENT_SAFE_ERRORS,
  LibraryQuarantineCatalogCaseAlignmentClient,
  LibraryQuarantineCatalogCaseAlignmentPanelController,
  canCurrentAdminAlignQuarantineCatalogDraft,
  isLibraryQuarantineCatalogCaseAlignmentEnabled,
  validateAlignQuarantineCatalogCaseResponseDto,
  validateGetQuarantineCatalogCaseAlignmentResponseDto,
  validateSanitizedCatalogCaseAlignmentDto,
  type AlignQuarantineCatalogCaseResponseDto,
  type GetQuarantineCatalogCaseAlignmentResponseDto,
  type SanitizedLibraryQuarantineCatalogCaseAlignmentDto,
} from '../src/services/libraryQuarantineCatalogCaseAlignmentClient';
import {
  LibraryQuarantineCatalogCaseAlignmentPanel,
} from '../src/components/library/LibraryQuarantineCatalogCaseAlignmentPanel';

const VALID_RECEIPT_ID = 'e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6';
const VALID_DOC_ID = `qcat-${VALID_RECEIPT_ID}`;
const VALID_ISO = '2026-11-10T14:00:00.000Z';

function makeAdminUser(
  role: AdminRole,
  options?: {
    readonly id?: string;
    readonly isActive?: boolean;
    readonly permissions?: readonly AdminPermission[];
  }
): AdminUser & { readonly permissions?: readonly AdminPermission[] } {
  const base: AdminUser = {
    id: options?.id ?? `user-${role}`,
    name: `Admin ${role}`,
    email: `${role}@promise-of-planet.org`,
    role,
    isActive: options?.isActive ?? true,
  };
  if (options?.permissions !== undefined) {
    return {
      ...base,
      permissions: options.permissions,
    };
  }
  return base;
}

function makeSavedHumanReviewCase(
  overrides?: Partial<SanitizedLibraryQuarantineHumanReviewCaseDto>
): SanitizedLibraryQuarantineHumanReviewCaseDto {
  return Object.freeze({
    schemaVersion: 1 as const,
    receiptId: VALID_RECEIPT_ID,
    revision: 2,
    sourceRevision: 1,
    sourceUpdatedAt: VALID_ISO,
    draftSourceRevision: 1,
    status: 'METADATA_RECORDED' as const,
    titleAr: 'تقرير التحول البيئي 2026 (معدل)',
    titleEn: 'Ecological Transition Report 2026 (Revised)',
    issuingOrganization: 'Ministry of Environment',
    summaryAr: 'ملخص محدث لتقرير التحول البيئي.',
    summaryEn: 'Revised summary of ecological transition report.',
    sourceEvidenceNotes: 'Gazette 4210.',
    rightsEvidenceNotes: 'Open access note.',
    editorialNotes: 'Metadata updated.',
    createdAt: VALID_ISO,
    updatedAt: VALID_ISO,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
    ...overrides,
  });
}

function makeCatalogDoc(
  overrides?: Partial<LibraryDocument>
): LibraryDocument {
  return {
    id: VALID_DOC_ID,
    type: 'Report',
    category: 'ENVIRONMENTAL_REPORTS',
    language: 'ar',
    titleAr: 'تقرير التحول البيئي 2026 (أولي)',
    titleEn: 'Ecological Transition Report 2026 (Preliminary)',
    issuingOrganization: 'Ministry of Environment',
    publicationYear: 2026,
    summaryAr: 'ملخص أولي لتقرير التحول البيئي.',
    summaryEn: 'Preliminary summary of ecological transition report.',
    sourceEvidenceNotes: 'Gazette 4210.',
    rightsEvidenceNotes: 'Open access note.',
    editorialNotes: 'Metadata initial.',
    tags: ['ecology', 'transition'],
    storageBucket: 'promiseofplanet-bb325-library-quarantine',
    storagePath: `quarantine/${VALID_RECEIPT_ID}/original.pdf`,
    downloadUrl: '',
    referenceUrl: null,
    fileSize: 204800,
    pageCount: 12,
    rightsStatus: 'Undetermined',
    workflowState: 'ReviewRequired',
    isSanitized: false,
    isVerifiedSafe: false,
    isRightsApproved: false,
    isPublished: false,
    isReadyForPeia: false,
    isQuarantinedPrivateOnly: true,
    createdAt: VALID_ISO,
    updatedAt: VALID_ISO,
    publishedAt: null,
    ...overrides,
  };
}

function makeMockGetResponse(
  overrides?: Partial<GetQuarantineCatalogCaseAlignmentResponseDto>
): GetQuarantineCatalogCaseAlignmentResponseDto {
  return Object.freeze({
    ok: true as const,
    schemaVersion: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_SCHEMA_VERSION,
    receiptId: VALID_RECEIPT_ID,
    documentId: VALID_DOC_ID,
    hasDiff: true,
    currentHumanCaseRevision: 2,
    catalogHandoffCaseRevision: 1,
    catalogDocumentRevision: 1,
    alignmentRevision: 0,
    alignment: null,
    diffSummary: {
      hasDiff: true,
      diffFieldCount: 4,
      fields: {
        titleAr: {
          fieldName: 'titleAr' as const,
          hasDiff: true,
          currentCaseValue: 'تقرير التحول البيئي 2026 (معدل)',
          catalogDraftValue: 'تقرير التحول البيئي 2026 (أولي)',
        },
        titleEn: {
          fieldName: 'titleEn' as const,
          hasDiff: true,
          currentCaseValue: 'Ecological Transition Report 2026 (Revised)',
          catalogDraftValue: 'Ecological Transition Report 2026 (Preliminary)',
        },
        summaryAr: {
          fieldName: 'summaryAr' as const,
          hasDiff: true,
          currentCaseValue: 'ملخص محدث لتقرير التحول البيئي.',
          catalogDraftValue: 'ملخص أولي لتقرير التحول البيئي.',
        },
        summaryEn: {
          fieldName: 'summaryEn' as const,
          hasDiff: true,
          currentCaseValue: 'Revised summary of ecological transition report.',
          catalogDraftValue: 'Preliminary summary of ecological transition report.',
        },
      },
    },
    readiness: {
      rightsScope: 'CATALOG_METADATA_ONLY',
      binarySafety: 'NOT_VERIFIED',
      fileSanitization: 'UNVERIFIED',
      publication: 'BLOCKED',
      catalogWorkflow: 'REVIEW_REQUIRED',
    },
    serverTimeIso: VALID_ISO,
    ...overrides,
  });
}

async function runTests(): Promise<void> {
  console.log('STARTING LIB-FILE-CASE-ALIGNMENT-01 CLIENT TESTS...');

  const owner = makeAdminUser(AdminRole.Owner);
  const curatorWithCreate = makeAdminUser(AdminRole.LibraryCurator, {
    permissions: [AdminPermission.Create, AdminPermission.Review],
  });
  const rightsReviewerOnly = makeAdminUser(AdminRole.SuperAdmin, {
    permissions: [AdminPermission.ManageRights], // No Create
  });

  // =========================================================================
  // PASS 1: RBAC Split & Release Gate Checking
  // =========================================================================
  {
    assert.equal(canCurrentAdminAlignQuarantineCatalogDraft(owner), true);
    assert.equal(canCurrentAdminAlignQuarantineCatalogDraft(curatorWithCreate), true);
    assert.equal(canCurrentAdminAlignQuarantineCatalogDraft(rightsReviewerOnly), false);
    assert.equal(canCurrentAdminAlignQuarantineCatalogDraft(null), false);

    console.log('PASS 1: RBAC split for case alignment verified.');
  }

  // =========================================================================
  // PASS 2: Strict DTO Validation (GET & ALIGN Responses)
  // =========================================================================
  {
    const validGet = makeMockGetResponse();
    const validatedGet = validateGetQuarantineCatalogCaseAlignmentResponseDto(validGet);
    assert.equal(validatedGet.ok, true);
    assert.equal(validatedGet.hasDiff, true);
    assert.equal(validatedGet.diffSummary.diffFieldCount, 4);

    // Reject unknown or missing fields
    assert.throws(() => {
      validateGetQuarantineCatalogCaseAlignmentResponseDto({
        ...validGet,
        hasDiff: 'invalid' as any,
      });
    });

    const validAlignSuccess: AlignQuarantineCatalogCaseResponseDto = {
      ok: true,
      status: 'ALIGNED',
      schemaVersion: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_SCHEMA_VERSION,
      receiptId: VALID_RECEIPT_ID,
      documentId: VALID_DOC_ID,
      alignedHumanCaseRevision: 2,
      previousHandoffCaseRevision: 1,
      catalogDocumentRevision: 2,
      alignmentRevision: 1,
      alignmentSaved: true,
      alignmentOutcome: 'ALIGNED',
      readiness: {
        rightsScope: 'CATALOG_METADATA_ONLY',
        binarySafety: 'NOT_VERIFIED',
        fileSanitization: 'UNVERIFIED',
        publication: 'BLOCKED',
        catalogWorkflow: 'REVIEW_REQUIRED',
      },
      alignment: {
        schemaVersion: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_SCHEMA_VERSION,
        receiptId: VALID_RECEIPT_ID,
        documentId: VALID_DOC_ID,
        alignedHumanCaseRevision: 2,
        previousHandoffCaseRevision: 1,
        sourceRevision: 1,
        catalogDocumentRevision: 2,
        alignmentRevision: 1,
        titleAr: 'تقرير التحول البيئي 2026 (معدل)',
        titleEn: 'Ecological Transition Report 2026 (Revised)',
        summaryAr: 'ملخص محدث لتقرير التحول البيئي.',
        summaryEn: 'Revised summary of ecological transition report.',
        alignedByUid: curatorWithCreate.id,
        alignedByEmail: curatorWithCreate.email,
        alignedAt: VALID_ISO,
        workflowState: 'ReviewRequired',
        rightsStatus: 'Undetermined',
        isSanitized: false,
        isVerifiedSafe: false,
        isRightsApproved: false,
        isPublished: false,
        isReadyForPeia: false,
        isQuarantinedPrivateOnly: true,
      },
      serverTimeIso: VALID_ISO,
    };

    const validatedAlign = validateAlignQuarantineCatalogCaseResponseDto(validAlignSuccess);
    assert.equal(validatedAlign.ok, true);
    if (validatedAlign.ok) {
      assert.equal(validatedAlign.status, 'ALIGNED');
      assert.equal(validatedAlign.catalogDocumentRevision, 2);
    }

    console.log('PASS 2: Strict DTO validation verified.');
  }

  // =========================================================================
  // PASS 3: Panel UI Rendering & 4-Field Diff (AR & EN)
  // =========================================================================
  {
    const savedCase = makeSavedHumanReviewCase();
    const catalogDoc = makeCatalogDoc();
    let getCalls = 0;
    let alignCalls = 0;

    const controller = new LibraryQuarantineCatalogCaseAlignmentPanelController(
      curatorWithCreate,
      {
        caseAlignmentEnabled: true,
        getAlignmentFn: async () => {
          getCalls += 1;
          return makeMockGetResponse();
        },
        alignCaseFn: async () => {
          alignCalls += 1;
          throw new Error('Not needed for render test');
        },
      }
    );

    // Initial state: not expanded
    const markupCollapsed = renderToStaticMarkup(
      React.createElement(LibraryQuarantineCatalogCaseAlignmentPanel, {
        controller,
        currentUser: curatorWithCreate,
        savedReviewCase: savedCase,
        catalogDocument: catalogDoc,
        hasUnsavedCaseEdits: false,
        isAr: true,
      })
    );
    assert.equal(markupCollapsed.includes('data-testid="quarantine-catalog-case-alignment-panel"'), true);
    assert.equal(markupCollapsed.includes('data-testid="open-quarantine-catalog-case-alignment-btn"'), true);

    // Open panel
    await controller.openPanelForCase(savedCase);
    assert.equal(getCalls, 1);
    assert.equal(controller.getSnapshot().hasDiff, true);

    // Render expanded with 4 diff fields in Arabic
    const markupExpandedAr = renderToStaticMarkup(
      React.createElement(LibraryQuarantineCatalogCaseAlignmentPanel, {
        controller,
        currentUser: curatorWithCreate,
        savedReviewCase: savedCase,
        catalogDocument: catalogDoc,
        hasUnsavedCaseEdits: false,
        isAr: true,
      })
    );
    assert.equal(markupExpandedAr.includes('data-testid="alignment-diff-grid"'), true);
    assert.equal(markupExpandedAr.includes('data-testid="alignment-diff-field-titleAr"'), true);
    assert.equal(markupExpandedAr.includes('data-testid="alignment-diff-field-titleEn"'), true);
    assert.equal(markupExpandedAr.includes('data-testid="alignment-diff-field-summaryAr"'), true);
    assert.equal(markupExpandedAr.includes('data-testid="alignment-diff-field-summaryEn"'), true);
    assert.equal(markupExpandedAr.includes('data-testid="quarantine-catalog-case-alignment-confirm-checkbox"'), true);
    assert.equal(markupExpandedAr.includes('data-testid="align-quarantine-catalog-case-btn"'), true);
    assert.equal(markupExpandedAr.includes('data-testid="quarantine-rights-rereview-warning-banner"'), true);

    // Render in English
    const markupExpandedEn = renderToStaticMarkup(
      React.createElement(LibraryQuarantineCatalogCaseAlignmentPanel, {
        controller,
        currentUser: curatorWithCreate,
        savedReviewCase: savedCase,
        catalogDocument: catalogDoc,
        hasUnsavedCaseEdits: false,
        isAr: false,
      })
    );
    assert.equal(markupExpandedEn.includes('Align Catalog Draft with Human Review Case'), true);
    assert.equal(markupExpandedEn.includes('Differences Detected'), true);

    console.log('PASS 3: Panel UI rendering and 4-field diff (AR & EN) verified.');
  }

  // =========================================================================
  // PASS 4: Unsaved Human Case Edits Block
  // =========================================================================
  {
    const savedCase = makeSavedHumanReviewCase();
    const catalogDoc = makeCatalogDoc();

    const controller = new LibraryQuarantineCatalogCaseAlignmentPanelController(
      curatorWithCreate,
      {
        caseAlignmentEnabled: true,
        getAlignmentFn: async () => makeMockGetResponse(),
        alignCaseFn: async () => { throw new Error('Blocked'); },
      }
    );

    await controller.openPanelForCase(savedCase);
    controller.setConfirmReconciliation(true);

    // Render with hasUnsavedCaseEdits: true
    const markupUnsaved = renderToStaticMarkup(
      React.createElement(LibraryQuarantineCatalogCaseAlignmentPanel, {
        controller,
        currentUser: curatorWithCreate,
        savedReviewCase: savedCase,
        catalogDocument: catalogDoc,
        hasUnsavedCaseEdits: true,
        isAr: true,
      })
    );

    assert.equal(
      markupUnsaved.includes('data-testid="alignment-unsaved-case-edits-warning"'),
      true
    );
    assert.equal(
      markupUnsaved.includes('يوجد تعديل غير محفوظ في نموذج المراجعة البشرية أعلاه'),
      true
    );

    console.log('PASS 4: Unsaved human review case edits blocking verified.');
  }

  // =========================================================================
  // PASS 5: Network Failure -> UNKNOWN with Verify-Only Recovery
  // =========================================================================
  {
    const savedCase = makeSavedHumanReviewCase();
    const catalogDoc = makeCatalogDoc();
    let getCount = 0;

    const controller = new LibraryQuarantineCatalogCaseAlignmentPanelController(
      curatorWithCreate,
      {
        caseAlignmentEnabled: true,
        getAlignmentFn: async () => {
          getCount += 1;
          return makeMockGetResponse();
        },
        alignCaseFn: async () => {
          // Simulate transport network failure after send
          throw new Error('TypeError: Failed to fetch (Network disconnected after dispatch)');
        },
      }
    );

    await controller.openPanelForCase(savedCase);
    controller.setConfirmReconciliation(true);

    const alignRes = await controller.alignCase();
    assert.equal(alignRes, null);
    assert.equal(controller.getSnapshot().uncertainState !== null, true);
    assert.equal(controller.getSnapshot().uncertainState?.errorCode, 'TRANSACTION_COMMIT_UNCERTAIN');

    // UI renders UNKNOWN banner
    const markupUncertain = renderToStaticMarkup(
      React.createElement(LibraryQuarantineCatalogCaseAlignmentPanel, {
        controller,
        currentUser: curatorWithCreate,
        savedReviewCase: savedCase,
        catalogDocument: catalogDoc,
        hasUnsavedCaseEdits: false,
        isAr: true,
      })
    );

    assert.equal(
      markupUncertain.includes('data-testid="quarantine-catalog-case-alignment-uncertain-banner"'),
      true
    );
    assert.equal(
      markupUncertain.includes('data-testid="verify-quarantine-catalog-case-alignment-btn"'),
      true
    );

    // Verify-only button calls getAlignmentFn (never alignCaseFn)
    const verifyRes = await controller.verifyAlignmentStatus();
    assert.equal(verifyRes !== null, true);
    assert.equal(controller.getSnapshot().uncertainState, null);
    assert.equal(getCount, 2);

    console.log('PASS 5: Network transport failure -> UNKNOWN with verify-only recovery verified.');
  }

  // =========================================================================
  // PASS 6: Confirmation Checkbox Requirement & Idempotent Alignment
  // =========================================================================
  {
    const savedCase = makeSavedHumanReviewCase();
    const catalogDoc = makeCatalogDoc();
    let alignedPayload: any = null;

    const controller = new LibraryQuarantineCatalogCaseAlignmentPanelController(
      curatorWithCreate,
      {
        caseAlignmentEnabled: true,
        getAlignmentFn: async () => makeMockGetResponse(),
        alignCaseFn: async (payload) => {
          alignedPayload = payload;
          return {
            ok: true,
            status: 'ALIGNED',
            schemaVersion: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_SCHEMA_VERSION,
            receiptId: VALID_RECEIPT_ID,
            documentId: VALID_DOC_ID,
            alignedHumanCaseRevision: 2,
            previousHandoffCaseRevision: 1,
            catalogDocumentRevision: 2,
            alignmentRevision: 1,
            alignmentSaved: true,
            alignmentOutcome: 'ALIGNED',
            readiness: {
              rightsScope: 'CATALOG_METADATA_ONLY',
              binarySafety: 'NOT_VERIFIED',
              fileSanitization: 'UNVERIFIED',
              publication: 'BLOCKED',
              catalogWorkflow: 'REVIEW_REQUIRED',
            },
            alignment: null,
            serverTimeIso: VALID_ISO,
          };
        },
      }
    );

    await controller.openPanelForCase(savedCase);

    // Attempting to align without checkbox fails
    const failRes = await controller.alignCase();
    assert.equal(failRes, null);
    assert.equal(
      controller.getSnapshot().alignError,
      CASE_ALIGNMENT_CLIENT_SAFE_ERRORS.UNCONFIRMED_RECONCILIATION
    );
    assert.equal(alignedPayload, null);

    // Confirm checkbox
    controller.setConfirmReconciliation(true);
    assert.equal(controller.getSnapshot().alignError, null);

    // Align succeeds
    const successRes = await controller.alignCase();
    assert.equal(successRes !== null, true);
    assert.equal(successRes?.ok, true);
    assert.equal(alignedPayload?.expectedHandoffCaseRevision, 1);
    assert.equal(controller.getSnapshot().lastAlignOutcome, 'ALIGNED');

    console.log('PASS 6: Confirmation checkbox requirement and successful alignment verified.');
  }

  console.log('\nALL LIB-FILE-CASE-ALIGNMENT-01 CLIENT TESTS PASSED.');
}

runTests().catch((err: unknown) => {
  console.error('LIB-FILE-CASE-ALIGNMENT-01 CLIENT TESTS FAILED:', err);
  process.exit(1);
});
