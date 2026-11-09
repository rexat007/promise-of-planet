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
import {
  LIBRARY_QUARANTINE_RIGHTS_BASES,
  LIBRARY_QUARANTINE_RIGHTS_DECISION_SCHEMA_VERSION,
  LIBRARY_QUARANTINE_RIGHTS_DECISION_STATUSES,
  LIBRARY_QUARANTINE_RIGHTS_SCOPE,
  LIBRARY_RIGHTS_DECISION_UI_ENV_VAR,
  QUARANTINE_RIGHTS_READINESS_INDICATORS,
  RIGHTS_DECISION_CLIENT_SAFE_ERRORS,
  LibraryQuarantineRightsDecisionClient,
  buildGetQuarantineRightsDecisionActionPayload,
  buildSaveQuarantineRightsDecisionActionPayload,
  canReviewLibraryQuarantineRights,
  deriveQuarantineCatalogDocumentId,
  isLibraryQuarantineRightsDecisionEnabled,
  validateClientRightsDecisionInput,
  validateGetQuarantineRightsDecisionResponseDto,
  validateReadinessIndicatorsDto,
  validateSanitizedRightsDecisionDto,
  validateSaveQuarantineRightsDecisionResponseDto,
  type GetLibraryQuarantineRightsDecisionResponseDto,
  type SanitizedLibraryQuarantineRightsDecisionDto,
  type SaveLibraryQuarantineRightsDecisionResponseDto,
} from '../src/services/libraryQuarantineRightsDecisionClient';
import {
  LibraryQuarantineRightsDecisionPanel,
  LibraryQuarantineRightsDecisionPanelController,
  createEmptyRightsDecisionForm,
  isSavedHumanCaseEligibleForRightsPanel,
} from '../src/components/library/LibraryQuarantineRightsDecisionPanel';
import {
  LibraryQuarantineCatalogHandoffPanelController,
} from '../src/components/library/LibraryQuarantineCatalogHandoffPanel';
import {
  LibraryQuarantineHumanReviewModal,
  LibraryQuarantineHumanReviewModalController,
} from '../src/components/library/LibraryQuarantineHumanReviewModal';
import { canCreateLibraryQuarantineCatalogDraft } from '../src/services/libraryQuarantineCatalogHandoffClient';

const VALID_RECEIPT_ID = 'd4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9';
const OTHER_RECEIPT_ID = '11223344556677889900aabbccddeeff';
const VALID_DOC_ID = `qcat-${VALID_RECEIPT_ID}`;
const VALID_ISO = '2026-11-10T10:30:00.000Z';
const VALID_ISO_2 = '2026-11-10T10:35:00.000Z';

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

