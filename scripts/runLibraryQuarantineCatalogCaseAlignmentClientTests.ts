import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AdminPermission,
  AdminRole,
  type AdminUser,
} from '../src/types/admin';
import {
  LibraryDocumentType,
  LibraryRightsStatus,
  type LibraryDocument,
} from '../src/types/library';
import { WorkflowState } from '../src/types/workflow';
import type { SanitizedLibraryQuarantineHumanReviewCaseDto } from '../src/services/libraryQuarantineHumanReviewClient';
import type {
  SanitizedLibraryQuarantineCatalogDocumentDto,
  SanitizedLibraryQuarantineCatalogHandoffDto,
} from '../src/services/libraryQuarantineCatalogHandoffClient';
import {
  LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
  LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_SCHEMA_VERSION,
  CASE_ALIGNMENT_CLIENT_SAFE_ERRORS,
  LibraryQuarantineCatalogCaseAlignmentPanelController,
  alignQuarantineCatalogCaseClient,
  areLibraryQuarantineCaseAlignmentReleaseFlagsEnabled,
  canCurrentAdminAlignQuarantineCatalogDraft,
  computeClientCatalogCaseFourFieldDiff,
  getQuarantineCatalogCaseAlignmentClient,
  validateAlignCatalogCaseResponseDto,
  validateAlignQuarantineCatalogCaseResponseDto,
  validateGetCatalogCaseAlignmentResponseDto,
  validateGetQuarantineCatalogCaseAlignmentResponseDto,
  validateSanitizedCatalogCaseAlignmentDto,
  type AlignLibraryQuarantineCatalogCaseConflictDto,
  type AlignLibraryQuarantineCatalogCaseHoldDto,
  type AlignLibraryQuarantineCatalogCaseSuccessDto,
  type AlignLibraryQuarantineCatalogCaseUnknownDto,
  type GetLibraryQuarantineCatalogCaseAlignmentHoldDto,
  type GetLibraryQuarantineCatalogCaseAlignmentSuccessDto,
  type LibraryQuarantineCatalogCaseFourFieldDiffDto,
  type SanitizedLibraryQuarantineCatalogCaseAlignmentDto,
} from '../src/services/libraryQuarantineCatalogCaseAlignmentClient';
import {
  LibraryQuarantineCatalogCaseAlignmentPanel,
} from '../src/components/library/LibraryQuarantineCatalogCaseAlignmentPanel';

const VALID_RECEIPT_ID = 'e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6';
const SECOND_RECEIPT_ID = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
const VALID_DOC_ID = `qcat-${VALID_RECEIPT_ID}`;
const VALID_ISO = '2026-11-10T14:00:00.000Z';
const UPDATED_ISO = '2026-11-14T09:30:00.000Z';

const ALL_ALIGNMENT_FLAGS_ENABLED: Record<string, unknown> = Object.freeze({
  VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED: 'true',
  VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED: 'true',
  VITE_LIBRARY_CATALOG_HANDOFF_ENABLED: 'true',
  VITE_LIBRARY_CASE_ALIGNMENT_ENABLED: 'true',
});

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
    sourceRevision: 1,
    sourceUpdatedAt: VALID_ISO,
    draftSourceRevision: 1,
    revision: 4,
    status: 'METADATA_RECORDED' as const,
    titleAr: 'تقرير التحول البيئي 2026 (مراجعة حالة #4)',
    titleEn: 'Ecological Transition Report 2026 (Case v4)',
    issuingOrganization: 'Ministry of Environment',
    summaryAr: 'ملخص محدث في حالة المراجعة البشرية v4.',
    summaryEn: 'Updated summary in human review case v4.',
    sourceEvidenceNotes: 'Gazette 4210.',
    rightsEvidenceNotes: 'Open access note.',
    editorialNotes: 'Metadata updated to v4.',
    createdAt: VALID_ISO,
    updatedAt: UPDATED_ISO,
    ...overrides,
  });
}

function makeSanitizedHandoffDto(
  overrides?: Partial<SanitizedLibraryQuarantineCatalogHandoffDto>
): SanitizedLibraryQuarantineCatalogHandoffDto {
  return Object.freeze({
    schemaVersion: 1 as const,
    receiptId: VALID_RECEIPT_ID,
    documentId: VALID_DOC_ID,
    sourceRevision: 1,
    sourceUpdatedAt: VALID_ISO,
    draftSourceRevision: 1,
    caseRevision: 1,
    caseUpdatedAt: VALID_ISO,
    organizationId: 'org-ministry-env',
    sourceId: 'src-gazette-4210',
    createdAt: VALID_ISO,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
    ...overrides,
  });
}

function makeSanitizedCatalogDocumentDto(
  overrides?: Partial<SanitizedLibraryQuarantineCatalogDocumentDto>
): SanitizedLibraryQuarantineCatalogDocumentDto {
  return Object.freeze({
    id: VALID_DOC_ID,
    titleAr: 'تقرير التحول البيئي 2026 (مسودة أولية v1)',
    titleEn: 'Ecological Transition Report 2026 (Initial Draft v1)',
    documentType: LibraryDocumentType.InstitutionalReport,
    organizationId: 'org-ministry-env',
    sourceId: 'src-gazette-4210',
    geographyAr: 'الأردن',
    geographyEn: 'Jordan',
    publicationDate: '2026-11-10',
    language: 'ar' as const,
    summaryAr: 'ملخص أولي في مسودة الفهرس v1.',
    summaryEn: 'Initial summary in catalog draft v1.',
    topicsAr: ['التحول البيئي'],
    topicsEn: ['Ecological Transition'],
    environmentalDomains: ['climate'],
    rightsStatus: LibraryRightsStatus.ReviewRequired,
    workflowState: WorkflowState.Draft,
    legalStatusDescriptionAr: 'قيد المراجعة القانونية',
    legalStatusDescriptionEn: 'Under legal review',
    createdAt: VALID_ISO,
    updatedAt: VALID_ISO,
    versions: [
      {
        id: `${VALID_DOC_ID}-v1`,
        documentId: VALID_DOC_ID,
        versionNumber: '1.0-quarantine-draft',
        publishedDate: '2026-11-10',
        changeDescriptionAr: 'إنشاء مسودة الفهرس الخاصة من الحجر.',
        changeDescriptionEn: 'Created private quarantine catalog draft.',
      },
    ],
    ...overrides,
  });
}

function makeCatalogDocForUi(
  overrides?: Partial<LibraryDocument>
): LibraryDocument {
  const dto = makeSanitizedCatalogDocumentDto();
  return {
    ...dto,
    versions: [...dto.versions],
    topicsAr: [...dto.topicsAr],
    topicsEn: [...dto.topicsEn],
    environmentalDomains: [...dto.environmentalDomains],
    ...overrides,
  };
}

function makeAlignmentDto(
  overrides?: Partial<SanitizedLibraryQuarantineCatalogCaseAlignmentDto>
): SanitizedLibraryQuarantineCatalogCaseAlignmentDto {
  return Object.freeze({
    schemaVersion: LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_SCHEMA_VERSION,
    receiptId: VALID_RECEIPT_ID,
    documentId: VALID_DOC_ID,
    sourceRevision: 1,
    sourceUpdatedAt: VALID_ISO,
    originalHandoffCaseRevision: 1,
    alignmentRevision: 1,
    alignedHumanCaseRevision: 4,
    alignedHumanCaseUpdatedAt: UPDATED_ISO,
    documentUpdatedAt: UPDATED_ISO,
    createdAt: UPDATED_ISO,
    updatedAt: UPDATED_ISO,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
    ...overrides,
  });
}

