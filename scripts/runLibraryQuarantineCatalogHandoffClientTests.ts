import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { React: typeof React }).React = React;

import {
  AdminPermission,
  AdminRole,
  type AdminUser,
} from '../src/types/admin';
import {
  LibraryDocumentType,
  LibraryRightsStatus,
  type LibraryOrganization,
  type LibrarySource,
} from '../src/types/library';
import { WorkflowState } from '../src/types/workflow';
import type { SanitizedLibraryQuarantineAdminReceiptDto } from '../src/services/libraryAdminClient';
import type { SanitizedLibraryQuarantineHumanReviewCaseDto } from '../src/services/libraryQuarantineHumanReviewClient';
import {
  LibraryQuarantineCatalogHandoffClient,
  buildCreateQuarantineCatalogDraftPayload,
  buildGetQuarantineCatalogHandoffPayload,
  canCreateLibraryQuarantineCatalogDraft,
  isHumanReviewCaseEligibleForCatalogHandoff,
  isLibraryQuarantineCatalogHandoffEnabled,
  validateClientCatalogDraftClassificationInput,
  validateCreateQuarantineCatalogDraftResponse,
  validateGetQuarantineCatalogHandoffResponse,
  validateSanitizedLibraryQuarantineCatalogDocumentDto,
  validateSanitizedLibraryQuarantineCatalogHandoffDto,
  type CreateLibraryQuarantineCatalogDraftClassificationInput,
  type CreateLibraryQuarantineCatalogDraftResponseDto,
  type GetLibraryQuarantineCatalogHandoffResponseDto,
  type SanitizedLibraryQuarantineCatalogDocumentDto,
  type SanitizedLibraryQuarantineCatalogHandoffDto,
} from '../src/services/libraryQuarantineCatalogHandoffClient';
import {
  LibraryQuarantineCatalogHandoffPanel,
  LibraryQuarantineCatalogHandoffPanelController,
  createPrefilledCatalogHandoffForm,
} from '../src/components/library/LibraryQuarantineCatalogHandoffPanel';
import {
  LibraryQuarantineHumanReviewModal,
  LibraryQuarantineHumanReviewModalController,
} from '../src/components/library/LibraryQuarantineHumanReviewModal';
import { AdminLibraryManagement } from '../src/components/library/AdminLibraryManagement';

function buildHexReceiptId(index: number): string {
  return index.toString(16).padStart(32, '0');
}

function buildHexSha256(index: number): string {
  return index.toString(16).padStart(64, 'b');
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
    originalFilename: `wetlands-assessment-${index}.pdf`,
    sanitizedFilename: `wetlands-assessment-${index}.pdf`,
    format: 'PDF' as const,
    canonicalExtension: 'pdf' as const,
    canonicalMimeType: 'application/pdf' as const,
    byteSize: 16384 + index,
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
  revision = 2,
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
    titleAr: 'تقييم الأراضي الرطبة الساحلية 2026',
    titleEn: 'Coastal Wetlands Assessment 2026',
    issuingOrganization: 'برنامج الأمم المتحدة للبيئة (UNEP)',
    summaryAr: 'ملخص تحريري مراجع لوثيقة تقييم الأراضي الرطبة.',
    summaryEn: 'Reviewed editorial summary of the coastal wetlands assessment.',
    sourceEvidenceNotes: 'وثيقة رسمية صادرة عن برنامج الأمم المتحدة للبيئة.',
    rightsEvidenceNotes: 'بانتظار المراجعة الحقوقية المستقلة.',
    editorialNotes: 'تمت مطابقة البيانات الوصفية.',
    createdAt: '2026-11-09T10:00:00.000Z',
    updatedAt: '2026-11-09T10:15:00.000Z',
    ...overrides,
  });
}

function buildSanitizedHandoffDto(
  receiptId: string,
  overrides: Partial<SanitizedLibraryQuarantineCatalogHandoffDto> = {}
): SanitizedLibraryQuarantineCatalogHandoffDto {
  return Object.freeze({
    schemaVersion: 1 as const,
    receiptId,
    documentId: `qcat-${receiptId}`,
    sourceRevision: 2,
    sourceUpdatedAt: '2026-11-09T09:05:00.000Z',
    draftSourceRevision: 2,
    caseRevision: 2,
    caseUpdatedAt: '2026-11-09T10:15:00.000Z',
    organizationId: 'org-unep',
    sourceId: 'src-unep-verified',
    createdAt: '2026-11-09T10:30:00.000Z',
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
    ...overrides,
  });
}