function makeSanitizedReceipt(
  receiptId: string = VALID_RECEIPT_ID
): SanitizedLibraryQuarantineAdminReceiptDto {
  return Object.freeze({
    receiptId,
    uploaderUid: 'admin-curator',
    originalFilename: 'national-climate-adaptation-report-2026.pdf',
    sanitizedFilename: 'national-climate-adaptation-report-2026.pdf',
    format: 'PDF' as const,
    canonicalExtension: 'pdf' as const,
    canonicalMimeType: 'application/pdf' as const,
    byteSize: 204800,
    sha256: 'a'.repeat(64),
    state: 'Quarantined' as const,
    deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER' as const,
    hasVerifiedStorageWrite: true,
    reconciliationRequired: false,
    reconciliationReason: null,
    rejectionReasonCode: null,
    createdAt: VALID_ISO,
    updatedAt: VALID_ISO,
    isQuarantinedPrivateOnly: true,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
  });
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
    titleAr: 'التقرير الوطني للتكيف المناخي 2026',
    titleEn: 'National Climate Adaptation Report 2026',
    issuingOrganization: 'Ministry of Environment',
    summaryAr: 'ملخص التقرير الوطني للتكيف المناخي.',
    summaryEn: 'Summary of the National Climate Adaptation Report.',
    sourceEvidenceNotes: 'Official Gazette Issue 4210, archived print copy.',
    rightsEvidenceNotes:
      'Preliminary curator note: check ministry open government license.',
    editorialNotes: 'Verified preliminary metadata.',
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

function makeSanitizedRightsDecisionDto(
  overrides?: Partial<SanitizedLibraryQuarantineRightsDecisionDto>
): SanitizedLibraryQuarantineRightsDecisionDto {
  return Object.freeze({
    schemaVersion: LIBRARY_QUARANTINE_RIGHTS_DECISION_SCHEMA_VERSION,
    receiptId: VALID_RECEIPT_ID,
    documentId: VALID_DOC_ID,
    revision: 1,
    sourceRevision: 1,
    sourceUpdatedAt: VALID_ISO,
    draftSourceRevision: 1,
    catalogHandoffCaseRevision: 2,
    currentHumanCaseRevision: 2,
    rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
    decision: 'METADATA_USE_CLEARED' as const,
    basis: 'OFFICIAL_RECORD' as const,
    evidenceReference: 'Official Gazette Issue 4210 — Record #77-2026',
    evidenceNotes:
      'Official government publication permitting descriptive bibliographic metadata cataloging.',
    reviewNotes:
      'Metadata cataloging cleared; binary PDF release remains blocked pending sanitization.',
    createdAt: VALID_ISO,
    updatedAt: VALID_ISO_2,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
    ...overrides,
  });
}

function assertMarkupZeroSecretLeakage(markup: string): void {
  const forbiddenSubstrings = [
    'sourceSha256',
    'createdBy',
    'updatedBy',
    'uploaderUid',
    'storagePath',
    'attestedStoragePath',
    'attestedGeneration',
    'gcsGeneration',
    'objectGeneration',
    'metageneration',
    'bucketName',
    'signedUrl',
    'downloadUrl',
    'downloadToken',
    'gs://',
    'library/quarantine/',
    'firebasestorage.googleapis.com',
  ];
  for (const token of forbiddenSubstrings) {
    assert.equal(
      markup.includes(token),
      false,
      `Rendered markup must never contain private or secret token "${token}"`
    );
  }
}

async function runTests(): Promise<void> {
  // =========================================================================
  // PASS 1: 4-Flag UI Release Gate & Human Rights Reviewer RBAC
  // =========================================================================
  {
    assert.equal(
      LIBRARY_RIGHTS_DECISION_UI_ENV_VAR,
      'VITE_LIBRARY_RIGHTS_DECISION_ENABLED'
    );

    // Default / empty env -> false
    assert.equal(isLibraryQuarantineRightsDecisionEnabled({}), false);

    // Missing any of the 4 flags -> false
    assert.equal(
      isLibraryQuarantineRightsDecisionEnabled({
        VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED: 'true',
        VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED: 'true',
        VITE_LIBRARY_CATALOG_HANDOFF_ENABLED: 'true',
      }),
      false
    );
    assert.equal(
      isLibraryQuarantineRightsDecisionEnabled({
        VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED: 'true',
        VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED: 'true',
        VITE_LIBRARY_RIGHTS_DECISION_ENABLED: 'true',
      }),
      false
    );
    assert.equal(
      isLibraryQuarantineRightsDecisionEnabled({
        VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED: 'true',
        VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED: 'true',
        VITE_LIBRARY_CATALOG_HANDOFF_ENABLED: 'true',
        VITE_LIBRARY_RIGHTS_DECISION_ENABLED: 'false',
      }),
      false
    );

    // All 4 flags === 'true' -> true
    assert.equal(
      isLibraryQuarantineRightsDecisionEnabled({
        VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED: 'true',
        VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED: 'true',
        VITE_LIBRARY_CATALOG_HANDOFF_ENABLED: 'true',
        VITE_LIBRARY_RIGHTS_DECISION_ENABLED: 'true',
      }),
      true
    );

    // RBAC checks: RightsReviewer (Review + ManageRights, NO Create) and Owner qualify
    const rightsReviewer = makeAdminUser(AdminRole.RightsReviewer);
    const owner = makeAdminUser(AdminRole.Owner);
    const libraryCurator = makeAdminUser(AdminRole.LibraryCurator);
    const curatorWithExplicitRights = makeAdminUser(AdminRole.LibraryCurator, {
      permissions: [
        AdminPermission.View,
        AdminPermission.Review,
        AdminPermission.Create,
        AdminPermission.ManageRights,
      ],
    });
    const viewer = makeAdminUser(AdminRole.Viewer);
    const contentEditor = makeAdminUser(AdminRole.ContentEditor);
    const trainingManager = makeAdminUser(AdminRole.TrainingManager);
    const aiAssistant = makeAdminUser(AdminRole.AIAssistant);
    const inactiveRightsReviewer = makeAdminUser(AdminRole.RightsReviewer, {
      isActive: false,
    });

    assert.equal(canReviewLibraryQuarantineRights(rightsReviewer), true);
    // Crucial separation of duties: RightsReviewer CANNOT create catalog handoffs (lacks Create)
    assert.equal(canCreateLibraryQuarantineCatalogDraft(rightsReviewer), false);
    assert.equal(canReviewLibraryQuarantineRights(owner), true);

    // LibraryCurator by default has Review + Create + Edit, NOT ManageRights -> false
    assert.equal(canReviewLibraryQuarantineRights(libraryCurator), false);
    assert.equal(canCreateLibraryQuarantineCatalogDraft(libraryCurator), true);
    // If explicit permissions lacks ManageRights -> false
    assert.equal(
      canReviewLibraryQuarantineRights(
        makeAdminUser(AdminRole.Owner, {
          permissions: [AdminPermission.View, AdminPermission.Review],
        })
      ),
      false
    );
    assert.equal(canReviewLibraryQuarantineRights(curatorWithExplicitRights), false);
    assert.equal(canReviewLibraryQuarantineRights(viewer), false);
    assert.equal(canReviewLibraryQuarantineRights(contentEditor), false);
    assert.equal(canReviewLibraryQuarantineRights(trainingManager), false);
    assert.equal(canReviewLibraryQuarantineRights(aiAssistant), false);
    assert.equal(canReviewLibraryQuarantineRights(inactiveRightsReviewer), false);
    assert.equal(canReviewLibraryQuarantineRights(null), false);
    assert.equal(canReviewLibraryQuarantineRights(undefined), false);

    // Verify AdminDomain reference is valid
    assert.equal(AdminDomain.Library, 'library');

    console.log(
      'PASS 1: 4-flag UI release gate and human RightsReviewer/Owner RBAC verified'
    );
  }

  // =========================================================================
  // PASS 2: Client Input Validation, Strict DTO Validators & Callable Transport
  // =========================================================================
  {
    assert.equal(deriveQuarantineCatalogDocumentId(VALID_RECEIPT_ID), VALID_DOC_ID);
    assert.throws(
      () => deriveQuarantineCatalogDocumentId('invalid-id'),
      /RIGHTS_DECISION_INVALID_RECEIPT_ID/
    );

    const getPayload = buildGetQuarantineRightsDecisionActionPayload(VALID_RECEIPT_ID);
    assert.deepEqual(getPayload, {
      action: 'getQuarantineRightsDecision',
      receiptId: VALID_RECEIPT_ID,
    });

    const savePayload = buildSaveQuarantineRightsDecisionActionPayload({
      receiptId: VALID_RECEIPT_ID,
      expectedRevision: 0,
      input: {
        decision: 'METADATA_USE_CLEARED',
        basis: 'OFFICIAL_RECORD',
        evidenceReference: '  Official Gazette #4210  ',
        evidenceNotes: '  Verified government record.\r\nMetadata only.  ',
        reviewNotes: '  Cleared for metadata cataloging only.  ',
      },
    });
    assert.deepEqual(savePayload, {
      action: 'saveQuarantineRightsDecision',
      receiptId: VALID_RECEIPT_ID,
      expectedRevision: 0,
      input: {
        decision: 'METADATA_USE_CLEARED',
        basis: 'OFFICIAL_RECORD',
        evidenceReference: 'Official Gazette #4210',
        evidenceNotes: 'Verified government record.\nMetadata only.',
        reviewNotes: 'Cleared for metadata cataloging only.',
      },
    });

    // Reject METADATA_USE_CLEARED with UNDETERMINED basis or missing evidenceReference/evidenceNotes
    assert.throws(
      () =>
        validateClientRightsDecisionInput({
          decision: 'METADATA_USE_CLEARED',
          basis: 'UNDETERMINED',
          evidenceReference: 'Ref 1',
          evidenceNotes: 'Notes 1',
          reviewNotes: 'Notes 2',
        }),
      /RIGHTS_DECISION_INVALID_INPUT/
    );
    assert.throws(
      () =>
        validateClientRightsDecisionInput({
          decision: 'METADATA_USE_CLEARED',
          basis: 'OPEN_LICENSE',
          evidenceReference: '',
          evidenceNotes: 'Notes 1',
          reviewNotes: 'Notes 2',
        }),
      /RIGHTS_DECISION_INVALID_INPUT/
    );

    // Reject RESTRICTED / NOT_PERMITTED without reviewNotes or evidenceNotes
    assert.throws(
      () =>
        validateClientRightsDecisionInput({
          decision: 'NOT_PERMITTED',
          basis: 'UNDETERMINED',
          evidenceReference: 'Ref only',
          evidenceNotes: '',
          reviewNotes: '',
        }),
      /RIGHTS_DECISION_INVALID_INPUT/
    );

    // Reject HTML tags, URLs, gs://, private paths, bidi controls, extra keys, or symbol keys
    for (const badRef of [
      '<script>alert(1)</script>',
      'https://example.com/license',
      'gs://bucket/library/quarantine/obj',
      'library/quarantine/secret.pdf',
      'Ref\u202Ewith bidi',
      'Multi\nline ref',
    ]) {
      assert.throws(
        () =>
          validateClientRightsDecisionInput({
            decision: 'EVIDENCE_PENDING',
            basis: 'UNDETERMINED',
            evidenceReference: badRef,
            evidenceNotes: 'Valid note',
            reviewNotes: '',
          }),
        /RIGHTS_DECISION_INVALID_INPUT/
      );
    }

    assert.throws(
      () =>
        validateClientRightsDecisionInput({
          decision: 'EVIDENCE_PENDING',
          basis: 'UNDETERMINED',
          evidenceReference: 'Ref 1',
          evidenceNotes: 'Note 1',
          reviewNotes: '',
          isRightsApproved: true,
        }),
      /RIGHTS_DECISION_INVALID_INPUT/
    );

    const symObj = {
      decision: 'EVIDENCE_PENDING',
      basis: 'UNDETERMINED',
      evidenceReference: 'Ref 1',
      evidenceNotes: 'Note 1',
      reviewNotes: '',
      [Symbol('secret')]: 'leak',
    };
    assert.throws(
      () => validateClientRightsDecisionInput(symObj),
      /RIGHTS_DECISION_INVALID_INPUT/
    );

    // Readiness indicators validation
    assert.deepEqual(
      validateReadinessIndicatorsDto(QUARANTINE_RIGHTS_READINESS_INDICATORS),
      QUARANTINE_RIGHTS_READINESS_INDICATORS
    );
    assert.throws(
      () =>
        validateReadinessIndicatorsDto({
          ...QUARANTINE_RIGHTS_READINESS_INDICATORS,
          publication: 'PUBLISHED',
        }),
      /RIGHTS_DECISION_DTO_CONTRACT_INVALID/
    );

    // 22-field SanitizedLibraryQuarantineRightsDecisionDto validation
    const validDto = makeSanitizedRightsDecisionDto();
    const validatedDto = validateSanitizedRightsDecisionDto(
      validDto,
      VALID_RECEIPT_ID
    );
    assert.equal(Object.keys(validatedDto).length, 22);
    assert.equal(validatedDto.isRightsApproved, false);
    assert.equal(validatedDto.isPublished, false);
    assert.equal(validatedDto.isSanitized, false);
    assert.equal(validatedDto.isVerifiedSafe, false);
    assert.equal(validatedDto.isReadyForPeia, false);

    // Reject DTO with leaked secret fields or escalated flags
    for (const forbiddenField of [
      'sourceSha256',
      'createdBy',
      'updatedBy',
      'storagePath',
      'generation',
      'signedUrl',
    ]) {
      assert.throws(
        () =>
          validateSanitizedRightsDecisionDto({
            ...validDto,
            [forbiddenField]: 'leaked-value',
          }),
        /RIGHTS_DECISION_DTO_CONTRACT_INVALID/
      );
    }
    assert.throws(
      () =>
        validateSanitizedRightsDecisionDto({
          ...validDto,
          isRightsApproved: true,
        }),
      /RIGHTS_DECISION_DTO_CONTRACT_INVALID/
    );
    assert.throws(
      () =>
        validateSanitizedRightsDecisionDto({
          ...validDto,
          catalogHandoffCaseRevision: 2,
          currentHumanCaseRevision: 3,
        }),
      /RIGHTS_DECISION_DTO_CONTRACT_INVALID/
    );

    // Client callable transport tests
    const capturedPayloads: unknown[] = [];
    const readyGetResponse: GetLibraryQuarantineRightsDecisionResponseDto = {
      ok: true,
      status: 'READY',
      receiptId: VALID_RECEIPT_ID,
      documentId: VALID_DOC_ID,
      sourceRevision: 1,
      catalogHandoffCaseRevision: 2,
      currentHumanCaseRevision: 2,
      currentRevision: 1,
      rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
      rightsDecision: validDto,
      readiness: QUARANTINE_RIGHTS_READINESS_INDICATORS,
      isSanitized: false,
      isVerifiedSafe: false,
      isRightsApproved: false,
      isPublished: false,
      isReadyForPeia: false,
    };

    const savedResponse: SaveLibraryQuarantineRightsDecisionResponseDto = {
      ok: true,
      status: 'SAVED',
      decisionSaveOutcome: 'CREATED',
      decisionSaved: true,
      receiptId: VALID_RECEIPT_ID,
      documentId: VALID_DOC_ID,
      sourceRevision: 1,
      catalogHandoffCaseRevision: 2,
      currentHumanCaseRevision: 2,
      currentRevision: 1,
      rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
      rightsDecision: validDto,
      readiness: QUARANTINE_RIGHTS_READINESS_INDICATORS,
      isSanitized: false,
      isVerifiedSafe: false,
      isRightsApproved: false,
      isPublished: false,
      isReadyForPeia: false,
    };

    const getRes =
      await LibraryQuarantineRightsDecisionClient.getQuarantineRightsDecision(
        VALID_RECEIPT_ID,
        {
          isConfigured: true,
          getAuthenticatedUid: () => 'uid-rights-reviewer',
          invokeCallable: async (payload) => {
            capturedPayloads.push(payload);
            return { data: readyGetResponse };
          },
        }
      );
    assert.equal(getRes.ok, true);

    const saveRes =
      await LibraryQuarantineRightsDecisionClient.saveQuarantineRightsDecision(
        {
          receiptId: VALID_RECEIPT_ID,
          expectedRevision: 0,
          input: {
            decision: 'METADATA_USE_CLEARED',
            basis: 'OFFICIAL_RECORD',
            evidenceReference: 'Official Gazette Issue 4210 — Record #77-2026',
            evidenceNotes:
              'Official government publication permitting descriptive bibliographic metadata cataloging.',
            reviewNotes:
              'Metadata cataloging cleared; binary PDF release remains blocked pending sanitization.',
          },
        },
        {
          isConfigured: true,
          getAuthenticatedUid: () => 'uid-rights-reviewer',
          invokeCallable: async (payload) => {
            capturedPayloads.push(payload);
            return { data: savedResponse };
          },
        }
      );
    assert.equal(saveRes.ok, true);
    assert.equal(capturedPayloads.length, 2);

    // Validate response validators on HOLD / CONFLICT / UNKNOWN
    const validatedHoldGet = validateGetQuarantineRightsDecisionResponseDto({
      ok: false,
      status: 'HOLD',
      errorCode: 'CATALOG_HANDOFF_NOT_CREATED_HOLD',
      errorMessage: 'Create internal catalog draft first.',
      receiptId: VALID_RECEIPT_ID,
      documentId: VALID_DOC_ID,
      rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
      readiness: QUARANTINE_RIGHTS_READINESS_INDICATORS,
      isSanitized: false,
      isVerifiedSafe: false,
      isRightsApproved: false,
      isPublished: false,
      isReadyForPeia: false,
    });
    assert.equal(validatedHoldGet.ok, false);
    assert.equal(validatedHoldGet.status, 'HOLD');

    const validatedUnknownSave =
      validateSaveQuarantineRightsDecisionResponseDto({
        ok: false,
        status: 'UNKNOWN',
        decisionSaveOutcome: 'UNKNOWN',
        decisionSaved: null,
        errorCode: 'TRANSACTION_COMMIT_UNCERTAIN',
        errorMessage: 'Commit outcome uncertain.',
        receiptId: VALID_RECEIPT_ID,
        documentId: VALID_DOC_ID,
        rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
        readiness: QUARANTINE_RIGHTS_READINESS_INDICATORS,
        isSanitized: false,
        isVerifiedSafe: false,
        isRightsApproved: false,
        isPublished: false,
        isReadyForPeia: false,
      });
    assert.equal(validatedUnknownSave.ok, false);
    assert.equal(validatedUnknownSave.status, 'UNKNOWN');
    assert.equal(validatedUnknownSave.decisionSaved, null);

    console.log(
      'PASS 2: Client input validation, 22-field DTO validators, and callable transport verified'
    );
  }

  // =========================================================================
  // PASS 3: Inline Rendering in LibraryQuarantineHumanReviewModal (AR/EN),
  //         RightsReviewer Independence, Prerequisite Notice, Drift Hold,
  //         Constant Readiness Indicators & Zero AI/Curator Prefill
  // =========================================================================
  {
    const rightsReviewer = makeAdminUser(AdminRole.RightsReviewer);
    const libraryCurator = makeAdminUser(AdminRole.LibraryCurator);
    const savedMetadataCase = makeSavedHumanReviewCase();
    const inReviewCase = makeSavedHumanReviewCase({ status: 'IN_REVIEW' });

    assert.equal(isSavedHumanCaseEligibleForRightsPanel(savedMetadataCase), true);
    assert.equal(isSavedHumanCaseEligibleForRightsPanel(inReviewCase), false);
    assert.equal(
      createEmptyRightsDecisionForm().evidenceNotes,
      '',
      'Empty rights decision form must never prefill from human case or AI'
    );

    // 3A. RightsReviewer opens human review modal on METADATA_RECORDED case:
    // CatalogHandoffPanel is hidden (RightsReviewer lacks Create),
    // RightsDecisionPanel IS visible (RightsReviewer has Review + ManageRights)!
    const modalCtrl = new LibraryQuarantineHumanReviewModalController(
      rightsReviewer,
      {
        humanReviewEnabled: true,
        getCaseFn: async () => ({
          ok: true,
          status: 'READY',
          receiptId: VALID_RECEIPT_ID,
          sourceRevision: 1,
          currentRevision: 2,
          draftStatus: 'PENDING_HUMAN_REVIEW' as const,
          adminReceipt: makeSanitizedReceipt(),
          reviewCase: savedMetadataCase,
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
        }),
      }
    );
    await modalCtrl.openCase(makeSanitizedReceipt(), 1);

    const handoffCtrl = new LibraryQuarantineCatalogHandoffPanelController(
      rightsReviewer,
      {
        catalogHandoffEnabled: true,
      }
    );

    // Sub-case 3A-1: Catalog handoff not yet created (CATALOG_HANDOFF_NOT_CREATED_HOLD)
    const rightsCtrlNoHandoff =
      new LibraryQuarantineRightsDecisionPanelController(rightsReviewer, {
        rightsDecisionEnabled: true,
        getDecisionFn: async () => ({
          ok: false,
          status: 'HOLD',
          errorCode: 'CATALOG_HANDOFF_NOT_CREATED_HOLD',
          errorMessage:
            'Catalog handoff record and qcat- draft must be created before recording a rights decision.',
          receiptId: VALID_RECEIPT_ID,
          documentId: VALID_DOC_ID,
          rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
          readiness: QUARANTINE_RIGHTS_READINESS_INDICATORS,
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
        }),
      });
    await rightsCtrlNoHandoff.openPanelForCase(savedMetadataCase);

    const arNoHandoffMarkup = renderToStaticMarkup(
      React.createElement(LibraryQuarantineHumanReviewModal, {
        controller: modalCtrl,
        isAr: true,
        currentUser: rightsReviewer,
        catalogHandoffController: handoffCtrl,
        rightsDecisionController: rightsCtrlNoHandoff,
      })
    );

    // Verify CatalogHandoffPanel is NOT rendered for RightsReviewer, while RightsDecisionPanel IS rendered
    assert.equal(
      arNoHandoffMarkup.includes('data-testid="quarantine-catalog-handoff-panel"'),
      false,
      'CatalogHandoffPanel must be hidden for RightsReviewer who lacks Create'
    );
    assert.equal(
      arNoHandoffMarkup.includes('data-testid="quarantine-rights-decision-panel"'),
      true,
      'RightsDecisionPanel must render inline for RightsReviewer inside HumanReviewModal'
    );
    assert.equal(
      arNoHandoffMarkup.includes(
        'data-testid="quarantine-rights-handoff-prerequisite-notice"'
      ),
      true,
      'Prerequisite notice must appear when catalog handoff is not yet created'
    );
    assert.equal(
      arNoHandoffMarkup.includes('أنشئ مسودة المكتبة أولًا بواسطة المحرر المخوّل'),
      true,
      'Arabic prerequisite message must match specification'
    );
    assert.equal(
      arNoHandoffMarkup.includes('data-testid="quarantine-rights-decision-form"'),
      false,
      'Editable rights form must NOT render when held by CATALOG_HANDOFF_NOT_CREATED_HOLD'
    );
    assertMarkupZeroSecretLeakage(arNoHandoffMarkup);

    // Sub-case 3B: Version drift hold (SOURCE_CASE_VERSION_DRIFT_HOLD)
    const rightsCtrlDrift = new LibraryQuarantineRightsDecisionPanelController(
      rightsReviewer,
      {
        rightsDecisionEnabled: true,
        getDecisionFn: async () => ({
          ok: false,
          status: 'HOLD',
          errorCode: 'SOURCE_CASE_VERSION_DRIFT_HOLD',
          errorMessage:
            'Human review case revision has drifted from catalog handoff case revision.',
          receiptId: VALID_RECEIPT_ID,
          documentId: VALID_DOC_ID,
          rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
          readiness: QUARANTINE_RIGHTS_READINESS_INDICATORS,
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
        }),
      }
    );
    await rightsCtrlDrift.openPanelForCase(savedMetadataCase);

    const enDriftMarkup = renderToStaticMarkup(
      React.createElement(LibraryQuarantineRightsDecisionPanel, {
        controller: rightsCtrlDrift,
        currentUser: rightsReviewer,
        savedReviewCase: savedMetadataCase,
        hasUnsavedCaseEdits: false,
        isAr: false,
      })
    );
    assert.equal(
      enDriftMarkup.includes(
        'data-testid="quarantine-rights-version-drift-hold-banner"'
      ),
      true
    );
    assert.equal(
      enDriftMarkup.includes('SOURCE_CASE_VERSION_DRIFT_HOLD'),
      true
    );
    assert.equal(
      enDriftMarkup.includes('data-testid="quarantine-rights-decision-form"'),
      false
    );
    assertMarkupZeroSecretLeakage(enDriftMarkup);

    // Sub-case 3C: READY with no existing decision -> form opens with clean defaults (NOT prefilled from rightsEvidenceNotes)
    const rightsCtrlReadyEmpty =
      new LibraryQuarantineRightsDecisionPanelController(rightsReviewer, {
        rightsDecisionEnabled: true,
        getDecisionFn: async () => ({
          ok: true,
          status: 'READY',
          receiptId: VALID_RECEIPT_ID,
          documentId: VALID_DOC_ID,
          sourceRevision: 1,
          catalogHandoffCaseRevision: 2,
          currentHumanCaseRevision: 2,
          currentRevision: 0,
          rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
          rightsDecision: null,
          readiness: QUARANTINE_RIGHTS_READINESS_INDICATORS,
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
        }),
      });
    await rightsCtrlReadyEmpty.openPanelForCase(savedMetadataCase);

    const snapEmpty = rightsCtrlReadyEmpty.getSnapshot();
    assert.equal(snapEmpty.form.decision, 'EVIDENCE_PENDING');
    assert.equal(snapEmpty.form.basis, 'UNDETERMINED');
    assert.equal(snapEmpty.form.evidenceReference, '');
    assert.equal(snapEmpty.form.evidenceNotes, '');
    assert.equal(snapEmpty.form.reviewNotes, '');

    const arReadyMarkup = renderToStaticMarkup(
      React.createElement(LibraryQuarantineRightsDecisionPanel, {
        controller: rightsCtrlReadyEmpty,
        currentUser: rightsReviewer,
        savedReviewCase: savedMetadataCase,
        hasUnsavedCaseEdits: false,
        isAr: true,
      })
    );
    assert.equal(arReadyMarkup.includes('dir="rtl"'), true);
    assert.equal(
      arReadyMarkup.includes('data-testid="quarantine-rights-decision-form"'),
      true
    );
    assert.equal(
      arReadyMarkup.includes(
        'data-testid="quarantine-rights-readiness-indicators"'
      ),
      true
    );
    assert.equal(arReadyMarkup.includes('NOT_VERIFIED'), true);
    assert.equal(arReadyMarkup.includes('NOT_PERFORMED'), true);
    assert.equal(arReadyMarkup.includes('BLOCKED'), true);
    assert.equal(arReadyMarkup.includes('CATALOG_METADATA_ONLY'), true);
    assert.equal(
      arReadyMarkup.includes(savedMetadataCase.rightsEvidenceNotes),
      false,
      'Preliminary curator rightsEvidenceNotes must never prefill the rights decision form'
    );
    assertMarkupZeroSecretLeakage(arReadyMarkup);

    // Sub-case 3D: LibraryCurator without ManageRights -> RightsDecisionPanel returns null
    const curatorMarkup = renderToStaticMarkup(
      React.createElement(LibraryQuarantineRightsDecisionPanel, {
        controller: rightsCtrlReadyEmpty,
        currentUser: libraryCurator,
        savedReviewCase: savedMetadataCase,
        hasUnsavedCaseEdits: false,
        isAr: true,
      })
    );
    assert.equal(curatorMarkup, '');

    console.log(
      'PASS 3: Inline rendering in AR/EN, RightsReviewer independence, prerequisite notice, drift hold, constant readiness indicators, and zero prefill verified'
    );
  }

  // =========================================================================
  // PASS 4: Save Lifecycle (0 -> 1 -> 2), Fresh Readback After Save,
  //         Duplicate-Click Lock & Stale Async Isolation
  // =========================================================================
  {
    const rightsReviewer = makeAdminUser(AdminRole.RightsReviewer);
    const savedMetadataCase = makeSavedHumanReviewCase();

    let serverStoredDecision: SanitizedLibraryQuarantineRightsDecisionDto | null =
      null;
    let getCallCount = 0;
    let saveCallCount = 0;
    const savedCallbackRecords: SanitizedLibraryQuarantineRightsDecisionDto[] = [];

    const controller = new LibraryQuarantineRightsDecisionPanelController(
      rightsReviewer,
      {
        rightsDecisionEnabled: true,
        onDecisionSaved: (d) => savedCallbackRecords.push(d),
        getDecisionFn: async (receiptId) => {
          getCallCount += 1;
          return {
            ok: true,
            status: 'READY',
            receiptId,
            documentId: deriveQuarantineCatalogDocumentId(receiptId),
            sourceRevision: 1,
            catalogHandoffCaseRevision: 2,
            currentHumanCaseRevision: 2,
            currentRevision: serverStoredDecision?.revision ?? 0,
            rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
            rightsDecision: serverStoredDecision,
            readiness: QUARANTINE_RIGHTS_READINESS_INDICATORS,
            isSanitized: false,
            isVerifiedSafe: false,
            isRightsApproved: false,
            isPublished: false,
            isReadyForPeia: false,
          };
        },
        saveDecisionFn: async ({ receiptId, expectedRevision, input }) => {
          saveCallCount += 1;
          const nextRev = expectedRevision + 1;
          const outcome = expectedRevision === 0 ? 'CREATED' : 'UPDATED';
          serverStoredDecision = makeSanitizedRightsDecisionDto({
            receiptId,
            documentId: deriveQuarantineCatalogDocumentId(receiptId),
            revision: nextRev,
            decision: input.decision,
            basis: input.basis,
            evidenceReference: input.evidenceReference ?? '',
            evidenceNotes: input.evidenceNotes ?? '',
            reviewNotes: input.reviewNotes ?? '',
          });
          return {
            ok: true,
            status: 'SAVED',
            decisionSaveOutcome: outcome,
            decisionSaved: true,
            receiptId,
            documentId: deriveQuarantineCatalogDocumentId(receiptId),
            sourceRevision: 1,
            catalogHandoffCaseRevision: 2,
            currentHumanCaseRevision: 2,
            currentRevision: nextRev,
            rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
            rightsDecision: serverStoredDecision,
            readiness: QUARANTINE_RIGHTS_READINESS_INDICATORS,
            isSanitized: false,
            isVerifiedSafe: false,
            isRightsApproved: false,
            isPublished: false,
            isReadyForPeia: false,
          };
        },
      }
    );

    // Open panel -> revision 0
    await controller.openPanelForCase(savedMetadataCase);
    assert.equal(getCallCount, 1);
    assert.equal(controller.getSnapshot().currentRevision, 0);

    // Save 1 (0 -> 1): EVIDENCE_PENDING -> CREATED + fresh readback
    controller.updateFormField('decision', 'EVIDENCE_PENDING');
    controller.updateFormField('basis', 'UNDETERMINED');
    controller.updateFormField(
      'evidenceNotes',
      'Requested certified publication record from archiving unit.'
    );

    const save1Res = await controller.saveDecision();
    assert.equal(save1Res?.ok, true);
    assert.equal(saveCallCount, 1);
    assert.equal(getCallCount, 2, 'Must perform fresh server readback after save');
    assert.equal(controller.getSnapshot().currentRevision, 1);
    assert.equal(controller.getSnapshot().lastSaveOutcome, 'CREATED');

    // Save 2 (1 -> 2): METADATA_USE_CLEARED -> UPDATED + fresh readback
    controller.updateFormField('decision', 'METADATA_USE_CLEARED');
    controller.updateFormField('basis', 'OFFICIAL_RECORD');
    controller.updateFormField(
      'evidenceReference',
      'Official Gazette Issue 4210 — Record #77-2026'
    );
    controller.updateFormField(
      'evidenceNotes',
      'Verified official record; descriptive metadata cataloging cleared.'
    );
    controller.updateFormField(
      'reviewNotes',
      'Binary PDF publication remains BLOCKED pending isolated sanitization.'
    );

    const save2Res = await controller.saveDecision();
    assert.equal(save2Res?.ok, true);
    assert.equal(saveCallCount, 2);
    assert.equal(getCallCount, 3, 'Must perform fresh server readback after 2nd save');
    assert.equal(controller.getSnapshot().currentRevision, 2);
    assert.equal(controller.getSnapshot().lastSaveOutcome, 'UPDATED');
    assert.equal(
      controller.getSnapshot().rightsDecision?.decision,
      'METADATA_USE_CLEARED'
    );
    // Readiness indicators MUST remain NOT_VERIFIED / NOT_PERFORMED / BLOCKED / Draft
    assert.deepEqual(
      controller.getSnapshot().readiness,
      QUARANTINE_RIGHTS_READINESS_INDICATORS
    );
    assert.equal(savedCallbackRecords.length, 2);

    // Verify rendered markup after METADATA_USE_CLEARED still shows BLOCKED and NOT_VERIFIED
    const clearedMarkup = renderToStaticMarkup(
      React.createElement(LibraryQuarantineRightsDecisionPanel, {
        controller,
        currentUser: rightsReviewer,
        savedReviewCase: savedMetadataCase,
        hasUnsavedCaseEdits: false,
        isAr: false,
      })
    );
    assert.equal(
      clearedMarkup.includes('data-testid="quarantine-rights-decision-saved-banner"'),
      true
    );
    assert.equal(clearedMarkup.includes('METADATA_USE_CLEARED'), true);
    assert.equal(clearedMarkup.includes('NOT_VERIFIED'), true);
    assert.equal(clearedMarkup.includes('BLOCKED'), true);
    assertMarkupZeroSecretLeakage(clearedMarkup);

    // Duplicate-click lock test: while save is in flight, second saveDecision() is ignored
    let resolveInFlightSave!: (
      value: SaveLibraryQuarantineRightsDecisionResponseDto
    ) => void;
    let inFlightSaveCalls = 0;

    controller.setOptions({
      saveDecisionFn: ({ receiptId, expectedRevision }) => {
        inFlightSaveCalls += 1;
        return new Promise<SaveLibraryQuarantineRightsDecisionResponseDto>(
          (resolve) => {
            resolveInFlightSave = () =>
              resolve({
                ok: true,
                status: 'SAVED',
                decisionSaveOutcome: 'UPDATED',
                decisionSaved: true,
                receiptId,
                documentId: deriveQuarantineCatalogDocumentId(receiptId),
                sourceRevision: 1,
                catalogHandoffCaseRevision: 2,
                currentHumanCaseRevision: 2,
                currentRevision: expectedRevision + 1,
                rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
                rightsDecision: makeSanitizedRightsDecisionDto({
                  revision: expectedRevision + 1,
                }),
                readiness: QUARANTINE_RIGHTS_READINESS_INDICATORS,
                isSanitized: false,
                isVerifiedSafe: false,
                isRightsApproved: false,
                isPublished: false,
                isReadyForPeia: false,
              });
          }
        );
      },
    });

    controller.updateFormField('reviewNotes', 'Updated restriction note.');
    const firstClickPromise = controller.saveDecision();
    assert.equal(controller.getSnapshot().saving, true);
    const secondClickResult = await controller.saveDecision();
    assert.equal(secondClickResult, null);
    assert.equal(
      inFlightSaveCalls,
      1,
      'Duplicate save click while saving must not invoke saveDecisionFn a second time'
    );
    resolveInFlightSave(null as never);
    await firstClickPromise;

    // Stale async response isolation across receipt switch
    let resolveStaleLoad!: (
      value: GetLibraryQuarantineRightsDecisionResponseDto
    ) => void;
    const staleController = new LibraryQuarantineRightsDecisionPanelController(
      rightsReviewer,
      {
        rightsDecisionEnabled: true,
        getDecisionFn: (receiptId) => {
          if (receiptId === VALID_RECEIPT_ID) {
            return new Promise<GetLibraryQuarantineRightsDecisionResponseDto>(
              (resolve) => {
                resolveStaleLoad = resolve;
              }
            );
          }
          return Promise.resolve({
            ok: true,
            status: 'READY',
            receiptId: OTHER_RECEIPT_ID,
            documentId: deriveQuarantineCatalogDocumentId(OTHER_RECEIPT_ID),
            sourceRevision: 1,
            catalogHandoffCaseRevision: 1,
            currentHumanCaseRevision: 1,
            currentRevision: 1,
            rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
            rightsDecision: makeSanitizedRightsDecisionDto({
              receiptId: OTHER_RECEIPT_ID,
              documentId: deriveQuarantineCatalogDocumentId(OTHER_RECEIPT_ID),
              revision: 1,
              catalogHandoffCaseRevision: 1,
              currentHumanCaseRevision: 1,
              decision: 'RESTRICTED',
              basis: 'INTERNAL_ONLY',
            }),
            readiness: QUARANTINE_RIGHTS_READINESS_INDICATORS,
            isSanitized: false,
            isVerifiedSafe: false,
            isRightsApproved: false,
            isPublished: false,
            isReadyForPeia: false,
          });
        },
      }
    );

    const stalePromise = staleController.openPanelForCase(savedMetadataCase);
    const secondCase = makeSavedHumanReviewCase({
      receiptId: OTHER_RECEIPT_ID,
      revision: 1,
    });
    await staleController.openPanelForCase(secondCase);

    // Now resolve the stale first receipt load
    resolveStaleLoad({
      ok: true,
      status: 'READY',
      receiptId: VALID_RECEIPT_ID,
      documentId: VALID_DOC_ID,
      sourceRevision: 1,
      catalogHandoffCaseRevision: 2,
      currentHumanCaseRevision: 2,
      currentRevision: 5,
      rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
      rightsDecision: makeSanitizedRightsDecisionDto({ revision: 5 }),
      readiness: QUARANTINE_RIGHTS_READINESS_INDICATORS,
      isSanitized: false,
      isVerifiedSafe: false,
      isRightsApproved: false,
      isPublished: false,
      isReadyForPeia: false,
    });
    const staleResult = await stalePromise;
    assert.equal(staleResult, null);
    assert.equal(staleController.getSnapshot().receiptId, OTHER_RECEIPT_ID);
    assert.equal(staleController.getSnapshot().currentRevision, 1);
    assert.equal(
      staleController.getSnapshot().rightsDecision?.decision,
      'RESTRICTED'
    );

    console.log(
      'PASS 4: Save lifecycle (0 -> 1 -> 2), fresh readback, duplicate-click lock, and stale async isolation verified'
    );
  }

  // =========================================================================
  // PASS 5: CAS CONFLICT Banner + Resolution & UNKNOWN (decisionSaved: null)
  //         Verify-Only Flow (Zero Auto-Retry)
  // =========================================================================
  {
    const rightsReviewer = makeAdminUser(AdminRole.RightsReviewer);
    const savedMetadataCase = makeSavedHumanReviewCase();

    const serverLatestDecision = makeSanitizedRightsDecisionDto({
      revision: 3,
      decision: 'RESTRICTED',
      basis: 'INTERNAL_ONLY',
      evidenceReference: 'Internal Audit Memo #99',
      evidenceNotes: 'Restricted to internal catalog reference.',
      reviewNotes: 'Concurrent reviewer updated revision 3.',
    });

    let getCalls = 0;
    let saveCalls = 0;

    const conflictAndUnknownController =
      new LibraryQuarantineRightsDecisionPanelController(rightsReviewer, {
        rightsDecisionEnabled: true,
        getDecisionFn: async () => {
          getCalls += 1;
          return {
            ok: true,
            status: 'READY',
            receiptId: VALID_RECEIPT_ID,
            documentId: VALID_DOC_ID,
            sourceRevision: 1,
            catalogHandoffCaseRevision: 2,
            currentHumanCaseRevision: 2,
            currentRevision: getCalls === 1 ? 1 : 3,
            rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
            rightsDecision:
              getCalls === 1
                ? makeSanitizedRightsDecisionDto({ revision: 1 })
                : serverLatestDecision,
            readiness: QUARANTINE_RIGHTS_READINESS_INDICATORS,
            isSanitized: false,
            isVerifiedSafe: false,
            isRightsApproved: false,
            isPublished: false,
            isReadyForPeia: false,
          };
        },
        saveDecisionFn: async () => {
          saveCalls += 1;
          if (saveCalls === 1) {
            return {
              ok: false,
              status: 'CONFLICT',
              decisionSaveOutcome: 'NOT_SAVED',
              decisionSaved: false,
              errorCode: 'RIGHTS_DECISION_REVISION_CONFLICT',
              errorMessage: 'Expected revision 1 but server is at revision 3.',
              receiptId: VALID_RECEIPT_ID,
              documentId: VALID_DOC_ID,
              currentRevision: 3,
              currentDecision: serverLatestDecision,
              rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
              readiness: QUARANTINE_RIGHTS_READINESS_INDICATORS,
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
            decisionSaveOutcome: 'UNKNOWN',
            decisionSaved: null,
            errorCode: 'TRANSACTION_COMMIT_UNCERTAIN',
            errorMessage: 'Transaction commit outcome is uncertain.',
            receiptId: VALID_RECEIPT_ID,
            documentId: VALID_DOC_ID,
            rightsScope: LIBRARY_QUARANTINE_RIGHTS_SCOPE,
            readiness: QUARANTINE_RIGHTS_READINESS_INDICATORS,
            isSanitized: false,
            isVerifiedSafe: false,
            isRightsApproved: false,
            isPublished: false,
            isReadyForPeia: false,
          };
        },
      });

    await conflictAndUnknownController.openPanelForCase(savedMetadataCase);
    assert.equal(getCalls, 1);

    // 5A. Trigger CONFLICT
    const conflictRes = await conflictAndUnknownController.saveDecision();
    assert.equal(conflictRes?.status, 'CONFLICT');
    assert.equal(saveCalls, 1);
    assert.notEqual(
      conflictAndUnknownController.getSnapshot().conflictState,
      null
    );

    const conflictMarkup = renderToStaticMarkup(
      React.createElement(LibraryQuarantineRightsDecisionPanel, {
        controller: conflictAndUnknownController,
        currentUser: rightsReviewer,
        savedReviewCase: savedMetadataCase,
        hasUnsavedCaseEdits: false,
        isAr: true,
      })
    );
    assert.equal(
      conflictMarkup.includes(
        'data-testid="quarantine-rights-decision-conflict-banner"'
      ),
      true
    );
    assert.equal(
      conflictMarkup.includes('data-testid="apply-conflict-rights-decision-btn"'),
      true
    );

    // Apply server version from conflict
    conflictAndUnknownController.applyConflictServerVersion();
    assert.equal(conflictAndUnknownController.getSnapshot().conflictState, null);
    assert.equal(conflictAndUnknownController.getSnapshot().currentRevision, 3);
    assert.equal(
      conflictAndUnknownController.getSnapshot().form.decision,
      'RESTRICTED'
    );

    // 5B. Trigger UNKNOWN (decisionSaved: null)
    const unknownRes = await conflictAndUnknownController.saveDecision();
    assert.equal(unknownRes?.status, 'UNKNOWN');
    assert.equal(unknownRes?.decisionSaved, null);
    assert.equal(saveCalls, 2, 'UNKNOWN must never trigger automatic save retry');
    assert.notEqual(
      conflictAndUnknownController.getSnapshot().uncertainState,
      null
    );

    // Attempting another save while uncertainState !== null is blocked (0 extra save calls)
    const blockedSaveWhileUncertain =
      await conflictAndUnknownController.saveDecision();
    assert.equal(blockedSaveWhileUncertain, null);
    assert.equal(saveCalls, 2);

    const unknownMarkup = renderToStaticMarkup(
      React.createElement(LibraryQuarantineRightsDecisionPanel, {
        controller: conflictAndUnknownController,
        currentUser: rightsReviewer,
        savedReviewCase: savedMetadataCase,
        hasUnsavedCaseEdits: false,
        isAr: true,
      })
    );
    assert.equal(
      unknownMarkup.includes(
        'data-testid="quarantine-rights-decision-uncertain-banner"'
      ),
      true
    );
    assert.equal(
      unknownMarkup.includes('data-testid="verify-quarantine-rights-decision-btn"'),
      true
    );
    assert.equal(unknownMarkup.includes('تحقق من القرار'), true);

    // Verify-only button calls getQuarantineRightsDecision ONLY (never save)
    await conflictAndUnknownController.verifyDecisionStatus();
    assert.equal(getCalls, 2, 'verifyDecisionStatus must call getDecisionFn');
    assert.equal(saveCalls, 2, 'verifyDecisionStatus must never call saveDecisionFn');
    assert.equal(conflictAndUnknownController.getSnapshot().uncertainState, null);
    assert.equal(conflictAndUnknownController.getSnapshot().currentRevision, 3);

    console.log(
      'PASS 5: CAS CONFLICT resolution and UNKNOWN (decisionSaved: null) verify-only recovery verified'
    );
  }

  // =========================================================================
  // PASS 6: Disabled Release Flags Fallback (Zero Rights Decision Calls)
  // =========================================================================
  {
    const owner = makeAdminUser(AdminRole.Owner);
    const savedMetadataCase = makeSavedHumanReviewCase();
    let getCallsWhenDisabled = 0;
    let saveCallsWhenDisabled = 0;

    const disabledController = new LibraryQuarantineRightsDecisionPanelController(
      owner,
      {
        rightsDecisionEnabled: false,
        getDecisionFn: async () => {
          getCallsWhenDisabled += 1;
          throw new Error('Should not be called when disabled');
        },
        saveDecisionFn: async () => {
          saveCallsWhenDisabled += 1;
          throw new Error('Should not be called when disabled');
        },
      }
    );

    const openRes = await disabledController.openPanelForCase(savedMetadataCase);
    assert.equal(openRes, null);
    const saveRes = await disabledController.saveDecision();
    assert.equal(saveRes, null);
    assert.equal(getCallsWhenDisabled, 0);
    assert.equal(saveCallsWhenDisabled, 0);

    const disabledMarkup = renderToStaticMarkup(
      React.createElement(LibraryQuarantineRightsDecisionPanel, {
        controller: disabledController,
        currentUser: owner,
        savedReviewCase: savedMetadataCase,
        hasUnsavedCaseEdits: false,
        isAr: true,
      })
    );
    assert.equal(disabledMarkup, '');

    // Verify exported enum arrays match expected lengths
    assert.equal(LIBRARY_QUARANTINE_RIGHTS_DECISION_STATUSES.length, 5);
    assert.equal(LIBRARY_QUARANTINE_RIGHTS_BASES.length, 6);
    assert.equal(
      typeof RIGHTS_DECISION_CLIENT_SAFE_ERRORS.FEATURE_NOT_RELEASED,
      'string'
    );

    console.log(
      'PASS 6: Disabled release flags fallback (zero get/save calls and empty markup) verified'
    );
  }

  console.log(
    '\nALL LIB-FILE-RIGHTS-AND-READINESS-01 CLIENT & UI TESTS PASSED.'
  );
}

runTests().catch((err: unknown) => {
  console.error('LIB-FILE-RIGHTS-AND-READINESS-01 client test failure:', err);
  throw err;
});