function makeServerGetReadyResponse(
  overrides?: Partial<GetLibraryQuarantineCatalogCaseAlignmentSuccessDto>
): GetLibraryQuarantineCatalogCaseAlignmentSuccessDto {
  const handoff = overrides?.handoff ?? makeSanitizedHandoffDto();
  const catalogDocument =
    overrides?.catalogDocument ?? makeSanitizedCatalogDocumentDto();
  const humanReviewCase =
    overrides?.humanReviewCase ?? makeSavedHumanReviewCase();
  const alignment =
    overrides?.alignment !== undefined ? overrides.alignment : null;
  const diff: LibraryQuarantineCatalogCaseFourFieldDiffDto =
    overrides?.diff ??
    computeClientCatalogCaseFourFieldDiff(humanReviewCase, catalogDocument);
  const effectiveAlignedCaseRevision =
    overrides?.effectiveAlignedCaseRevision ??
    (alignment ? alignment.alignedHumanCaseRevision : handoff.caseRevision);
  const currentHumanCaseRevision =
    overrides?.currentHumanCaseRevision ?? humanReviewCase.revision;
  const alignmentState =
    overrides?.alignmentState ??
    (diff.hasAnyDifference ||
    currentHumanCaseRevision !== effectiveAlignedCaseRevision
      ? 'NEEDS_REALIGNMENT'
      : 'ALIGNED');
  const hasRecordedRightsDecision =
    overrides?.hasRecordedRightsDecision ?? true;
  const recordedRightsDecisionCaseRevision =
    overrides?.recordedRightsDecisionCaseRevision !== undefined
      ? overrides.recordedRightsDecisionCaseRevision
      : hasRecordedRightsDecision
      ? 1
      : null;
  const rightsDecisionInvalidatedByCaseChange =
    overrides?.rightsDecisionInvalidatedByCaseChange ??
    (hasRecordedRightsDecision &&
      recordedRightsDecisionCaseRevision !== null &&
      recordedRightsDecisionCaseRevision < currentHumanCaseRevision);
  const requiresFreshRightsReview =
    overrides?.requiresFreshRightsReview ??
    (hasRecordedRightsDecision &&
      (rightsDecisionInvalidatedByCaseChange ||
        alignmentState === 'NEEDS_REALIGNMENT'));

  return Object.freeze({
    ok: true as const,
    status: 'READY' as const,
    receiptId: VALID_RECEIPT_ID,
    documentId: VALID_DOC_ID,
    alignmentState,
    sourceRevision: handoff.sourceRevision,
    originalHandoffCaseRevision: handoff.caseRevision,
    effectiveAlignedCaseRevision,
    currentHumanCaseRevision,
    currentAlignmentRevision: alignment ? alignment.alignmentRevision : 0,
    catalogUpdatedAt: catalogDocument.updatedAt,
    diff,
    alignment,
    handoff,
    catalogDocument,
    humanReviewCase,
    hasRecordedRightsDecision,
    recordedRightsDecisionCaseRevision,
    rightsDecisionInvalidatedByCaseChange,
    requiresFreshRightsReview,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
    ...overrides,
  });
}

function makeServerGetHoldResponse(
  overrides?: Partial<GetLibraryQuarantineCatalogCaseAlignmentHoldDto>
): GetLibraryQuarantineCatalogCaseAlignmentHoldDto {
  return Object.freeze({
    ok: false as const,
    status: 'HOLD' as const,
    errorCode: 'CATALOG_HANDOFF_MISSING',
    errorMessage:
      'لا يمكن فحص المواءمة قبل إنشاء مسودة الفهرس الخاصة / Cannot inspect alignment before creating the private catalog draft.',
    receiptId: VALID_RECEIPT_ID,
    documentId: VALID_DOC_ID,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
    ...overrides,
  });
}

function makeServerAlignAlignedResponse(
  overrides?: Partial<AlignLibraryQuarantineCatalogCaseSuccessDto>
): AlignLibraryQuarantineCatalogCaseSuccessDto {
  const handoff = overrides?.handoff ?? makeSanitizedHandoffDto();
  const humanReviewCase =
    overrides?.humanReviewCase ?? makeSavedHumanReviewCase({ revision: 4 });
  const catalogDocument =
    overrides?.catalogDocument ??
    makeSanitizedCatalogDocumentDto({
      titleAr: humanReviewCase.titleAr,
      titleEn: humanReviewCase.titleEn,
      summaryAr: humanReviewCase.summaryAr,
      summaryEn: humanReviewCase.summaryEn,
      updatedAt: UPDATED_ISO,
    });
  const alignment =
    overrides?.alignment !== undefined
      ? overrides.alignment
      : makeAlignmentDto({
          alignedHumanCaseRevision: humanReviewCase.revision,
          alignmentRevision: 1,
          documentUpdatedAt: catalogDocument.updatedAt,
        });
  const diff =
    overrides?.diff ??
    computeClientCatalogCaseFourFieldDiff(humanReviewCase, catalogDocument);

  return Object.freeze({
    ok: true as const,
    status: 'ALIGNED' as const,
    alignmentOutcome: 'ALIGNED' as const,
    alignmentSaved: true,
    receiptId: VALID_RECEIPT_ID,
    documentId: VALID_DOC_ID,
    alignmentState: 'ALIGNED' as const,
    sourceRevision: handoff.sourceRevision,
    originalHandoffCaseRevision: handoff.caseRevision,
    effectiveAlignedCaseRevision: humanReviewCase.revision,
    currentHumanCaseRevision: humanReviewCase.revision,
    currentAlignmentRevision: alignment ? alignment.alignmentRevision : 1,
    catalogUpdatedAt: catalogDocument.updatedAt,
    diff,
    alignment,
    handoff,
    catalogDocument,
    humanReviewCase,
    hasRecordedRightsDecision: true,
    recordedRightsDecisionCaseRevision: 1,
    rightsDecisionInvalidatedByCaseChange: true,
    requiresFreshRightsReview: true,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
    ...overrides,
  });
}

function makeServerAlignAlreadyAlignedResponse(
  overrides?: Partial<AlignLibraryQuarantineCatalogCaseSuccessDto>
): AlignLibraryQuarantineCatalogCaseSuccessDto {
  const base = makeServerAlignAlignedResponse();
  return Object.freeze({
    ...base,
    status: 'ALREADY_ALIGNED' as const,
    alignmentOutcome: 'ALREADY_ALIGNED' as const,
    alignmentSaved: false,
    ...overrides,
  });
}

function makeServerAlignConflictResponse(
  overrides?: Partial<AlignLibraryQuarantineCatalogCaseConflictDto>
): AlignLibraryQuarantineCatalogCaseConflictDto {
  const humanReviewCase = makeSavedHumanReviewCase({ revision: 5 });
  const catalogDocument = makeSanitizedCatalogDocumentDto({
    updatedAt: '2026-11-14T10:00:00.000Z',
  });
  const diff = computeClientCatalogCaseFourFieldDiff(
    humanReviewCase,
    catalogDocument
  );

  return Object.freeze({
    ok: false as const,
    status: 'CONFLICT' as const,
    alignmentOutcome: 'NOT_ALIGNED' as const,
    alignmentSaved: false as const,
    errorCode: 'ALIGNMENT_REVISION_CONFLICT' as const,
    errorMessage:
      'تغيرت نسخة ملف المراجعة أو مسودة الفهرس أثناء المراجعة؛ يرجى فحص المقارنة المحدثة ثم إعادة التأكيد.',
    receiptId: VALID_RECEIPT_ID,
    documentId: VALID_DOC_ID,
    currentHumanCaseRevision: 5,
    currentCatalogUpdatedAt: '2026-11-14T10:00:00.000Z',
    currentAlignmentRevision: 0,
    effectiveAlignedCaseRevision: 1,
    diff,
    alignment: null,
    catalogDocument,
    humanReviewCase,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
    ...overrides,
  });
}

function makeServerAlignHoldResponse(
  overrides?: Partial<AlignLibraryQuarantineCatalogCaseHoldDto>
): AlignLibraryQuarantineCatalogCaseHoldDto {
  return Object.freeze({
    ok: false as const,
    status: 'HOLD' as const,
    alignmentOutcome: 'NOT_ALIGNED' as const,
    alignmentSaved: false as const,
    errorCode: 'CATALOG_RIGHTS_STATE_INVALID_FOR_ALIGNMENT',
    errorMessage: 'حالة الحقوق في مسودة الفهرس الخاصة لا تسمح بالمواءمة.',
    receiptId: VALID_RECEIPT_ID,
    documentId: VALID_DOC_ID,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
    ...overrides,
  });
}

function makeServerAlignUnknownResponse(
  overrides?: Partial<AlignLibraryQuarantineCatalogCaseUnknownDto>
): AlignLibraryQuarantineCatalogCaseUnknownDto {
  return Object.freeze({
    ok: false as const,
    status: 'UNKNOWN' as const,
    alignmentOutcome: 'UNKNOWN' as const,
    alignmentSaved: null,
    errorCode: 'TRANSACTION_COMMIT_UNCERTAIN' as const,
    errorMessage:
      'تعذر الجزم بنتيجة حفظ المواءمة. يرجى التحقق من حالة المواءمة دون إعادة الإرسال.',
    receiptId: VALID_RECEIPT_ID,
    documentId: VALID_DOC_ID,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
    ...overrides,
  });
}