function buildSanitizedCatalogDocumentDto(
  receiptId: string,
  overrides: Partial<SanitizedLibraryQuarantineCatalogDocumentDto> = {}
): SanitizedLibraryQuarantineCatalogDocumentDto {
  const documentId = `qcat-${receiptId}`;
  return Object.freeze({
    id: documentId,
    titleAr: 'تقييم الأراضي الرطبة الساحلية 2026',
    titleEn: 'Coastal Wetlands Assessment 2026',
    summaryAr: 'ملخص تحريري مراجع لوثيقة تقييم الأراضي الرطبة.',
    summaryEn: 'Reviewed editorial summary of the coastal wetlands assessment.',
    documentType: LibraryDocumentType.PolicyPaper,
    organizationId: 'org-unep',
    sourceId: 'src-unep-verified',
    geographyAr: 'غرب آسيا',
    geographyEn: 'West Asia',
    publicationDate: '2026-05-15',
    language: 'bilingual' as const,
    topicsAr: ['الأراضي الرطبة', 'التكيف المناخي'],
    topicsEn: ['Wetlands', 'Climate Adaptation'],
    environmentalDomains: ['Climate', 'Biodiversity'],
    rightsStatus: LibraryRightsStatus.ReviewRequired,
    workflowState: WorkflowState.Draft,
    legalStatusDescriptionAr: 'وثيقة سياسات غير ملزمة',
    legalStatusDescriptionEn: 'Non-binding policy guidance',
    createdAt: '2026-11-09T10:30:00.000Z',
    updatedAt: '2026-11-09T10:30:00.000Z',
    versions: [
      {
        id: `ver-${documentId}-1`,
        documentId,
        versionNumber: '1.0',
        publishedDate: '2026-05-15',
        changeDescriptionAr: 'إنشاء مسودة أولية',
        changeDescriptionEn: 'Initial draft created',
      },
    ],
    ...overrides,
  });
}