async function runTests(): Promise<void> {
  console.log('STARTING LIB-CASE-ALIGNMENT-LIVE-CONTRACT-REPAIR-01 CLIENT TESTS...');

  const owner = makeAdminUser(AdminRole.Owner);
  const curatorWithCreate = makeAdminUser(AdminRole.LibraryCurator, {
    permissions: [AdminPermission.Create, AdminPermission.Review],
  });
  const rightsReviewerOnly = makeAdminUser(AdminRole.RightsReviewer, {
    permissions: [AdminPermission.ManageRights, AdminPermission.Review],
  });

  // =========================================================================
  // PASS 0: RBAC Split, Release Gate & Confirmation Literal
  // =========================================================================
  {
    assert.equal(
      LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENT_CONFIRMATION_LITERAL,
      'APPLY_CASE_METADATA'
    );
    assert.equal(canCurrentAdminAlignQuarantineCatalogDraft(owner), true);
    assert.equal(canCurrentAdminAlignQuarantineCatalogDraft(curatorWithCreate), true);
    assert.equal(canCurrentAdminAlignQuarantineCatalogDraft(rightsReviewerOnly), false);
    assert.equal(canCurrentAdminAlignQuarantineCatalogDraft(null), false);
    assert.equal(
      areLibraryQuarantineCaseAlignmentReleaseFlagsEnabled(ALL_ALIGNMENT_FLAGS_ENABLED),
      true
    );

    console.log('PASS 0: RBAC split, release flags, and APPLY_CASE_METADATA confirmation literal verified.');
  }

  // =========================================================================
  // CASE 1: Server READY with drift (v4 vs v1) and 4 real fields -> validated,
  // displayed in AR/EN, revision lineage (v1, v1, v4, #0) correct, zero writes
  // =========================================================================
  {
    const savedCaseV4 = makeSavedHumanReviewCase({ revision: 4 });
    const catalogDocV1 = makeCatalogDocForUi();
    const serverReadyWire = makeServerGetReadyResponse();

    // Validate wire DTO directly through production validators
    const validatedReady = validateGetQuarantineCatalogCaseAlignmentResponseDto(serverReadyWire);
    assert.equal(validatedReady.ok, true);
    assert.equal(validatedReady.status, 'READY');
    if (validatedReady.status === 'READY') {
      assert.equal(validatedReady.originalHandoffCaseRevision, 1);
      assert.equal(validatedReady.effectiveAlignedCaseRevision, 1);
      assert.equal(validatedReady.currentHumanCaseRevision, 4);
      assert.equal(validatedReady.currentAlignmentRevision, 0);
      assert.equal(validatedReady.alignmentState, 'NEEDS_REALIGNMENT');
      assert.equal(validatedReady.diff.hasAnyDifference, true);
      assert.equal(validatedReady.diff.fields.titleAr.changed, true);
      assert.equal(validatedReady.diff.fields.titleEn.changed, true);
      assert.equal(validatedReady.diff.fields.summaryAr.changed, true);
      assert.equal(validatedReady.diff.fields.summaryEn.changed, true);
    }

    // Legacy forged test shape (diffSummary / hasDiff) must be rejected by strict validator
    assert.equal(
      validateGetCatalogCaseAlignmentResponseDto({
        ok: true,
        status: 'READY',
        hasDiff: true,
        diffSummary: {},
      }),
      null
    );
    assert.throws(() => {
      validateGetQuarantineCatalogCaseAlignmentResponseDto({
        ok: true,
        status: 'READY',
        hasDiff: true,
        diffSummary: {},
      });
    }, /RESPONSE_VALIDATION_FAILED/);

    let getInvocations = 0;
    let alignInvocations = 0;

    const controller = new LibraryQuarantineCatalogCaseAlignmentPanelController(
      owner,
      {
        envOverride: ALL_ALIGNMENT_FLAGS_ENABLED,
        invokeCallable: async (req) => {
          if (req.action === 'getQuarantineCatalogCaseAlignment') {
            getInvocations += 1;
            assert.equal(req.receiptId, VALID_RECEIPT_ID);
            return serverReadyWire;
          }
          alignInvocations += 1;
          throw new Error('Zero writes allowed during GET inspection');
        },
      }
    );

    const openState = await controller.openPanelForCase(savedCaseV4);
    assert.equal(getInvocations, 1);
    assert.equal(alignInvocations, 0);
    assert.equal(openState.phase, 'ready');
    assert.equal(openState.snapshot?.status, 'READY');

    const markupAr = renderToStaticMarkup(
      React.createElement(LibraryQuarantineCatalogCaseAlignmentPanel, {
        controller,
        currentUser: owner,
        savedReviewCase: savedCaseV4,
        catalogDocument: catalogDocV1,
        hasUnsavedCaseEdits: false,
        isAr: true,
      })
    );

    assert.equal(markupAr.includes('data-testid="alignment-diff-grid"'), true);
    assert.equal(markupAr.includes('data-testid="alignment-diff-field-titleAr"'), true);
    assert.equal(markupAr.includes('data-testid="alignment-diff-field-titleEn"'), true);
    assert.equal(markupAr.includes('data-testid="alignment-diff-field-summaryAr"'), true);
    assert.equal(markupAr.includes('data-testid="alignment-diff-field-summaryEn"'), true);
    assert.equal(markupAr.includes('تقرير التحول البيئي 2026 (مسودة أولية v1)'), true);
    assert.equal(markupAr.includes('تقرير التحول البيئي 2026 (مراجعة حالة #4)'), true);
    assert.equal(markupAr.includes('ملخص أولي في مسودة الفهرس v1.'), true);
    assert.equal(markupAr.includes('ملخص محدث في حالة المراجعة البشرية v4.'), true);
    // Lineage v1, v1, v4, #0
    assert.equal(markupAr.includes('>v1<'), true);
    assert.equal(markupAr.includes('>v4<'), true);
    assert.equal(markupAr.includes('>#0<'), true);
    assert.equal(markupAr.includes('data-testid="quarantine-rights-rereview-warning-banner"'), true);

    const markupEn = renderToStaticMarkup(
      React.createElement(LibraryQuarantineCatalogCaseAlignmentPanel, {
        controller,
        currentUser: owner,
        savedReviewCase: savedCaseV4,
        catalogDocument: catalogDocV1,
        hasUnsavedCaseEdits: false,
        isAr: false,
      })
    );

    assert.equal(markupEn.includes('Ecological Transition Report 2026 (Initial Draft v1)'), true);
    assert.equal(markupEn.includes('Ecological Transition Report 2026 (Case v4)'), true);
    assert.equal(markupEn.includes('Initial summary in catalog draft v1.'), true);
    assert.equal(markupEn.includes('Updated summary in human review case v4.'), true);
    assert.equal(markupEn.includes('Differences Detected'), true);

    console.log('CASE 1: Server READY with drift (v4 vs v1) and 4 real fields verified in AR/EN with zero writes.');
  }

  // =========================================================================
  // CASE 2: Server READY with no textual field changes (diff.hasAnyDifference === false)
  // but case revision drift (effectiveAlignedCaseRevision: 1, currentHumanCaseRevision: 2)
  // -> still requires realignment and allows human-confirmed alignment
  // =========================================================================
  {
    const savedCaseV2SameText = makeSavedHumanReviewCase({
      revision: 2,
      titleAr: 'تقرير التحول البيئي 2026 (مسودة أولية v1)',
      titleEn: 'Ecological Transition Report 2026 (Initial Draft v1)',
      summaryAr: 'ملخص أولي في مسودة الفهرس v1.',
      summaryEn: 'Initial summary in catalog draft v1.',
      editorialNotes: 'Updated non-catalog notes in v2.',
    });
    const catalogDocV1 = makeSanitizedCatalogDocumentDto();
    const diffNoTextChanges = computeClientCatalogCaseFourFieldDiff(
      savedCaseV2SameText,
      catalogDocV1
    );
    assert.equal(diffNoTextChanges.hasAnyDifference, false);

    const readyRevisionDriftOnly = makeServerGetReadyResponse({
      catalogDocument: catalogDocV1,
      humanReviewCase: savedCaseV2SameText,
      diff: diffNoTextChanges,
      originalHandoffCaseRevision: 1,
      effectiveAlignedCaseRevision: 1,
      currentHumanCaseRevision: 2,
      currentAlignmentRevision: 0,
      alignmentState: 'NEEDS_REALIGNMENT',
      recordedRightsDecisionCaseRevision: 1,
      rightsDecisionInvalidatedByCaseChange: true,
      requiresFreshRightsReview: true,
    });

    let alignCapturedPayload: Record<string, unknown> | null = null;
    const alignedRevisionOnlyResponse = makeServerAlignAlignedResponse({
      catalogDocument: {
        ...catalogDocV1,
        updatedAt: UPDATED_ISO,
      },
      humanReviewCase: savedCaseV2SameText,
      diff: diffNoTextChanges,
      effectiveAlignedCaseRevision: 2,
      currentHumanCaseRevision: 2,
      currentAlignmentRevision: 1,
      alignment: makeAlignmentDto({
        alignedHumanCaseRevision: 2,
        alignmentRevision: 1,
        documentUpdatedAt: UPDATED_ISO,
      }),
      recordedRightsDecisionCaseRevision: 1,
      rightsDecisionInvalidatedByCaseChange: true,
      requiresFreshRightsReview: true,
    });

    const controller = new LibraryQuarantineCatalogCaseAlignmentPanelController(
      curatorWithCreate,
      {
        envOverride: ALL_ALIGNMENT_FLAGS_ENABLED,
        invokeCallable: async (req) => {
          if (req.action === 'getQuarantineCatalogCaseAlignment') {
            return readyRevisionDriftOnly;
          }
          alignCapturedPayload = req as unknown as Record<string, unknown>;
          return alignedRevisionOnlyResponse;
        },
      }
    );

    await controller.openPanelForCase(savedCaseV2SameText);

    const markupRevisionDriftAr = renderToStaticMarkup(
      React.createElement(LibraryQuarantineCatalogCaseAlignmentPanel, {
        controller,
        currentUser: curatorWithCreate,
        savedReviewCase: savedCaseV2SameText,
        catalogDocument: makeCatalogDocForUi(),
        hasUnsavedCaseEdits: false,
        isAr: true,
      })
    );

    assert.equal(
      markupRevisionDriftAr.includes('data-testid="quarantine-case-alignment-revision-only-drift-notice"'),
      true
    );
    assert.equal(
      markupRevisionDriftAr.includes('data-testid="quarantine-catalog-case-alignment-confirm-checkbox"'),
      true
    );
    assert.equal(
      markupRevisionDriftAr.includes('data-testid="align-quarantine-catalog-case-btn"'),
      true
    );

    controller.setConfirmedApplyCaseMetadata(true);
    const alignRes = await controller.alignCatalogDraft();
    assert.equal(alignRes?.status, 'ALIGNED');
    assert.equal(alignCapturedPayload?.expectedCaseRevision, 2);
    assert.equal(alignCapturedPayload?.confirmation, 'APPLY_CASE_METADATA');

    console.log('CASE 2: Revision-only drift (hasAnyDifference === false, v2 vs v1) requires realignment and allows human-confirmed alignment.');
  }

  // =========================================================================
  // CASE 3: Server HOLD and malformed server reply on GET -> visible fail-closed
  // UI banner in AR/EN even when snapshot === null, with retry button, zero writes
  // =========================================================================
  {
    const savedCase = makeSavedHumanReviewCase();
    const catalogDoc = makeCatalogDocForUi();
    let getMode: 'SERVER_HOLD' | 'MALFORMED' = 'SERVER_HOLD';
    let getCalls = 0;
    let alignCalls = 0;

    const controller = new LibraryQuarantineCatalogCaseAlignmentPanelController(
      owner,
      {
        envOverride: ALL_ALIGNMENT_FLAGS_ENABLED,
        invokeCallable: async (req) => {
          if (req.action === 'getQuarantineCatalogCaseAlignment') {
            getCalls += 1;
            if (getMode === 'SERVER_HOLD') {
              return makeServerGetHoldResponse();
            }
            return { ok: true, status: 'READY', unexpectedGarbage: true };
          }
          alignCalls += 1;
          throw new Error('Zero writes allowed');
        },
      }
    );

    // 3a: Server HOLD when snapshot === null
    await controller.openPanelForCase(savedCase);
    assert.equal(controller.getSnapshot().snapshot, null);
    assert.equal(controller.getSnapshot().phase, 'hold');
    assert.equal(controller.getSnapshot().holdState?.errorCode, 'CATALOG_HANDOFF_MISSING');
    assert.equal(alignCalls, 0);

    const holdMarkupAr = renderToStaticMarkup(
      React.createElement(LibraryQuarantineCatalogCaseAlignmentPanel, {
        controller,
        currentUser: owner,
        savedReviewCase: savedCase,
        catalogDocument: catalogDoc,
        hasUnsavedCaseEdits: false,
        isAr: true,
      })
    );
    assert.equal(holdMarkupAr.includes('data-testid="quarantine-case-alignment-hold-banner"'), true);
    assert.equal(holdMarkupAr.includes('CATALOG_HANDOFF_MISSING'), true);
    assert.equal(holdMarkupAr.includes('لا يمكن فحص المواءمة قبل إنشاء مسودة الفهرس الخاصة'), true);
    assert.equal(holdMarkupAr.includes('data-testid="retry-quarantine-catalog-case-alignment-btn"'), true);

    const holdMarkupEn = renderToStaticMarkup(
      React.createElement(LibraryQuarantineCatalogCaseAlignmentPanel, {
        controller,
        currentUser: owner,
        savedReviewCase: savedCase,
        catalogDocument: catalogDoc,
        hasUnsavedCaseEdits: false,
        isAr: false,
      })
    );
    assert.equal(holdMarkupEn.includes('data-testid="quarantine-case-alignment-hold-banner"'), true);
    assert.equal(
      holdMarkupEn.includes('Cannot inspect alignment before creating the private catalog draft.'),
      true
    );
    assert.equal(holdMarkupEn.includes('Retry Alignment Check (Read-Only)'), true);

    // 3b: Malformed server reply on GET when snapshot === null
    getMode = 'MALFORMED';
    await controller.openPanelForCase(savedCase);
    assert.equal(controller.getSnapshot().snapshot, null);
    assert.equal(controller.getSnapshot().phase, 'hold');
    assert.equal(controller.getSnapshot().holdState?.errorCode, 'RESPONSE_VALIDATION_FAILED');
    assert.equal(getCalls, 2);
    assert.equal(alignCalls, 0);

    const malformedMarkupAr = renderToStaticMarkup(
      React.createElement(LibraryQuarantineCatalogCaseAlignmentPanel, {
        controller,
        currentUser: owner,
        savedReviewCase: savedCase,
        catalogDocument: catalogDoc,
        hasUnsavedCaseEdits: false,
        isAr: true,
      })
    );
    assert.equal(malformedMarkupAr.includes('data-testid="quarantine-case-alignment-hold-banner"'), true);
    assert.equal(malformedMarkupAr.includes('RESPONSE_VALIDATION_FAILED'), true);

    console.log('CASE 3: Server HOLD and malformed GET reply render visible fail-closed banner in AR/EN when snapshot === null.');
  }

  // =========================================================================
  // CASE 4: Missing credentials / callable rejection on GET -> visible completed
  // read failure (inFlight === false) rather than stuck loading
  // =========================================================================
  {
    const savedCase = makeSavedHumanReviewCase();
    const catalogDoc = makeCatalogDocForUi();

    // Direct client invocation without Firebase initialization / credentials must NOT throw unhandled
    const directNoCredsResult = await getQuarantineCatalogCaseAlignmentClient(
      VALID_RECEIPT_ID,
      {
        currentUser: owner,
        envOverride: ALL_ALIGNMENT_FLAGS_ENABLED,
      }
    );
    assert.equal(directNoCredsResult.ok, false);
    assert.equal(directNoCredsResult.status, 'HOLD');
    if (!directNoCredsResult.ok) {
      assert.equal(directNoCredsResult.errorCode, 'BACKEND_UNAVAILABLE');
    }

    const controller = new LibraryQuarantineCatalogCaseAlignmentPanelController(
      owner,
      {
        envOverride: ALL_ALIGNMENT_FLAGS_ENABLED,
      }
    );

    await controller.openPanelForCase(savedCase);
    const snapAfterReject = controller.getSnapshot();
    assert.equal(snapAfterReject.inFlight, false);
    assert.equal(snapAfterReject.phase, 'hold');
    assert.equal(snapAfterReject.holdState?.errorCode, 'BACKEND_UNAVAILABLE');

    const markupReject = renderToStaticMarkup(
      React.createElement(LibraryQuarantineCatalogCaseAlignmentPanel, {
        controller,
        currentUser: owner,
        savedReviewCase: savedCase,
        catalogDocument: catalogDoc,
        hasUnsavedCaseEdits: false,
        isAr: true,
      })
    );
    assert.equal(markupReject.includes('data-testid="quarantine-case-alignment-hold-banner"'), true);
    assert.equal(markupReject.includes('BACKEND_UNAVAILABLE'), true);
    assert.equal(markupReject.includes('data-testid="quarantine-case-alignment-loading"'), false);

    console.log('CASE 4: Missing credentials / callable rejection on GET finishes cleanly (inFlight === false) with visible hold banner.');
  }

  // =========================================================================
  // CASE 5: ALIGN ALIGNED -> one human-confirmed CAS write, alignmentSaved === true,
  // post-write state/readback validated
  // =========================================================================
  {
    const savedCaseV4 = makeSavedHumanReviewCase({ revision: 4 });
    const catalogDocV1 = makeCatalogDocForUi();
    let getCount = 0;
    let alignCount = 0;
    let capturedWirePayload: Record<string, unknown> | null = null;

    const controller = new LibraryQuarantineCatalogCaseAlignmentPanelController(
      owner,
      {
        envOverride: ALL_ALIGNMENT_FLAGS_ENABLED,
        invokeCallable: async (req) => {
          if (req.action === 'getQuarantineCatalogCaseAlignment') {
            getCount += 1;
            return makeServerGetReadyResponse();
          }
          alignCount += 1;
          capturedWirePayload = req as unknown as Record<string, unknown>;
          return makeServerAlignAlignedResponse();
        },
      }
    );

    await controller.openPanelForCase(savedCaseV4);
    assert.equal(getCount, 1);

    // Attempt without confirmation checkbox fails closed before calling alignCaseFn
    const unconfirmedRes = await controller.alignCatalogDraft();
    assert.equal(unconfirmedRes, null);
    assert.equal(alignCount, 0);
    assert.equal(
      controller.getSnapshot().alignError,
      CASE_ALIGNMENT_CLIENT_SAFE_ERRORS.UNCONFIRMED_RECONCILIATION
    );

    // Check confirmation box and align once
    controller.setConfirmedApplyCaseMetadata(true);
    const alignedRes = await controller.alignCatalogDraft();

    assert.equal(alignCount, 1);
    assert.equal(alignedRes?.ok, true);
    assert.equal(alignedRes?.status, 'ALIGNED');
    assert.equal(alignedRes?.alignmentSaved, true);
    assert.deepEqual(capturedWirePayload, {
      action: 'alignQuarantineCatalogCase',
      receiptId: VALID_RECEIPT_ID,
      expectedCaseRevision: 4,
      expectedCatalogUpdatedAt: VALID_ISO,
      expectedAlignmentRevision: 0,
      confirmation: 'APPLY_CASE_METADATA',
    });

    const postAlignSnap = controller.getSnapshot();
    assert.equal(postAlignSnap.lastAlignmentSaved, true);
    assert.equal(postAlignSnap.lastAlignmentOutcome, 'ALIGNED');
    assert.equal(postAlignSnap.snapshot?.alignmentState, 'ALIGNED');
    assert.equal(postAlignSnap.snapshot?.effectiveAlignedCaseRevision, 4);
    assert.equal(postAlignSnap.snapshot?.currentAlignmentRevision, 1);
    assert.equal(postAlignSnap.snapshot?.catalogDocument.titleAr, savedCaseV4.titleAr);

    const alignedMarkupAr = renderToStaticMarkup(
      React.createElement(LibraryQuarantineCatalogCaseAlignmentPanel, {
        controller,
        currentUser: owner,
        savedReviewCase: savedCaseV4,
        catalogDocument: catalogDocV1,
        hasUnsavedCaseEdits: false,
        isAr: true,
      })
    );
    assert.equal(
      alignedMarkupAr.includes('data-testid="quarantine-case-alignment-aligned-summary"'),
      true
    );
    assert.equal(
      alignedMarkupAr.includes('alignmentSaved: true'),
      true
    );

    console.log('CASE 5: ALIGN ALIGNED performs one human-confirmed CAS write (APPLY_CASE_METADATA) with alignmentSaved === true and validated post-write state.');
  }

  // =========================================================================
  // CASE 6: ALIGN ALREADY_ALIGNED -> idempotent success of existing alignment,
  // alignmentSaved === false, zero additional writes
  // =========================================================================
  {
    const savedCaseV4 = makeSavedHumanReviewCase({ revision: 4 });
    const catalogDoc = makeCatalogDocForUi();
    let alignCalls = 0;

    const controller = new LibraryQuarantineCatalogCaseAlignmentPanelController(
      curatorWithCreate,
      {
        envOverride: ALL_ALIGNMENT_FLAGS_ENABLED,
        invokeCallable: async (req) => {
          if (req.action === 'getQuarantineCatalogCaseAlignment') {
            return makeServerGetReadyResponse();
          }
          alignCalls += 1;
          return makeServerAlignAlreadyAlignedResponse();
        },
      }
    );

    await controller.openPanelForCase(savedCaseV4);
    controller.setConfirmedApplyCaseMetadata(true);
    const res = await controller.alignCatalogDraft();

    assert.equal(alignCalls, 1);
    assert.equal(res?.ok, true);
    assert.equal(res?.status, 'ALREADY_ALIGNED');
    assert.equal(res?.alignmentSaved, false);
    assert.equal(controller.getSnapshot().lastAlignmentSaved, false);
    assert.equal(controller.getSnapshot().lastAlignmentOutcome, 'ALREADY_ALIGNED');
    assert.equal(controller.getSnapshot().snapshot?.alignmentState, 'ALIGNED');

    const markupAlreadyAlignedAr = renderToStaticMarkup(
      React.createElement(LibraryQuarantineCatalogCaseAlignmentPanel, {
        controller,
        currentUser: curatorWithCreate,
        savedReviewCase: savedCaseV4,
        catalogDocument: catalogDoc,
        hasUnsavedCaseEdits: false,
        isAr: true,
      })
    );
    assert.equal(
      markupAlreadyAlignedAr.includes('data-testid="quarantine-case-alignment-aligned-summary"'),
      true
    );
    assert.equal(
      markupAlreadyAlignedAr.includes('alignmentSaved: false'),
      true
    );

    console.log('CASE 6: ALIGN ALREADY_ALIGNED handled idempotently with alignmentSaved === false.');
  }

  // =========================================================================
  // CASE 7: ALIGN CONFLICT -> explicit conflict state; re-checking confirmation
  // cannot clear conflict or unblock align; failed/malformed/HOLD GET (via
  // verifyAlignmentStatus or openPanelForCase) retains conflict; valid READY
  // GET reconciles and requires a fresh explicit confirmation before write
  // =========================================================================
  {
    const savedCaseV4 = makeSavedHumanReviewCase({ revision: 4 });
    const savedCaseV5 = makeSavedHumanReviewCase({
      revision: 5,
      titleAr: 'تقرير التحول البيئي 2026 (مراجعة حالة #5)',
      titleEn: 'Ecological Transition Report 2026 (Case v5)',
    });
    const catalogDoc = makeCatalogDocForUi();
    let getCalls = 0;
    let alignCalls = 0;
    let getBehavior:
      | 'INITIAL_READY_V4'
      | 'THROW_ERROR'
      | 'MALFORMED_PAYLOAD'
      | 'SERVER_HOLD'
      | 'VALID_READY_V5' = 'INITIAL_READY_V4';
    let lastAlignPayload: Record<string, unknown> | null = null;

    const controller = new LibraryQuarantineCatalogCaseAlignmentPanelController(
      owner,
      {
        envOverride: ALL_ALIGNMENT_FLAGS_ENABLED,
        invokeCallable: async (req) => {
          if (req.action === 'getQuarantineCatalogCaseAlignment') {
            getCalls += 1;
            if (getBehavior === 'INITIAL_READY_V4') {
              return makeServerGetReadyResponse({
                currentHumanCaseRevision: 4,
                humanReviewCase: savedCaseV4,
              });
            }
            if (getBehavior === 'THROW_ERROR') {
              throw new Error('GET_NETWORK_TIMEOUT_DURING_CONFLICT_RECOVERY');
            }
            if (getBehavior === 'MALFORMED_PAYLOAD') {
              return { ok: true, status: 'READY', invalidContractShape: true };
            }
            if (getBehavior === 'SERVER_HOLD') {
              return makeServerGetHoldResponse({
                errorCode: 'SOURCE_CASE_VERSION_DRIFT_HOLD',
                errorMessage: 'تعذر التحقق المؤقت من حالة المواءمة أثناء التعارض.',
              });
            }
            const docV1 = makeSanitizedCatalogDocumentDto();
            return makeServerGetReadyResponse({
              currentHumanCaseRevision: 5,
              humanReviewCase: savedCaseV5,
              catalogDocument: docV1,
              diff: computeClientCatalogCaseFourFieldDiff(savedCaseV5, docV1),
            });
          }
          alignCalls += 1;
          lastAlignPayload = req as unknown as Record<string, unknown>;
          if (alignCalls === 1) {
            return makeServerAlignConflictResponse({
              currentHumanCaseRevision: 5,
              humanReviewCase: savedCaseV5,
              diff: computeClientCatalogCaseFourFieldDiff(
                savedCaseV5,
                makeSanitizedCatalogDocumentDto({
                  updatedAt: '2026-11-14T10:00:00.000Z',
                })
              ),
            });
          }
          return makeServerAlignAlignedResponse({
            humanReviewCase: savedCaseV5,
            effectiveAlignedCaseRevision: 5,
            currentHumanCaseRevision: 5,
            currentAlignmentRevision: 1,
            catalogDocument: makeSanitizedCatalogDocumentDto({
              titleAr: savedCaseV5.titleAr,
              titleEn: savedCaseV5.titleEn,
              summaryAr: savedCaseV5.summaryAr,
              summaryEn: savedCaseV5.summaryEn,
              updatedAt: UPDATED_ISO,
            }),
            alignment: makeAlignmentDto({
              alignedHumanCaseRevision: 5,
              alignmentRevision: 1,
              documentUpdatedAt: UPDATED_ISO,
            }),
          });
        },
      }
    );

    await controller.openPanelForCase(savedCaseV4);
    controller.setConfirmedApplyCaseMetadata(true);
    const conflictRes = await controller.alignCatalogDraft();

    assert.equal(alignCalls, 1);
    assert.equal(getCalls, 1); // No auto-GET or auto-write
    assert.equal(conflictRes?.ok, false);
    assert.equal(conflictRes?.status, 'CONFLICT');
    assert.equal(controller.getSnapshot().phase, 'conflict');
    assert.equal(controller.getSnapshot().conflictState?.errorCode, 'ALIGNMENT_REVISION_CONFLICT');
    assert.equal(controller.getSnapshot().confirmedApplyCaseMetadata, false);

    // 7a: Toggling confirmation MUST NOT clear conflict or switch phase to ready
    controller.setConfirmedApplyCaseMetadata(true);
    controller.setConfirmReconciliation(true);
    assert.equal(controller.getSnapshot().phase, 'conflict');
    assert.notEqual(controller.getSnapshot().conflictState, null);
    assert.equal(controller.getSnapshot().confirmedApplyCaseMetadata, false);

    const blockedRepeat = await controller.alignCatalogDraft();
    assert.equal(blockedRepeat, null);
    assert.equal(alignCalls, 1);

    // 7b: Failed GET (throws), malformed GET, and server HOLD (via verifyAlignmentStatus and openPanelForCase)
    // MUST preserve the conflict latch and never enable writes
    getBehavior = 'THROW_ERROR';
    await controller.verifyAlignmentStatus();
    assert.equal(getCalls, 2);
    assert.equal(controller.getSnapshot().phase, 'conflict');
    assert.equal(controller.getSnapshot().conflictState?.errorCode, 'ALIGNMENT_REVISION_CONFLICT');
    assert.equal(controller.getSnapshot().holdState?.errorCode, 'CALLABLE_REQUEST_FAILED');
    assert.equal(
      controller.getSnapshot().conflictState?.errorMessage.includes('GET_NETWORK_TIMEOUT_DURING_CONFLICT_RECOVERY'),
      true
    );
    controller.setConfirmedApplyCaseMetadata(true);
    assert.equal(await controller.alignCatalogDraft(), null);
    assert.equal(alignCalls, 1);

    getBehavior = 'MALFORMED_PAYLOAD';
    await controller.openPanelForCase(savedCaseV4);
    assert.equal(getCalls, 3);
    assert.equal(controller.getSnapshot().phase, 'conflict');
    assert.equal(controller.getSnapshot().conflictState?.errorCode, 'ALIGNMENT_REVISION_CONFLICT');
    assert.equal(controller.getSnapshot().holdState?.errorCode, 'RESPONSE_VALIDATION_FAILED');
    controller.setConfirmedApplyCaseMetadata(true);
    assert.equal(await controller.alignCatalogDraft(), null);
    assert.equal(alignCalls, 1);

    getBehavior = 'SERVER_HOLD';
    await controller.verifyAlignmentStatus();
    assert.equal(getCalls, 4);
    assert.equal(controller.getSnapshot().phase, 'conflict');
    assert.equal(controller.getSnapshot().conflictState?.errorCode, 'ALIGNMENT_REVISION_CONFLICT');
    assert.equal(controller.getSnapshot().holdState?.errorCode, 'SOURCE_CASE_VERSION_DRIFT_HOLD');

    const conflictMarkupAr = renderToStaticMarkup(
      React.createElement(LibraryQuarantineCatalogCaseAlignmentPanel, {
        controller,
        currentUser: owner,
        savedReviewCase: savedCaseV4,
        catalogDocument: catalogDoc,
        hasUnsavedCaseEdits: false,
        isAr: true,
      })
    );
    assert.equal(
      conflictMarkupAr.includes('data-testid="quarantine-case-alignment-conflict-banner"'),
      true
    );
    assert.equal(conflictMarkupAr.includes('ALIGNMENT_REVISION_CONFLICT'), true);
    assert.equal(conflictMarkupAr.includes('SOURCE_CASE_VERSION_DRIFT_HOLD'), true);
    assert.equal(
      conflictMarkupAr.includes('data-testid="resolve-quarantine-catalog-case-alignment-conflict-btn"'),
      true
    );

    // 7c: Valid successful READY GET reconciles conflict, sets phase='ready', and requires fresh confirmation
    getBehavior = 'VALID_READY_V5';
    const reconciledGet = await controller.verifyAlignmentStatus();
    assert.equal(reconciledGet?.ok, true);
    assert.equal(reconciledGet?.status, 'READY');
    assert.equal(getCalls, 5);
    assert.equal(alignCalls, 1);
    assert.equal(controller.getSnapshot().phase, 'ready');
    assert.equal(controller.getSnapshot().conflictState, null);
    assert.equal(controller.getSnapshot().holdState, null);
    assert.equal(controller.getSnapshot().confirmedApplyCaseMetadata, false);
    assert.equal(controller.getSnapshot().snapshot?.currentHumanCaseRevision, 5);

    // Align without fresh human confirmation after conflict recovery must still be blocked
    const unconfirmedPostConflict = await controller.alignCatalogDraft();
    assert.equal(unconfirmedPostConflict, null);
    assert.equal(alignCalls, 1);

    // Fresh explicit confirmation now permits alignment at verified revision 5
    controller.setConfirmedApplyCaseMetadata(true);
    assert.equal(controller.getSnapshot().confirmedApplyCaseMetadata, true);
    const postConflictAlign = await controller.alignCatalogDraft();
    assert.equal(postConflictAlign?.ok, true);
    assert.equal(postConflictAlign?.status, 'ALIGNED');
    assert.equal(alignCalls, 2);
    assert.equal(lastAlignPayload?.expectedCaseRevision, 5);

    console.log('CASE 7: ALIGN CONFLICT latches across confirmation toggles and failed/HOLD GETs, then recovers only on valid READY GET with fresh human confirmation.');
  }

  // =========================================================================
  // CASE 8: ALIGN HOLD -> fail closed with visible hold message
  // =========================================================================
  {
    const savedCaseV4 = makeSavedHumanReviewCase({ revision: 4 });
    const catalogDoc = makeCatalogDocForUi();

    const controller = new LibraryQuarantineCatalogCaseAlignmentPanelController(
      owner,
      {
        envOverride: ALL_ALIGNMENT_FLAGS_ENABLED,
        invokeCallable: async (req) => {
          if (req.action === 'getQuarantineCatalogCaseAlignment') {
            return makeServerGetReadyResponse();
          }
          return makeServerAlignHoldResponse();
        },
      }
    );

    await controller.openPanelForCase(savedCaseV4);
    controller.setConfirmedApplyCaseMetadata(true);
    const holdRes = await controller.alignCatalogDraft();

    assert.equal(holdRes?.ok, false);
    assert.equal(holdRes?.status, 'HOLD');
    assert.equal(controller.getSnapshot().phase, 'hold');
    assert.equal(controller.getSnapshot().lastAlignmentSaved, false);
    assert.equal(
      controller.getSnapshot().holdState?.errorCode,
      'CATALOG_RIGHTS_STATE_INVALID_FOR_ALIGNMENT'
    );

    const holdMarkupAr = renderToStaticMarkup(
      React.createElement(LibraryQuarantineCatalogCaseAlignmentPanel, {
        controller,
        currentUser: owner,
        savedReviewCase: savedCaseV4,
        catalogDocument: catalogDoc,
        hasUnsavedCaseEdits: false,
        isAr: true,
      })
    );
    assert.equal(
      holdMarkupAr.includes('data-testid="quarantine-case-alignment-hold-banner"'),
      true
    );
    assert.equal(
      holdMarkupAr.includes('CATALOG_RIGHTS_STATE_INVALID_FOR_ALIGNMENT'),
      true
    );

    console.log('CASE 8: ALIGN HOLD fails closed with visible hold banner.');
  }

  // =========================================================================
  // CASE 9: ALIGN UNKNOWN and malformed post-dispatch response -> alignmentSaved === null;
  // UNKNOWN latch persists across GET throws, malformed GET, and server HOLD
  // (via verifyAlignmentStatus and openPanelForCase) with zero align writes;
  // clears ONLY on valid READY GET and requires fresh human confirmation
  // =========================================================================
  {
    const savedCaseV4 = makeSavedHumanReviewCase({ revision: 4 });
    const catalogDoc = makeCatalogDocForUi();
    let getCount = 0;
    let alignCount = 0;
    let alignMode: 'SERVER_UNKNOWN' | 'MALFORMED_POST_DISPATCH' = 'SERVER_UNKNOWN';
    let getMode:
      | 'INITIAL_READY'
      | 'GET_THROWS'
      | 'GET_MALFORMED'
      | 'GET_SERVER_HOLD'
      | 'GET_VALID_READY_REFRESHED' = 'INITIAL_READY';

    const controller = new LibraryQuarantineCatalogCaseAlignmentPanelController(
      owner,
      {
        envOverride: ALL_ALIGNMENT_FLAGS_ENABLED,
        invokeCallable: async (req) => {
          if (req.action === 'getQuarantineCatalogCaseAlignment') {
            getCount += 1;
            if (getMode === 'INITIAL_READY') {
              return makeServerGetReadyResponse();
            }
            if (getMode === 'GET_THROWS') {
              throw new Error('READ_VERIFICATION_RPC_UNAVAILABLE');
            }
            if (getMode === 'GET_MALFORMED') {
              return { ok: true, status: 'READY', corruptedField: 'bad' };
            }
            if (getMode === 'GET_SERVER_HOLD') {
              return makeServerGetHoldResponse({
                errorCode: 'TEMPORARY_VERIFICATION_HOLD',
                errorMessage: 'توقف احترازي أثناء التحقق من حالة المواءمة.',
              });
            }
            // Valid READY GET after UNKNOWN showing alignment still needs realignment
            return makeServerGetReadyResponse({
              currentHumanCaseRevision: 4,
              effectiveAlignedCaseRevision: 1,
              currentAlignmentRevision: 0,
            });
          }
          alignCount += 1;
          if (alignMode === 'SERVER_UNKNOWN') {
            return makeServerAlignUnknownResponse();
          }
          return { ok: true, status: 'ALIGNED', brokenPostDispatchPayload: 123 };
        },
      }
    );

    // 9a: Server returns explicit UNKNOWN
    await controller.openPanelForCase(savedCaseV4);
    const snapshotBeforeUnknown = controller.getSnapshot().snapshot;
    assert.notEqual(snapshotBeforeUnknown, null);

    controller.setConfirmedApplyCaseMetadata(true);
    const unknownRes = await controller.alignCatalogDraft();
    assert.equal(unknownRes, null);
    assert.equal(controller.getSnapshot().phase, 'uncertain');
    assert.equal(controller.getSnapshot().lastAlignmentSaved, null);
    assert.equal(controller.getSnapshot().lastAlignmentOutcome, 'UNKNOWN');
    assert.equal(controller.getSnapshot().uncertainState?.errorCode, 'TRANSACTION_COMMIT_UNCERTAIN');
    assert.equal(controller.getSnapshot().snapshot, snapshotBeforeUnknown);

    // Blind retry or confirmation toggle while uncertain must be blocked
    controller.setConfirmedApplyCaseMetadata(true);
    assert.equal(controller.getSnapshot().confirmedApplyCaseMetadata, false);
    const blockedRetry = await controller.alignCatalogDraft();
    assert.equal(blockedRetry, null);
    assert.equal(alignCount, 1);

    // 9b: UNKNOWN -> GET throws: phase MUST remain uncertain, original snapshot & receipt intact, diagnostic visible
    getMode = 'GET_THROWS';
    const throwVerifyRes = await controller.verifyAlignmentStatus();
    assert.equal(throwVerifyRes?.ok, false);
    assert.equal(getCount, 2);
    assert.equal(alignCount, 1);
    assert.equal(controller.getSnapshot().phase, 'uncertain');
    assert.equal(controller.getSnapshot().lastAlignmentSaved, null);
    assert.equal(controller.getSnapshot().receiptId, VALID_RECEIPT_ID);
    assert.equal(controller.getSnapshot().snapshot, snapshotBeforeUnknown);
    assert.equal(controller.getSnapshot().uncertainState?.errorCode, 'TRANSACTION_COMMIT_UNCERTAIN');
    assert.equal(
      controller.getSnapshot().uncertainState?.errorMessage.includes('READ_VERIFICATION_RPC_UNAVAILABLE'),
      true
    );
    controller.setConfirmedApplyCaseMetadata(true);
    assert.equal(await controller.alignCatalogDraft(), null);
    assert.equal(alignCount, 1);

    // 9c: UNKNOWN -> GET malformed (via openPanelForCase on same receipt): phase MUST remain uncertain
    getMode = 'GET_MALFORMED';
    await controller.openPanelForCase(savedCaseV4);
    assert.equal(getCount, 3);
    assert.equal(alignCount, 1);
    assert.equal(controller.getSnapshot().phase, 'uncertain');
    assert.equal(controller.getSnapshot().lastAlignmentSaved, null);
    assert.equal(controller.getSnapshot().receiptId, VALID_RECEIPT_ID);
    assert.equal(controller.getSnapshot().snapshot, snapshotBeforeUnknown);
    assert.equal(
      controller.getSnapshot().uncertainState?.errorMessage.includes('RESPONSE_VALIDATION_FAILED'),
      true
    );
    controller.setConfirmedApplyCaseMetadata(true);
    assert.equal(await controller.alignCatalogDraft(), null);
    assert.equal(alignCount, 1);

    // 9d: UNKNOWN -> server HOLD on GET: phase MUST remain uncertain and banner displays diagnostic
    getMode = 'GET_SERVER_HOLD';
    await controller.verifyAlignmentStatus();
    assert.equal(getCount, 4);
    assert.equal(alignCount, 1);
    assert.equal(controller.getSnapshot().phase, 'uncertain');
    assert.equal(controller.getSnapshot().lastAlignmentSaved, null);
    assert.equal(controller.getSnapshot().receiptId, VALID_RECEIPT_ID);
    assert.equal(controller.getSnapshot().snapshot, snapshotBeforeUnknown);
    assert.equal(controller.getSnapshot().holdState?.errorCode, 'TEMPORARY_VERIFICATION_HOLD');
    assert.equal(
      controller.getSnapshot().uncertainState?.errorMessage.includes('TEMPORARY_VERIFICATION_HOLD'),
      true
    );

    const uncertainMarkupAr = renderToStaticMarkup(
      React.createElement(LibraryQuarantineCatalogCaseAlignmentPanel, {
        controller,
        currentUser: owner,
        savedReviewCase: savedCaseV4,
        catalogDocument: catalogDoc,
        hasUnsavedCaseEdits: false,
        isAr: true,
      })
    );
    assert.equal(
      uncertainMarkupAr.includes('data-testid="quarantine-catalog-case-alignment-uncertain-banner"'),
      true
    );
    assert.equal(uncertainMarkupAr.includes('TEMPORARY_VERIFICATION_HOLD'), true);
    assert.equal(
      uncertainMarkupAr.includes('data-testid="verify-quarantine-catalog-case-alignment-btn"'),
      true
    );

    // Even after server HOLD during UNKNOWN recovery, align remains strictly blocked
    controller.setConfirmedApplyCaseMetadata(true);
    assert.equal(controller.getSnapshot().confirmedApplyCaseMetadata, false);
    assert.equal(await controller.alignCatalogDraft(), null);
    assert.equal(alignCount, 1);

    // 9e: UNKNOWN -> valid READY GET: latch cleared ONLY after successful validated read;
    // aligned revision and 4-field diff refreshed; no align write during GET; fresh confirmation required
    getMode = 'GET_VALID_READY_REFRESHED';
    const verifyRes = await controller.verifyAlignmentStatus();
    assert.equal(verifyRes?.ok, true);
    assert.equal(verifyRes?.status, 'READY');
    assert.equal(controller.getSnapshot().uncertainState, null);
    assert.equal(controller.getSnapshot().holdState, null);
    assert.equal(controller.getSnapshot().phase, 'ready');
    assert.equal(controller.getSnapshot().confirmedApplyCaseMetadata, false);
    assert.equal(controller.getSnapshot().snapshot?.effectiveAlignedCaseRevision, 1);
    assert.equal(controller.getSnapshot().snapshot?.diff.hasAnyDifference, true);
    assert.equal(getCount, 5);
    assert.equal(alignCount, 1);

    // Attempting align without fresh confirmation after UNKNOWN recovery is rejected with 0 writes
    assert.equal(await controller.alignCatalogDraft(), null);
    assert.equal(alignCount, 1);

    // 9f: Malformed post-dispatch response after fresh confirmation also resolves to UNKNOWN
    alignMode = 'MALFORMED_POST_DISPATCH';
    controller.setConfirmedApplyCaseMetadata(true);
    assert.equal(controller.getSnapshot().confirmedApplyCaseMetadata, true);
    const malformedAlignRes = await controller.alignCatalogDraft();
    assert.equal(malformedAlignRes, null);
    assert.equal(controller.getSnapshot().phase, 'uncertain');
    assert.equal(controller.getSnapshot().lastAlignmentSaved, null);
    assert.equal(alignCount, 2);

    console.log('CASE 9: ALIGN UNKNOWN latch persists across failed/malformed/HOLD GETs and openPanelForCase, clears only on valid READY GET, and requires fresh confirmation.');
  }

  // =========================================================================
  // CASE 10: Stale session / receipt change -> no state leak into another case
  // and stale async replies cannot unlock or corrupt an active receipt
  // =========================================================================
  {
    const firstCase = makeSavedHumanReviewCase({
      receiptId: VALID_RECEIPT_ID,
      revision: 4,
      titleAr: 'عنوان الوثيقة الأولى',
    });
    const secondCase = makeSavedHumanReviewCase({
      receiptId: SECOND_RECEIPT_ID,
      revision: 2,
      titleAr: 'عنوان الوثيقة الثانية',
    });

    let resolveFirstGet: ((val: GetLibraryQuarantineCatalogCaseAlignmentSuccessDto) => void) | null = null;
    let alignCalls = 0;

    const controller = new LibraryQuarantineCatalogCaseAlignmentPanelController(
      owner,
      {
        envOverride: ALL_ALIGNMENT_FLAGS_ENABLED,
        invokeCallable: async (req) => {
          if (req.action === 'alignQuarantineCatalogCase') {
            alignCalls += 1;
            return makeServerAlignUnknownResponse({ receiptId: req.receiptId });
          }
          if (req.receiptId === VALID_RECEIPT_ID && resolveFirstGet === null) {
            return new Promise<GetLibraryQuarantineCatalogCaseAlignmentSuccessDto>((resolve) => {
              resolveFirstGet = resolve;
            });
          }
          if (req.receiptId === VALID_RECEIPT_ID) {
            return makeServerGetReadyResponse({
              receiptId: VALID_RECEIPT_ID,
              humanReviewCase: firstCase,
            });
          }
          const doc2 = makeSanitizedCatalogDocumentDto({
            id: `qcat-${SECOND_RECEIPT_ID}`,
            titleAr: 'مسودة الوثيقة الثانية',
            versions: [
              {
                id: `qcat-${SECOND_RECEIPT_ID}-v1`,
                documentId: `qcat-${SECOND_RECEIPT_ID}`,
                versionNumber: '1.0-quarantine-draft',
                publishedDate: '2026-11-10',
                changeDescriptionAr: 'إنشاء مسودة الفهرس الخاصة من الحجر.',
                changeDescriptionEn: 'Created private quarantine catalog draft.',
              },
            ],
          });
          return makeServerGetReadyResponse({
            receiptId: SECOND_RECEIPT_ID,
            documentId: `qcat-${SECOND_RECEIPT_ID}`,
            handoff: makeSanitizedHandoffDto({
              receiptId: SECOND_RECEIPT_ID,
              documentId: `qcat-${SECOND_RECEIPT_ID}`,
            }),
            catalogDocument: doc2,
            humanReviewCase: secondCase,
            diff: computeClientCatalogCaseFourFieldDiff(secondCase, doc2),
            currentHumanCaseRevision: 2,
          });
        },
      }
    );

    const pendingFirst = controller.openPanelForCase(firstCase);
    // Switch to second receipt before first completes
    const secondState = await controller.openPanelForCase(secondCase);
    assert.equal(secondState.receiptId, SECOND_RECEIPT_ID);
    assert.equal(controller.getSnapshot().receiptId, SECOND_RECEIPT_ID);

    // Now resolve the stale first GET; it must be ignored and never overwrite second receipt state
    assert.notEqual(resolveFirstGet, null);
    resolveFirstGet!(makeServerGetReadyResponse({ receiptId: VALID_RECEIPT_ID }));
    await pendingFirst;
    assert.equal(controller.getSnapshot().receiptId, SECOND_RECEIPT_ID);
    assert.equal(
      controller.getSnapshot().snapshot?.humanReviewCase.titleAr,
      'عنوان الوثيقة الثانية'
    );

    // Put second receipt into UNKNOWN, then switch back to first receipt: first receipt is isolated
    controller.setConfirmedApplyCaseMetadata(true);
    await controller.alignCatalogDraft();
    assert.equal(alignCalls, 1);
    assert.equal(controller.getSnapshot().phase, 'uncertain');
    assert.equal(controller.getSnapshot().receiptId, SECOND_RECEIPT_ID);

    const switchedBackToFirst = await controller.openPanelForCase(firstCase);
    assert.equal(switchedBackToFirst.receiptId, VALID_RECEIPT_ID);
    assert.equal(switchedBackToFirst.phase, 'ready');
    assert.equal(switchedBackToFirst.uncertainState, null);
    assert.equal(alignCalls, 1);

    console.log('CASE 10: Stale session / receipt switch prevents state leak across cases.');
  }

  // =========================================================================
  // CASE 11: Protected qcat- fields remain Draft / ReviewRequired and all 5
  // assurance flags remain false, and independent human rights re-review
  // warning is preserved
  // =========================================================================
  {
    const validAlignment = makeAlignmentDto();
    const validatedAlignment = validateSanitizedCatalogCaseAlignmentDto(validAlignment);
    assert.notEqual(validatedAlignment, null);
    assert.equal(validatedAlignment?.isSanitized, false);
    assert.equal(validatedAlignment?.isVerifiedSafe, false);
    assert.equal(validatedAlignment?.isRightsApproved, false);
    assert.equal(validatedAlignment?.isPublished, false);
    assert.equal(validatedAlignment?.isReadyForPeia, false);

    // Any attempt to smuggle true assurance flags or non-Draft catalog state must fail validation
    assert.equal(
      validateSanitizedCatalogCaseAlignmentDto({
        ...validAlignment,
        isPublished: true,
      }),
      null
    );

    assert.equal(
      validateAlignCatalogCaseResponseDto({
        ...makeServerAlignAlignedResponse(),
        catalogDocument: {
          ...makeServerAlignAlignedResponse().catalogDocument,
          workflowState: WorkflowState.Published,
        },
      }),
      null
    );

    assert.equal(
      validateAlignCatalogCaseResponseDto({
        ...makeServerAlignAlignedResponse(),
        catalogDocument: {
          ...makeServerAlignAlignedResponse().catalogDocument,
          rightsStatus: LibraryRightsStatus.PublicDomain,
        },
      }),
      null
    );

    assert.throws(() => {
      validateAlignQuarantineCatalogCaseResponseDto({
        ...makeServerAlignAlignedResponse(),
        requiresFreshRightsReview: false,
      });
    }, /RESPONSE_VALIDATION_FAILED/);

    console.log('CASE 11: Protected qcat- Draft/ReviewRequired invariants, 5 false assurance flags, and fresh rights review requirement verified.');
  }

  console.log('\nALL LIB-CASE-ALIGNMENT-LIVE-CONTRACT-REPAIR-01 CLIENT TESTS PASSED.');
}

runTests().catch((err: unknown) => {
  console.error('LIB-CASE-ALIGNMENT-LIVE-CONTRACT-REPAIR-01 CLIENT TESTS FAILED:', err);
  process.exit(1);
});