function buildOrganizations(): LibraryOrganization[] {
  return [
    {
      id: 'org-unep',
      nameAr: 'برنامج الأمم المتحدة للبيئة',
      nameEn: 'United Nations Environment Programme',
      type: 'InternationalBody',
      countryRegionAr: 'دولي',
      countryRegionEn: 'International',
      websiteUrl: 'https://www.unep.org',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];
}

function buildSources(): LibrarySource[] {
  return [
    {
      id: 'src-unep-verified',
      organizationId: 'org-unep',
      sourceNameAr: 'مستودع برنامج الأمم المتحدة للبيئة الموثق',
      sourceNameEn: 'Verified UNEP Repository',
      sourceUrl: 'https://wedocs.unep.org',
      sourceType: 'InstitutionalArchive',
      verificationStatus: 'Verified',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'src-unep-pending',
      organizationId: 'org-unep',
      sourceNameAr: 'مستودع قيد التحقق',
      sourceNameEn: 'Pending UNEP Repository',
      sourceUrl: 'https://pending.unep.org',
      sourceType: 'InstitutionalArchive',
      verificationStatus: 'PendingVerification',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];
}

function buildValidClassification(
  overrides: Partial<CreateLibraryQuarantineCatalogDraftClassificationInput> = {}
): CreateLibraryQuarantineCatalogDraftClassificationInput {
  return {
    titleAr: 'تقييم الأراضي الرطبة الساحلية 2026',
    titleEn: 'Coastal Wetlands Assessment 2026',
    summaryAr: 'ملخص تحريري مراجع لوثيقة تقييم الأراضي الرطبة.',
    summaryEn: 'Reviewed editorial summary of the coastal wetlands assessment.',
    documentType: LibraryDocumentType.PolicyPaper,
    organizationId: 'org-unep',
    sourceId: 'src-unep-verified',
    geographyAr: 'غرب آسيا',
    geographyEn: 'West Asia',
    publicationDate: '2026-05-15',
    language: 'bilingual',
    topicsAr: ['الأراضي الرطبة', 'التكيف المناخي'],
    topicsEn: ['Wetlands', 'Climate Adaptation'],
    environmentalDomains: ['Climate', 'Biodiversity'],
    legalStatusDescriptionAr: 'وثيقة سياسات غير ملزمة',
    legalStatusDescriptionEn: 'Non-binding policy guidance',
    ...overrides,
  };
}

async function runTests(): Promise<void> {
  let passed = 0;

  const owner = buildAdminUser(AdminRole.Owner);
  const curator = buildAdminUser(AdminRole.LibraryCurator);
  const rightsReviewer = buildAdminUser(AdminRole.RightsReviewer);
  const createOnlyCurator = buildAdminUser(AdminRole.LibraryCurator, {
    id: 'admin-create-only',
    permissions: [AdminPermission.View, AdminPermission.Create],
  });
  const aiAssistant = buildAdminUser(AdminRole.AIAssistant);
  const viewerUser = buildAdminUser(AdminRole.Viewer);

  const allThreeFlagsEnv = {
    VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED: 'true',
    VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED: 'true',
    VITE_LIBRARY_CATALOG_HANDOFF_ENABLED: 'true',
  };

  // =========================================================================
  // TEST 1: Triple Feature Flags, Dual RBAC, and METADATA_RECORDED Eligibility
  // =========================================================================
  {
    assert.equal(isLibraryQuarantineCatalogHandoffEnabled({}), false);
    assert.equal(
      isLibraryQuarantineCatalogHandoffEnabled({
        VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED: 'true',
        VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED: 'true',
      }),
      false
    );
    assert.equal(
      isLibraryQuarantineCatalogHandoffEnabled({
        VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED: 'true',
        VITE_LIBRARY_CATALOG_HANDOFF_ENABLED: 'true',
      }),
      false
    );
    assert.equal(
      isLibraryQuarantineCatalogHandoffEnabled(allThreeFlagsEnv),
      true
    );

    assert.equal(canCreateLibraryQuarantineCatalogDraft(owner), true);
    assert.equal(canCreateLibraryQuarantineCatalogDraft(curator), true);
    assert.equal(
      canCreateLibraryQuarantineCatalogDraft(rightsReviewer),
      false,
      'RightsReviewer lacks Create permission and must not create catalog drafts'
    );
    assert.equal(
      canCreateLibraryQuarantineCatalogDraft(createOnlyCurator),
      false,
      'User lacking Review permission must not create catalog drafts'
    );
    assert.equal(canCreateLibraryQuarantineCatalogDraft(aiAssistant), false);
    assert.equal(canCreateLibraryQuarantineCatalogDraft(viewerUser), false);

    const receiptId = buildHexReceiptId(1);
    assert.equal(
      isHumanReviewCaseEligibleForCatalogHandoff(
        buildSanitizedCaseDto(receiptId, 2, { status: 'METADATA_RECORDED' })
      ),
      true
    );
    assert.equal(
      isHumanReviewCaseEligibleForCatalogHandoff(
        buildSanitizedCaseDto(receiptId, 2, { status: 'IN_REVIEW' })
      ),
      false
    );
    assert.equal(
      isHumanReviewCaseEligibleForCatalogHandoff(
        buildSanitizedCaseDto(receiptId, 2, { status: 'NEEDS_INFORMATION' })
      ),
      false
    );
    assert.equal(
      isHumanReviewCaseEligibleForCatalogHandoff(
        buildSanitizedCaseDto(receiptId, 2, { status: 'NOT_SUITABLE' })
      ),
      false
    );
    assert.equal(isHumanReviewCaseEligibleForCatalogHandoff(null), false);

    passed += 1;
    console.log(
      'PASS [1/6]: Triple feature flags, dual RBAC (Review + Create), and METADATA_RECORDED eligibility verified'
    );
  }

  // =========================================================================
  // TEST 2: Payload Builders & Strict Response Validators (Zero Leakage)
  // =========================================================================
  {
    const receiptId = buildHexReceiptId(2);
    const getPayload = buildGetQuarantineCatalogHandoffPayload(receiptId);
    assert.deepEqual(getPayload, {
      action: 'getQuarantineCatalogHandoff',
      receiptId,
    });

    const createPayload = buildCreateQuarantineCatalogDraftPayload({
      receiptId,
      expectedCaseRevision: 2,
      input: buildValidClassification(),
    });
    assert.equal(createPayload.action, 'createQuarantineCatalogDraft');
    assert.equal(createPayload.receiptId, receiptId);
    assert.equal(createPayload.expectedCaseRevision, 2);
    assert.equal(createPayload.input.organizationId, 'org-unep');

    assert.throws(
      () =>
        validateClientCatalogDraftClassificationInput({
          ...buildValidClassification(),
          organizationId: '<script>evil()</script>',
        }),
      /INVALID_CLASSIFICATION_INPUT/i
    );

    const handoffDto = buildSanitizedHandoffDto(receiptId);
    const draftDto = buildSanitizedCatalogDocumentDto(receiptId);

    const validatedHandoff = validateSanitizedLibraryQuarantineCatalogHandoffDto(
      handoffDto,
      receiptId
    );
    assert.equal(validatedHandoff.documentId, `qcat-${receiptId}`);

    const validatedDraft = validateSanitizedLibraryQuarantineCatalogDocumentDto(
      draftDto,
      `qcat-${receiptId}`
    );
    assert.equal(validatedDraft.id, `qcat-${receiptId}`);
    assert.equal(validatedDraft.workflowState, WorkflowState.Draft);
    assert.equal(
      validatedDraft.rightsStatus,
      LibraryRightsStatus.ReviewRequired
    );

    // Reject extra / leaked fields
    const leakedDrafts: Array<Record<string, unknown>> = [
      { ...draftDto, referenceUrl: 'https://evil.example/file.pdf' },
      { ...draftDto, storagePath: `library/quarantine/${receiptId}/source.pdf` },
      { ...draftDto, generation: '9001' },
      { ...draftDto, createdBy: 'admin-curator' },
      { ...draftDto, workflowState: WorkflowState.Published },
      { ...draftDto, rightsStatus: LibraryRightsStatus.OpenPubliclyAvailable },
    ];

    for (const leaked of leakedDrafts) {
      assert.throws(
        () =>
          validateSanitizedLibraryQuarantineCatalogDocumentDto(
            leaked,
            `qcat-${receiptId}`
          ),
        /CATALOG_DOCUMENT_DTO_INVALID/i
      );
    }

    const getReadyResponse: GetLibraryQuarantineCatalogHandoffResponseDto = {
      ok: true,
      status: 'READY',
      receiptId,
      documentId: `qcat-${receiptId}`,
      handoffExists: false,
      handoff: null,
      catalogDocument: null,
      caseStatus: 'METADATA_RECORDED',
      currentCaseRevision: 2,
      isEligibleForHandoff: true,
      isSanitized: false,
      isVerifiedSafe: false,
      isRightsApproved: false,
      isPublished: false,
      isReadyForPeia: false,
    };
    assert.equal(
      validateGetQuarantineCatalogHandoffResponse(getReadyResponse, receiptId)
        .status,
      'READY'
    );

    const createResponse: CreateLibraryQuarantineCatalogDraftResponseDto = {
      ok: true,
      status: 'HANDOFF_RECORDED',
      disposition: 'CREATED',
      documentCreationOutcome: 'CREATED',
      documentCreated: true,
      receiptId,
      documentId: `qcat-${receiptId}`,
      caseRevision: 2,
      handoff: handoffDto,
      catalogDocument: draftDto,
      isSanitized: false,
      isVerifiedSafe: false,
      isRightsApproved: false,
      isPublished: false,
      isReadyForPeia: false,
    };
    const validatedCreateRes = validateCreateQuarantineCatalogDraftResponse(
      createResponse,
      receiptId
    );
    assert.equal(validatedCreateRes.status, 'HANDOFF_RECORDED');

    passed += 1;
    console.log(
      'PASS [2/6]: Payload builders and strict response validators reject leaked internal/URL fields'
    );
  }

  // =========================================================================
  // TEST 3: Prefill Only 4 Editorial Fields & Do Not Fabricate Classification
  // =========================================================================
  {
    const receiptId = buildHexReceiptId(3);
    const reviewCase = buildSanitizedCaseDto(receiptId, 2);

    const prefilled = createPrefilledCatalogHandoffForm(reviewCase);
    assert.equal(prefilled.titleAr, reviewCase.titleAr);
    assert.equal(prefilled.titleEn, reviewCase.titleEn);
    assert.equal(prefilled.summaryAr, reviewCase.summaryAr);
    assert.equal(prefilled.summaryEn, reviewCase.summaryEn);

    // Must NOT fabricate classification fields from free-text issuingOrganization
    assert.equal(prefilled.originalTitle, '');
    assert.equal(prefilled.documentType, '');
    assert.equal(prefilled.organizationId, '');
    assert.equal(prefilled.sourceId, '');
    assert.equal(prefilled.geographyAr, '');
    assert.equal(prefilled.geographyEn, '');
    assert.equal(prefilled.publicationDate, '');
    assert.equal(prefilled.language, '');
    assert.equal(prefilled.topicsArText, '');
    assert.equal(prefilled.topicsEnText, '');
    assert.equal(prefilled.environmentalDomainsText, '');
    assert.equal(prefilled.legalStatusDescriptionAr, '');
    assert.equal(prefilled.legalStatusDescriptionEn, '');

    const controller = new LibraryQuarantineCatalogHandoffPanelController(
      curator,
      {
        catalogHandoffEnabled: true,
        getHandoffFn: async () => ({
          ok: true,
          status: 'READY',
          receiptId,
          documentId: `qcat-${receiptId}`,
          handoffExists: false,
          handoff: null,
          catalogDocument: null,
          caseStatus: 'METADATA_RECORDED',
          currentCaseRevision: 2,
          isEligibleForHandoff: true,
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
        }),
      }
    );

    await controller.openPanelForCase(reviewCase);
    assert.equal(controller.getSnapshot().isExpanded, true);
    assert.equal(controller.getSnapshot().form.titleAr, reviewCase.titleAr);
    assert.equal(controller.getSnapshot().form.organizationId, '');

    // Changing organizationId resets sourceId
    controller.updateFormField('organizationId', 'org-unep');
    controller.updateFormField('sourceId', 'src-unep-verified');
    assert.equal(controller.getSnapshot().form.sourceId, 'src-unep-verified');
    controller.updateFormField('organizationId', 'org-other');
    assert.equal(controller.getSnapshot().form.sourceId, '');

    passed += 1;
    console.log(
      'PASS [3/6]: Controller prefills only 4 editorial fields and never fabricates classification'
    );
  }

  // =========================================================================
  // TEST 4: Duplicate-Submit Lock & Admin Documents List Sync on Create
  // =========================================================================
  {
    const receiptId = buildHexReceiptId(4);
    const reviewCase = buildSanitizedCaseDto(receiptId, 2);
    const handoffDto = buildSanitizedHandoffDto(receiptId);
    const draftDto = buildSanitizedCatalogDocumentDto(receiptId);

    let createCalls = 0;
    let resolveCreate:
      | ((res: CreateLibraryQuarantineCatalogDraftResponseDto) => void)
      | null = null;

    const syncedDrafts: SanitizedLibraryQuarantineCatalogDocumentDto[] = [];
    const controller = new LibraryQuarantineCatalogHandoffPanelController(
      curator,
      {
        catalogHandoffEnabled: true,
        getHandoffFn: async () => ({
          ok: true,
          status: 'READY',
          receiptId,
          documentId: `qcat-${receiptId}`,
          handoffExists: createCalls > 0,
          handoff: createCalls > 0 ? handoffDto : null,
          catalogDocument: createCalls > 0 ? draftDto : null,
          caseStatus: 'METADATA_RECORDED',
          currentCaseRevision: 2,
          isEligibleForHandoff: true,
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
        }),
        createDraftFn: async () => {
          createCalls += 1;
          return new Promise<CreateLibraryQuarantineCatalogDraftResponseDto>(
            (resolve) => {
              resolveCreate = resolve;
            }
          );
        },
        onCatalogDraftReady: (doc) => {
          syncedDrafts.push(doc);
        },
      }
    );

    await controller.openPanelForCase(reviewCase);
    controller.updateFormField('documentType', LibraryDocumentType.PolicyPaper);
    controller.updateFormField('organizationId', 'org-unep');
    controller.updateFormField('sourceId', 'src-unep-verified');
    controller.updateFormField('geographyAr', 'غرب آسيا');
    controller.updateFormField('geographyEn', 'West Asia');
    controller.updateFormField('publicationDate', '2026-05-15');
    controller.updateFormField('language', 'bilingual');
    controller.updateFormField('topicsArText', 'الأراضي الرطبة، التكيف المناخي');
    controller.updateFormField('topicsEnText', 'Wetlands, Climate Adaptation');
    controller.updateFormField(
      'environmentalDomainsText',
      'Climate, Biodiversity'
    );
    controller.updateFormField(
      'legalStatusDescriptionAr',
      'وثيقة سياسات غير ملزمة'
    );
    controller.updateFormField(
      'legalStatusDescriptionEn',
      'Non-binding policy guidance'
    );

    const firstSubmitPromise = controller.submitCatalogDraft();
    assert.equal(controller.getSnapshot().submitting, true);

    // Duplicate submit while in-flight must be ignored
    const secondSubmitResult = await controller.submitCatalogDraft();
    assert.equal(secondSubmitResult, null);
    assert.equal(createCalls, 1);

    resolveCreate!({
      ok: true,
      status: 'HANDOFF_RECORDED',
      disposition: 'CREATED',
      documentCreationOutcome: 'CREATED',
      documentCreated: true,
      receiptId,
      documentId: `qcat-${receiptId}`,
      caseRevision: 2,
      handoff: handoffDto,
      catalogDocument: draftDto,
      isSanitized: false,
      isVerifiedSafe: false,
      isRightsApproved: false,
      isPublished: false,
      isReadyForPeia: false,
    });

    const finalRes = await firstSubmitPromise;
    assert.ok(finalRes);
    assert.equal(finalRes.status, 'HANDOFF_RECORDED');
    assert.equal(controller.getSnapshot().handoffExists, true);
    assert.equal(controller.getSnapshot().submitting, false);
    assert.equal(syncedDrafts.length >= 1, true);
    assert.equal(syncedDrafts[0].id, `qcat-${receiptId}`);

    passed += 1;
    console.log(
      'PASS [4/6]: Duplicate-submit lock prevents double creation and syncs created draft to Admin list'
    );
  }

  // =========================================================================
  // TEST 5: UNKNOWN Commit Uncertainty Disables Create & Exposes Verify-Only Action
  // =========================================================================
  {
    const receiptId = buildHexReceiptId(5);
    const reviewCase = buildSanitizedCaseDto(receiptId, 2);
    const handoffDto = buildSanitizedHandoffDto(receiptId);
    const draftDto = buildSanitizedCatalogDocumentDto(receiptId);

    let getCalls = 0;
    let createCalls = 0;

    const controller = new LibraryQuarantineCatalogHandoffPanelController(
      curator,
      {
        catalogHandoffEnabled: true,
        getHandoffFn: async () => {
          getCalls += 1;
          if (getCalls === 1) {
            return {
              ok: true,
              status: 'READY',
              receiptId,
              documentId: `qcat-${receiptId}`,
              handoffExists: false,
              handoff: null,
              catalogDocument: null,
              caseStatus: 'METADATA_RECORDED',
              currentCaseRevision: 2,
              isEligibleForHandoff: true,
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
            documentId: `qcat-${receiptId}`,
            handoffExists: true,
            handoff: handoffDto,
            catalogDocument: draftDto,
            caseStatus: 'METADATA_RECORDED',
            currentCaseRevision: 2,
            isEligibleForHandoff: true,
            isSanitized: false,
            isVerifiedSafe: false,
            isRightsApproved: false,
            isPublished: false,
            isReadyForPeia: false,
          };
        },
        createDraftFn: async () => {
          createCalls += 1;
          return {
            ok: false,
            status: 'UNKNOWN',
            documentCreationOutcome: 'UNKNOWN',
            documentCreated: null,
            errorCode: 'TRANSACTION_COMMIT_UNCERTAIN',
            errorMessage:
              'Catalog handoff transaction commit acknowledgement was lost after staging writes; verify draft status before retrying.',
            receiptId,
            documentId: `qcat-${receiptId}`,
            isSanitized: false,
            isVerifiedSafe: false,
            isRightsApproved: false,
            isPublished: false,
            isReadyForPeia: false,
          };
        },
      }
    );

    await controller.openPanelForCase(reviewCase);
    controller.updateFormField('documentType', LibraryDocumentType.PolicyPaper);
    controller.updateFormField('organizationId', 'org-unep');
    controller.updateFormField('sourceId', 'src-unep-verified');
    controller.updateFormField('geographyAr', 'غرب آسيا');
    controller.updateFormField('geographyEn', 'West Asia');
    controller.updateFormField('publicationDate', '2026-05-15');
    controller.updateFormField('language', 'bilingual');
    controller.updateFormField('topicsArText', 'الأراضي الرطبة');
    controller.updateFormField('topicsEnText', 'Wetlands');
    controller.updateFormField('environmentalDomainsText', 'Climate');
    controller.updateFormField(
      'legalStatusDescriptionAr',
      'وثيقة سياسات غير ملزمة'
    );
    controller.updateFormField(
      'legalStatusDescriptionEn',
      'Non-binding policy guidance'
    );

    const unknownRes = await controller.submitCatalogDraft();
    assert.ok(unknownRes);
    assert.equal(unknownRes.status, 'UNKNOWN');
    assert.ok(controller.getSnapshot().uncertainState);
    assert.equal(
      controller.getSnapshot().uncertainState?.documentCreated,
      null
    );
    assert.equal(
      createCalls,
      1,
      'Must perform zero automatic retries on UNKNOWN commit uncertainty'
    );
    assert.equal(
      getCalls,
      1,
      'Must wait for explicit human Verify Draft click before re-reading'
    );

    // Attempting submitCatalogDraft again while in UNKNOWN state is blocked
    const blockedRetry = await controller.submitCatalogDraft();
    assert.equal(blockedRetry, null);
    assert.equal(createCalls, 1);

    // Render panel in AR and EN to verify "تحقق من المسودة" / "Verify draft" button
    const arUnknownHtml = renderToStaticMarkup(
      React.createElement(LibraryQuarantineCatalogHandoffPanel, {
        controller,
        currentUser: curator,
        savedReviewCase: reviewCase,
        hasUnsavedCaseEdits: false,
        organizations: buildOrganizations(),
        sources: buildSources(),
        isAr: true,
      })
    );
    const enUnknownHtml = renderToStaticMarkup(
      React.createElement(LibraryQuarantineCatalogHandoffPanel, {
        controller,
        currentUser: curator,
        savedReviewCase: reviewCase,
        hasUnsavedCaseEdits: false,
        organizations: buildOrganizations(),
        sources: buildSources(),
        isAr: false,
      })
    );
    assert.equal(arUnknownHtml.includes('تحقق من المسودة'), true);
    assert.equal(enUnknownHtml.includes('Verify draft'), true);

    // Explicit human click on Verify Draft calls getQuarantineCatalogHandoff (read-only)
    const verifiedRes = await controller.verifyDraftStatus();
    assert.ok(verifiedRes);
    assert.equal(verifiedRes.ok, true);
    assert.equal(getCalls, 2);
    assert.equal(createCalls, 1);
    assert.equal(controller.getSnapshot().handoffExists, true);
    assert.equal(controller.getSnapshot().uncertainState, null);

    passed += 1;
    console.log(
      'PASS [5/6]: UNKNOWN commit uncertainty blocks create and recovers via Verify Draft read-only check'
    );
  }

  // =========================================================================
  // TEST 6: Bilingual AR/EN Rendering Inside Modal & AdminLibraryManagement
  // =========================================================================
  {
    const receiptId = buildHexReceiptId(6);
    const receipt = buildSanitizedAdminReceipt(6, { receiptId });
    const reviewCase = buildSanitizedCaseDto(receiptId, 2, {
      status: 'METADATA_RECORDED',
    });
    const handoffDto = buildSanitizedHandoffDto(receiptId);
    const draftDto = buildSanitizedCatalogDocumentDto(receiptId);

    const modalController = new LibraryQuarantineHumanReviewModalController(
      curator,
      {
        humanReviewEnabled: true,
        getCaseFn: async () => ({
          ok: true,
          status: 'READY',
          receiptId,
          sourceRevision: 2,
          draftStatus: 'PENDING_HUMAN_REVIEW',
          adminReceipt: receipt,
          currentRevision: 2,
          reviewCase,
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
        }),
      }
    );
    await modalController.openCase(receipt, 2);

    const handoffController = new LibraryQuarantineCatalogHandoffPanelController(
      curator,
      {
        catalogHandoffEnabled: true,
        getHandoffFn: async () => ({
          ok: true,
          status: 'READY',
          receiptId,
          documentId: `qcat-${receiptId}`,
          handoffExists: false,
          handoff: null,
          catalogDocument: null,
          caseStatus: 'METADATA_RECORDED',
          currentCaseRevision: 2,
          isEligibleForHandoff: true,
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
        }),
      }
    );

    // Render modal with CTA button (before opening classification form)
    const arModalCtaHtml = renderToStaticMarkup(
      React.createElement(LibraryQuarantineHumanReviewModal, {
        controller: modalController,
        currentUser: curator,
        isAr: true,
        catalogHandoffController: handoffController,
        organizations: buildOrganizations(),
        sources: buildSources(),
      })
    );
    const enModalCtaHtml = renderToStaticMarkup(
      React.createElement(LibraryQuarantineHumanReviewModal, {
        controller: modalController,
        currentUser: curator,
        isAr: false,
        catalogHandoffController: handoffController,
        organizations: buildOrganizations(),
        sources: buildSources(),
      })
    );

    assert.equal(arModalCtaHtml.includes('نقل إلى مسودة المكتبة'), true);
    assert.equal(enModalCtaHtml.includes('Prepare library draft'), true);

    // Open classification form and verify Verified-only source filtering in rendered markup
    await handoffController.openPanelForCase(reviewCase);
    handoffController.updateFormField('organizationId', 'org-unep');

    const arFormHtml = renderToStaticMarkup(
      React.createElement(LibraryQuarantineHumanReviewModal, {
        controller: modalController,
        currentUser: curator,
        isAr: true,
        catalogHandoffController: handoffController,
        organizations: buildOrganizations(),
        sources: buildSources(),
      })
    );
    const enFormHtml = renderToStaticMarkup(
      React.createElement(LibraryQuarantineHumanReviewModal, {
        controller: modalController,
        currentUser: curator,
        isAr: false,
        catalogHandoffController: handoffController,
        organizations: buildOrganizations(),
        sources: buildSources(),
      })
    );

    assert.equal(
      arFormHtml.includes('تأكيد إنشاء مسودة الفهرس الداخلية'),
      true
    );
    assert.equal(enFormHtml.includes('Create internal catalog draft'), true);
    // Verified source appears; PendingVerification source is excluded
    assert.equal(enFormHtml.includes('Verified UNEP Repository'), true);
    assert.equal(enFormHtml.includes('Pending UNEP Repository'), false);

    // Render HANDOFF_RECORDED summary card
    const recordedController = new LibraryQuarantineCatalogHandoffPanelController(
      curator,
      {
        catalogHandoffEnabled: true,
        getHandoffFn: async () => ({
          ok: true,
          status: 'READY',
          receiptId,
          documentId: `qcat-${receiptId}`,
          handoffExists: true,
          handoff: handoffDto,
          catalogDocument: draftDto,
          caseStatus: 'METADATA_RECORDED',
          currentCaseRevision: 2,
          isEligibleForHandoff: true,
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
        }),
      }
    );
    await recordedController.openPanelForCase(reviewCase);

    const arRecordedHtml = renderToStaticMarkup(
      React.createElement(LibraryQuarantineCatalogHandoffPanel, {
        controller: recordedController,
        currentUser: curator,
        savedReviewCase: reviewCase,
        hasUnsavedCaseEdits: false,
        organizations: buildOrganizations(),
        sources: buildSources(),
        isAr: true,
      })
    );
    const enRecordedHtml = renderToStaticMarkup(
      React.createElement(LibraryQuarantineCatalogHandoffPanel, {
        controller: recordedController,
        currentUser: curator,
        savedReviewCase: reviewCase,
        hasUnsavedCaseEdits: false,
        organizations: buildOrganizations(),
        sources: buildSources(),
        isAr: false,
      })
    );

    assert.equal(arRecordedHtml.includes(`qcat-${receiptId}`), true);
    assert.equal(enRecordedHtml.includes(`qcat-${receiptId}`), true);

    // Ensure AdminLibraryManagement renders cleanly with the new props
    const adminHtml = renderToStaticMarkup(
      React.createElement(AdminLibraryManagement, {
        currentUser: curator,
        quarantineAdminReceipts: [receipt],
        quarantineCatalogHandoffController: recordedController,
      })
    );
    assert.equal(adminHtml.length > 0, true);

    // Also test LibraryQuarantineCatalogHandoffClient with mock invoker
    const clientGetRes =
      await LibraryQuarantineCatalogHandoffClient.getQuarantineCatalogHandoff(
        receiptId,
        async () => ({
          data: {
            ok: true,
            status: 'READY',
            receiptId,
            documentId: `qcat-${receiptId}`,
            handoffExists: true,
            handoff: handoffDto,
            catalogDocument: draftDto,
            caseStatus: 'METADATA_RECORDED',
            currentCaseRevision: 2,
            isEligibleForHandoff: true,
            isSanitized: false,
            isVerifiedSafe: false,
            isRightsApproved: false,
            isPublished: false,
            isReadyForPeia: false,
          },
        })
      );
    assert.equal(clientGetRes.ok, true);

    passed += 1;
    console.log(
      'PASS [6/6]: Bilingual AR/EN rendering of CTA, classification form, Verified source filter, and linked draft summary verified'
    );
  }

  console.log(
    `\nALL ${passed}/6 QUARANTINE CATALOG HANDOFF CLIENT & UI TESTS PASSED.`
  );
}

runTests().catch((err: unknown) => {
  console.error('QUARANTINE CATALOG HANDOFF CLIENT TESTS FAILED:', err);
  process.exitCode = 1;
});
