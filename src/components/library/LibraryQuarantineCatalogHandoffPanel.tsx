import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  FileText,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type { AdminUser } from '../../types/admin';
import {
  LibraryDocumentType,
  type LibraryOrganization,
  type LibrarySource,
} from '../../types/library';
import type { SanitizedLibraryQuarantineHumanReviewCaseDto } from '../../services/libraryQuarantineHumanReviewClient';
import {
  CATALOG_HANDOFF_CLIENT_SAFE_ERRORS,
  CATALOG_HANDOFF_GEOGRAPHY_MAX_LENGTH,
  CATALOG_HANDOFF_LEGAL_STATUS_MAX_LENGTH,
  CATALOG_HANDOFF_SUMMARY_MAX_LENGTH,
  CATALOG_HANDOFF_TITLE_MAX_LENGTH,
  LibraryQuarantineCatalogHandoffClient,
  canCreateLibraryQuarantineCatalogDraft,
  deriveQuarantineCatalogDocumentId,
  isCatalogHandoffNotReleasedError,
  isHumanReviewCaseEligibleForCatalogHandoff,
  isLibraryQuarantineCatalogHandoffEnabled,
  validateClientCatalogDraftClassificationInput,
  type CreateLibraryQuarantineCatalogDraftClassificationInput,
  type CreateLibraryQuarantineCatalogDraftResponseDto,
  type GetLibraryQuarantineCatalogHandoffResponseDto,
  type SanitizedLibraryQuarantineCatalogDocumentDto,
  type SanitizedLibraryQuarantineCatalogHandoffDto,
} from '../../services/libraryQuarantineCatalogHandoffClient';

/**
 * LIB-FILE-CATALOG-HANDOFF-01 — Inline Catalog Draft Handoff Panel & Controller
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Renders inline inside `LibraryQuarantineHumanReviewModal` (no nested modal/dialog).
 * - Exposes a single primary CTA («نقل إلى مسودة المكتبة» / «Prepare library draft»)
 *   ONLY when:
 *   1. All three UI flags (`VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED`,
 *      `VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED`, `VITE_LIBRARY_CATALOG_HANDOFF_ENABLED`)
 *      are `'true'`.
 *   2. Current admin user has BOTH `AdminPermission.Review` AND `AdminPermission.Create`.
 *   3. Saved human review case has `status === 'METADATA_RECORDED'` and no unsaved
 *      edits in the human review form.
 * - Prefills ONLY `titleAr`, `titleEn`, `summaryAr`, and `summaryEn` from the saved
 *   human review case; never fabricates classification, organization, source, geography,
 *   publication date, topics, environmental domains, or legal status descriptions.
 * - Filters `sources` to those belonging to the selected `organizationId` with
 *   `verificationStatus === 'Verified'`.
 * - Enforces duplicate-submit lock, CAS (`expectedCaseRevision`), conflict banner,
 *   and fail-closed commit uncertainty hold (`UNKNOWN` / `documentCreated: null`)
 *   with a verify-only action («تحقق من المسودة» / «Verify draft») that calls
 *   `getQuarantineCatalogHandoff` and never auto-retries creation.
 */

export interface LibraryQuarantineCatalogHandoffFormValues {
  readonly titleAr: string;
  readonly titleEn: string;
  readonly originalTitle: string;
  readonly summaryAr: string;
  readonly summaryEn: string;
  readonly documentType: LibraryDocumentType | '';
  readonly organizationId: string;
  readonly sourceId: string;
  readonly geographyAr: string;
  readonly geographyEn: string;
  readonly publicationDate: string;
  readonly language: 'ar' | 'en' | 'bilingual' | 'other' | '';
  readonly topicsArText: string;
  readonly topicsEnText: string;
  readonly environmentalDomainsText: string;
  readonly legalStatusDescriptionAr: string;
  readonly legalStatusDescriptionEn: string;
}

export interface LibraryQuarantineCatalogHandoffConflictState {
  readonly errorCode:
    | 'CASE_REVISION_CONFLICT'
    | 'HANDOFF_ALREADY_EXISTS_CONFLICT';
  readonly errorMessage: string;
  readonly currentCaseRevision: number;
  readonly existingHandoff: SanitizedLibraryQuarantineCatalogHandoffDto | null;
  readonly catalogDocument: SanitizedLibraryQuarantineCatalogDocumentDto | null;
}

export interface LibraryQuarantineCatalogHandoffUncertainState {
  readonly errorCode: 'TRANSACTION_COMMIT_UNCERTAIN';
  readonly errorMessage: string;
  readonly documentCreationOutcome: 'UNKNOWN';
  readonly documentCreated: null;
}

export interface LibraryQuarantineCatalogHandoffPanelSnapshot {
  readonly isExpanded: boolean;
  readonly catalogHandoffEnabled: boolean;
  readonly receiptId: string | null;
  readonly documentId: string | null;
  readonly expectedCaseRevision: number;
  readonly handoffExists: boolean;
  readonly handoff: SanitizedLibraryQuarantineCatalogHandoffDto | null;
  readonly catalogDocument: SanitizedLibraryQuarantineCatalogDocumentDto | null;
  readonly form: LibraryQuarantineCatalogHandoffFormValues;
  readonly loadingStatus: boolean;
  readonly submitting: boolean;
  readonly statusError: string | null;
  readonly submitError: string | null;
  readonly lastDisposition: 'CREATED' | 'IDEMPOTENT_EXISTING' | null;
  readonly conflictState: LibraryQuarantineCatalogHandoffConflictState | null;
  readonly uncertainState: LibraryQuarantineCatalogHandoffUncertainState | null;
  readonly sessionToken: number;
}

export function createPrefilledCatalogHandoffForm(
  reviewCase: SanitizedLibraryQuarantineHumanReviewCaseDto | null
): LibraryQuarantineCatalogHandoffFormValues {
  return Object.freeze({
    titleAr: reviewCase?.titleAr ?? '',
    titleEn: reviewCase?.titleEn ?? '',
    originalTitle: '',
    summaryAr: reviewCase?.summaryAr ?? '',
    summaryEn: reviewCase?.summaryEn ?? '',
    documentType: '',
    organizationId: '',
    sourceId: '',
    geographyAr: '',
    geographyEn: '',
    publicationDate: '',
    language: '',
    topicsArText: '',
    topicsEnText: '',
    environmentalDomainsText: '',
    legalStatusDescriptionAr: '',
    legalStatusDescriptionEn: '',
  });
}

function splitCommaSeparatedTags(raw: string): readonly string[] {
  return Object.freeze(
    raw
      .split(/[,،]/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  );
}

export interface LibraryQuarantineCatalogHandoffControllerOptions {
  readonly catalogHandoffEnabled?: boolean;
  readonly getHandoffFn?: (
    receiptId: string
  ) => Promise<GetLibraryQuarantineCatalogHandoffResponseDto>;
  readonly createDraftFn?: (params: {
    readonly receiptId: string;
    readonly expectedCaseRevision: number;
    readonly input: CreateLibraryQuarantineCatalogDraftClassificationInput;
  }) => Promise<CreateLibraryQuarantineCatalogDraftResponseDto>;
  readonly onCatalogDraftReady?: (
    catalogDocument: SanitizedLibraryQuarantineCatalogDocumentDto
  ) => void;
}

export class LibraryQuarantineCatalogHandoffPanelController {
  private currentUser: AdminUser | null;
  private getHandoffFn: (
    receiptId: string
  ) => Promise<GetLibraryQuarantineCatalogHandoffResponseDto>;
  private createDraftFn: (params: {
    readonly receiptId: string;
    readonly expectedCaseRevision: number;
    readonly input: CreateLibraryQuarantineCatalogDraftClassificationInput;
  }) => Promise<CreateLibraryQuarantineCatalogDraftResponseDto>;
  private onCatalogDraftReady?: (
    catalogDocument: SanitizedLibraryQuarantineCatalogDocumentDto
  ) => void;
  private state: LibraryQuarantineCatalogHandoffPanelSnapshot;
  private readonly listeners = new Set<
    (snapshot: LibraryQuarantineCatalogHandoffPanelSnapshot) => void
  >();

  constructor(
    currentUser: AdminUser | null,
    options?: LibraryQuarantineCatalogHandoffControllerOptions
  ) {
    this.currentUser = currentUser;
    this.getHandoffFn =
      options?.getHandoffFn ??
      ((receiptId) =>
        LibraryQuarantineCatalogHandoffClient.getQuarantineCatalogHandoff(
          receiptId
        ));
    this.createDraftFn =
      options?.createDraftFn ??
      ((params) =>
        LibraryQuarantineCatalogHandoffClient.createQuarantineCatalogDraft(
          params
        ));
    this.onCatalogDraftReady = options?.onCatalogDraftReady;

    const resolvedEnabled =
      options?.catalogHandoffEnabled !== undefined
        ? options.catalogHandoffEnabled === true
        : isLibraryQuarantineCatalogHandoffEnabled();

    this.state = Object.freeze({
      isExpanded: false,
      catalogHandoffEnabled: resolvedEnabled,
      receiptId: null,
      documentId: null,
      expectedCaseRevision: 0,
      handoffExists: false,
      handoff: null,
      catalogDocument: null,
      form: createPrefilledCatalogHandoffForm(null),
      loadingStatus: false,
      submitting: false,
      statusError: null,
      submitError: null,
      lastDisposition: null,
      conflictState: null,
      uncertainState: null,
      sessionToken: 0,
    });
  }

  public getSnapshot(): LibraryQuarantineCatalogHandoffPanelSnapshot {
    return this.state;
  }

  public subscribe(
    listener: (snapshot: LibraryQuarantineCatalogHandoffPanelSnapshot) => void
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(
    patch: Partial<LibraryQuarantineCatalogHandoffPanelSnapshot>
  ): void {
    this.state = Object.freeze({
      ...this.state,
      ...patch,
    });
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  public setCurrentUser(user: AdminUser | null): void {
    const prevUserId = this.currentUser?.id ?? null;
    const nextUserId = user?.id ?? null;
    this.currentUser = user;

    if (
      prevUserId !== nextUserId ||
      !canCreateLibraryQuarantineCatalogDraft(user)
    ) {
      this.resetPanel();
    }
  }

  public setOptions(
    options: LibraryQuarantineCatalogHandoffControllerOptions
  ): void {
    if (options.getHandoffFn) {
      this.getHandoffFn = options.getHandoffFn;
    }
    if (options.createDraftFn) {
      this.createDraftFn = options.createDraftFn;
    }
    if (options.onCatalogDraftReady !== undefined) {
      this.onCatalogDraftReady = options.onCatalogDraftReady;
    }
    if (options.catalogHandoffEnabled !== undefined) {
      const nextEnabled = options.catalogHandoffEnabled === true;
      if (!nextEnabled && this.state.isExpanded) {
        this.resetPanel();
      }
      if (this.state.catalogHandoffEnabled !== nextEnabled) {
        this.setState({ catalogHandoffEnabled: nextEnabled });
      }
    }
  }

  public resetPanel(): void {
    const nextToken = this.state.sessionToken + 1;
    this.setState({
      isExpanded: false,
      receiptId: null,
      documentId: null,
      expectedCaseRevision: 0,
      handoffExists: false,
      handoff: null,
      catalogDocument: null,
      form: createPrefilledCatalogHandoffForm(null),
      loadingStatus: false,
      submitting: false,
      statusError: null,
      submitError: null,
      lastDisposition: null,
      conflictState: null,
      uncertainState: null,
      sessionToken: nextToken,
    });
  }

  public syncWithSavedReviewCase(
    reviewCase: SanitizedLibraryQuarantineHumanReviewCaseDto | null
  ): void {
    if (!reviewCase) {
      if (this.state.receiptId !== null || this.state.isExpanded) {
        this.resetPanel();
      }
      return;
    }

    if (
      this.state.receiptId !== null &&
      this.state.receiptId !== reviewCase.receiptId
    ) {
      this.resetPanel();
      return;
    }

    if (!isHumanReviewCaseEligibleForCatalogHandoff(reviewCase)) {
      if (this.state.isExpanded) {
        this.resetPanel();
      }
      return;
    }

    if (
      this.state.receiptId === reviewCase.receiptId &&
      this.state.expectedCaseRevision !== reviewCase.revision &&
      !this.state.submitting
    ) {
      this.setState({
        expectedCaseRevision: reviewCase.revision,
        form: Object.freeze({
          ...this.state.form,
          titleAr: reviewCase.titleAr,
          titleEn: reviewCase.titleEn,
          summaryAr: reviewCase.summaryAr,
          summaryEn: reviewCase.summaryEn,
        }),
        conflictState: null,
      });
    }
  }

  public updateFormField<
    K extends keyof LibraryQuarantineCatalogHandoffFormValues,
  >(field: K, value: LibraryQuarantineCatalogHandoffFormValues[K]): void {
    if (
      !this.state.isExpanded ||
      this.state.submitting ||
      this.state.handoffExists
    ) {
      return;
    }
    const nextForm: LibraryQuarantineCatalogHandoffFormValues = Object.freeze({
      ...this.state.form,
      [field]: value,
      ...(field === 'organizationId' && value !== this.state.form.organizationId
        ? { sourceId: '' }
        : {}),
    });
    this.setState({
      form: nextForm,
      submitError: null,
    });
  }

  public async openPanelForCase(
    reviewCase: SanitizedLibraryQuarantineHumanReviewCaseDto
  ): Promise<GetLibraryQuarantineCatalogHandoffResponseDto | null> {
    if (
      !this.state.catalogHandoffEnabled ||
      !canCreateLibraryQuarantineCatalogDraft(this.currentUser) ||
      !isHumanReviewCaseEligibleForCatalogHandoff(reviewCase)
    ) {
      return null;
    }

    const nextToken = this.state.sessionToken + 1;
    const expectedUserId = this.currentUser?.id ?? null;
    const targetReceiptId = reviewCase.receiptId;
    const targetDocumentId = deriveQuarantineCatalogDocumentId(targetReceiptId);

    const shouldResetForm = this.state.receiptId !== targetReceiptId;

    this.setState({
      isExpanded: true,
      receiptId: targetReceiptId,
      documentId: targetDocumentId,
      expectedCaseRevision: reviewCase.revision,
      ...(shouldResetForm
        ? {
            handoffExists: false,
            handoff: null,
            catalogDocument: null,
            form: createPrefilledCatalogHandoffForm(reviewCase),
            lastDisposition: null,
          }
        : {}),
      loadingStatus: true,
      submitting: false,
      statusError: null,
      submitError: null,
      conflictState: null,
      uncertainState: null,
      sessionToken: nextToken,
    });

    return this.executeLoadStatus(
      targetReceiptId,
      nextToken,
      expectedUserId,
      false
    );
  }

  public async verifyDraftStatus(): Promise<GetLibraryQuarantineCatalogHandoffResponseDto | null> {
    if (
      !this.state.isExpanded ||
      !this.state.receiptId ||
      this.state.loadingStatus ||
      this.state.submitting
    ) {
      return null;
    }
    if (
      !this.state.catalogHandoffEnabled ||
      !canCreateLibraryQuarantineCatalogDraft(this.currentUser)
    ) {
      this.resetPanel();
      return null;
    }

    const nextToken = this.state.sessionToken + 1;
    const expectedUserId = this.currentUser?.id ?? null;
    const targetReceiptId = this.state.receiptId;

    this.setState({
      loadingStatus: true,
      statusError: null,
      submitError: null,
      conflictState: null,
      uncertainState: null,
      sessionToken: nextToken,
    });

    return this.executeLoadStatus(
      targetReceiptId,
      nextToken,
      expectedUserId,
      false
    );
  }

  private async executeLoadStatus(
    targetReceiptId: string,
    activeToken: number,
    expectedUserId: string | null,
    preserveDisposition: boolean
  ): Promise<GetLibraryQuarantineCatalogHandoffResponseDto | null> {
    try {
      const response = await this.getHandoffFn(targetReceiptId);

      if (
        !this.state.isExpanded ||
        this.state.sessionToken !== activeToken ||
        (this.currentUser?.id ?? null) !== expectedUserId ||
        !canCreateLibraryQuarantineCatalogDraft(this.currentUser)
      ) {
        return null;
      }

      if (!response.ok) {
        this.setState({
          loadingStatus: false,
          statusError: `${response.errorCode}: ${response.errorMessage}`,
        });
        return response;
      }

      this.setState({
        loadingStatus: false,
        statusError: null,
        handoffExists: response.handoffExists,
        handoff: response.handoff,
        catalogDocument: response.catalogDocument,
        ...(response.currentCaseRevision > 0
          ? { expectedCaseRevision: response.currentCaseRevision }
          : {}),
        conflictState: null,
        uncertainState: null,
        ...(preserveDisposition ? {} : { lastDisposition: null }),
      });

      if (response.handoffExists && response.catalogDocument) {
        this.onCatalogDraftReady?.(response.catalogDocument);
      }

      return response;
    } catch (err: unknown) {
      if (
        !this.state.isExpanded ||
        this.state.sessionToken !== activeToken ||
        (this.currentUser?.id ?? null) !== expectedUserId
      ) {
        return null;
      }

      if (isCatalogHandoffNotReleasedError(err)) {
        this.setState({
          loadingStatus: false,
          catalogHandoffEnabled: false,
          statusError: CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.FEATURE_NOT_RELEASED,
        });
        return null;
      }

      const safeMessage =
        err instanceof Error &&
        (err.message ===
          CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.GET_RESPONSE_CONTRACT_INVALID ||
          err.message ===
            CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.HANDOFF_DTO_CONTRACT_INVALID ||
          err.message ===
            CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.DOCUMENT_DTO_CONTRACT_INVALID ||
          err.message ===
            CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.BACKEND_UNAVAILABLE)
          ? err.message
          : CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.GET_CALL_FAILED;

      this.setState({
        loadingStatus: false,
        statusError: safeMessage,
      });
      return null;
    }
  }

  public async submitCatalogDraft(): Promise<CreateLibraryQuarantineCatalogDraftResponseDto | null> {
    if (
      !this.state.isExpanded ||
      !this.state.receiptId ||
      this.state.loadingStatus ||
      this.state.submitting ||
      this.state.handoffExists ||
      this.state.uncertainState !== null
    ) {
      return null;
    }

    if (
      !this.state.catalogHandoffEnabled ||
      !canCreateLibraryQuarantineCatalogDraft(this.currentUser)
    ) {
      this.resetPanel();
      return null;
    }

    const { form } = this.state;
    let validatedInput: CreateLibraryQuarantineCatalogDraftClassificationInput;
    try {
      validatedInput = validateClientCatalogDraftClassificationInput({
        titleAr: form.titleAr,
        titleEn: form.titleEn,
        ...(form.originalTitle.trim().length > 0
          ? { originalTitle: form.originalTitle }
          : {}),
        summaryAr: form.summaryAr,
        summaryEn: form.summaryEn,
        documentType: form.documentType,
        organizationId: form.organizationId,
        sourceId: form.sourceId,
        geographyAr: form.geographyAr,
        geographyEn: form.geographyEn,
        publicationDate: form.publicationDate,
        language: form.language,
        topicsAr: splitCommaSeparatedTags(form.topicsArText),
        topicsEn: splitCommaSeparatedTags(form.topicsEnText),
        environmentalDomains: splitCommaSeparatedTags(
          form.environmentalDomainsText
        ),
        legalStatusDescriptionAr: form.legalStatusDescriptionAr,
        legalStatusDescriptionEn: form.legalStatusDescriptionEn,
      });
    } catch (validationErr: unknown) {
      const msg =
        validationErr instanceof Error
          ? validationErr.message
          : CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.INVALID_CLASSIFICATION_INPUT;
      this.setState({
        submitError: msg,
        lastDisposition: null,
      });
      return null;
    }

    const activeToken = this.state.sessionToken;
    const expectedUserId = this.currentUser?.id ?? null;
    const receiptId = this.state.receiptId;
    const expectedCaseRevision = this.state.expectedCaseRevision;

    this.setState({
      submitting: true,
      submitError: null,
      lastDisposition: null,
      conflictState: null,
    });

    try {
      const response = await this.createDraftFn({
        receiptId,
        expectedCaseRevision,
        input: validatedInput,
      });

      if (
        !this.state.isExpanded ||
        this.state.sessionToken !== activeToken ||
        (this.currentUser?.id ?? null) !== expectedUserId ||
        !canCreateLibraryQuarantineCatalogDraft(this.currentUser)
      ) {
        return null;
      }

      if (response.ok && response.status === 'HANDOFF_RECORDED') {
        this.setState({
          submitting: false,
          handoffExists: true,
          handoff: response.handoff,
          catalogDocument: response.catalogDocument,
          submitError: null,
          conflictState: null,
          uncertainState: null,
          lastDisposition: response.disposition,
        });

        this.onCatalogDraftReady?.(response.catalogDocument);

        await this.executeLoadStatus(
          receiptId,
          activeToken,
          expectedUserId,
          true
        );

        return response;
      }

      if (!response.ok && response.status === 'CONFLICT') {
        this.setState({
          submitting: false,
          lastDisposition: null,
          ...(response.existingHandoff && response.catalogDocument
            ? {
                handoffExists: true,
                handoff: response.existingHandoff,
                catalogDocument: response.catalogDocument,
              }
            : {}),
          conflictState: Object.freeze({
            errorCode: response.errorCode,
            errorMessage: response.errorMessage,
            currentCaseRevision: response.currentCaseRevision,
            existingHandoff: response.existingHandoff,
            catalogDocument: response.catalogDocument,
          }),
        });
        if (response.catalogDocument) {
          this.onCatalogDraftReady?.(response.catalogDocument);
        }
        return response;
      }

      if (
        !response.ok &&
        (response.status === 'UNKNOWN' || response.documentCreated === null)
      ) {
        this.setState({
          submitting: false,
          lastDisposition: null,
          uncertainState: Object.freeze({
            errorCode: 'TRANSACTION_COMMIT_UNCERTAIN' as const,
            errorMessage: response.errorMessage,
            documentCreationOutcome: 'UNKNOWN' as const,
            documentCreated: null,
          }),
        });
        return response;
      }

      // status === 'HOLD'
      this.setState({
        submitting: false,
        lastDisposition: null,
        submitError: `${response.errorCode}: ${response.errorMessage}`,
      });
      return response;
    } catch (err: unknown) {
      if (
        !this.state.isExpanded ||
        this.state.sessionToken !== activeToken ||
        (this.currentUser?.id ?? null) !== expectedUserId
      ) {
        return null;
      }

      if (isCatalogHandoffNotReleasedError(err)) {
        this.setState({
          submitting: false,
          catalogHandoffEnabled: false,
          submitError: CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.FEATURE_NOT_RELEASED,
        });
        return null;
      }

      const safeMessage =
        err instanceof Error &&
        (err.message ===
          CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.CREATE_RESPONSE_CONTRACT_INVALID ||
          err.message ===
            CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.HANDOFF_DTO_CONTRACT_INVALID ||
          err.message ===
            CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.DOCUMENT_DTO_CONTRACT_INVALID ||
          err.message ===
            CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.BACKEND_UNAVAILABLE)
          ? err.message
          : CATALOG_HANDOFF_CLIENT_SAFE_ERRORS.CREATE_CALL_FAILED;

      this.setState({
        submitting: false,
        lastDisposition: null,
        submitError: safeMessage,
      });
      return null;
    }
  }
}

export interface LibraryQuarantineCatalogHandoffPanelProps {
  readonly controller: LibraryQuarantineCatalogHandoffPanelController;
  readonly currentUser: AdminUser | null;
  readonly savedReviewCase: SanitizedLibraryQuarantineHumanReviewCaseDto | null;
  readonly hasUnsavedCaseEdits: boolean;
  readonly organizations: readonly LibraryOrganization[];
  readonly sources: readonly LibrarySource[];
  readonly isAr: boolean;
  readonly onReloadHumanReviewCase?: () => void;
}

export function LibraryQuarantineCatalogHandoffPanel({
  controller,
  currentUser,
  savedReviewCase,
  hasUnsavedCaseEdits,
  organizations,
  sources,
  isAr,
  onReloadHumanReviewCase,
}: LibraryQuarantineCatalogHandoffPanelProps) {
  const [snapshot, setSnapshot] =
    useState<LibraryQuarantineCatalogHandoffPanelSnapshot>(() =>
      controller.getSnapshot()
    );

  useEffect(() => {
    setSnapshot(controller.getSnapshot());
    return controller.subscribe((next) => {
      setSnapshot(next);
    });
  }, [controller]);

  useEffect(() => {
    controller.syncWithSavedReviewCase(savedReviewCase);
  }, [controller, savedReviewCase]);

  const canActorCreateDraft =
    canCreateLibraryQuarantineCatalogDraft(currentUser);
  const isCaseEligible =
    isHumanReviewCaseEligibleForCatalogHandoff(savedReviewCase);

  if (
    !snapshot.catalogHandoffEnabled ||
    !canActorCreateDraft ||
    !savedReviewCase ||
    !isCaseEligible
  ) {
    return null;
  }

  const verifiedSourcesForSelectedOrg = sources.filter(
    (src) =>
      src.organizationId === snapshot.form.organizationId &&
      src.verificationStatus === 'Verified'
  );

  const isSubmitDisabled =
    snapshot.loadingStatus ||
    snapshot.submitting ||
    snapshot.handoffExists ||
    snapshot.uncertainState !== null ||
    hasUnsavedCaseEdits;

  return (
    <div
      data-testid="quarantine-catalog-handoff-section"
      className="pt-4 border-t-2 border-dashed border-teal-200 dark:border-teal-900/70 space-y-3 text-xs"
    >
      {/* Header Row with Single Primary CTA Button */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 p-3.5 rounded-xl bg-teal-50/70 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800">
        <div className="space-y-1">
          <div className="font-extrabold text-teal-950 dark:text-teal-200 flex items-center gap-1.5">
            <BookOpen className="h-4 w-4 text-teal-700 dark:text-teal-400 shrink-0" />
            <span>
              {isAr
                ? 'الربط الداخلي بمسودة فهرس المكتبة (بدون ملف مرفق أو نشر)'
                : 'Internal Library Catalog Draft Handoff (No Attached File or Publication)'}
            </span>
          </div>
          <p className="text-[11px] text-teal-800 dark:text-teal-300 leading-relaxed">
            {isAr
              ? 'ينشئ هذا الإجراء مسودة وثيقة داخلية (Draft / ReviewRequired) بمعرّف حتمي دون إرفاق أي ملف أو رابط تنزيل ودون تغيير حالة الحجر الصحي.'
              : 'Creates an internal Draft / ReviewRequired catalog record with a deterministic ID without attaching any file or download URL.'}
          </p>
        </div>

        <button
          type="button"
          data-testid="open-quarantine-catalog-handoff-btn"
          disabled={hasUnsavedCaseEdits || snapshot.submitting}
          onClick={() => {
            void controller.openPanelForCase(savedReviewCase);
          }}
          className="px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-extrabold text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5 shrink-0 shadow-xs"
        >
          <BookOpen className="h-3.5 w-3.5 shrink-0" />
          <span>
            {isAr ? 'نقل إلى مسودة المكتبة' : 'Prepare library draft'}
          </span>
        </button>
      </div>

      {hasUnsavedCaseEdits && (
        <div
          data-testid="quarantine-catalog-handoff-unsaved-case-notice"
          className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-[11px] font-bold"
        >
          {isAr
            ? 'يرجى حفظ التعديلات الحالية في سجل المراجعة البشرية أولاً قبل نقل البيانات إلى مسودة المكتبة.'
            : 'Please save your current edits to the human review case first before preparing the library catalog draft.'}
        </div>
      )}

      {/* Inline Expanded Handoff Panel */}
      {snapshot.isExpanded && (
        <div
          data-testid="quarantine-catalog-handoff-panel"
          className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-teal-300 dark:border-teal-800 space-y-4 shadow-xs"
        >
          {/* Loading Status */}
          {snapshot.loadingStatus && (
            <div
              data-testid="quarantine-catalog-handoff-loading"
              className="p-6 text-center space-y-2"
            >
              <Loader2 className="h-5 w-5 text-teal-600 animate-spin mx-auto" />
              <p className="text-xs font-extrabold text-gray-700 dark:text-gray-300">
                {isAr
                  ? 'جاري التحقق من حالة مسودة الفهرس على الخادم...'
                  : 'Checking catalog draft handoff status on server...'}
              </p>
            </div>
          )}

          {/* Status Read Error */}
          {!snapshot.loadingStatus && snapshot.statusError && (
            <div
              data-testid="quarantine-catalog-handoff-status-error"
              role="alert"
              className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200 space-y-2"
            >
              <div className="font-extrabold flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
                <span>
                  {isAr
                    ? 'تعذر التحقق من حالة مسودة المكتبة'
                    : 'Failed to Verify Catalog Draft Status'}
                </span>
              </div>
              <p className="font-mono text-[11px] break-words">
                {snapshot.statusError}
              </p>
              <button
                type="button"
                data-testid="retry-quarantine-catalog-handoff-status-btn"
                onClick={() => {
                  void controller.verifyDraftStatus();
                }}
                className="px-3 py-1.5 rounded-lg bg-white dark:bg-gray-800 border border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-200 font-extrabold text-xs cursor-pointer inline-flex items-center gap-1.5"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>
                  {isAr ? 'تحقق من المسودة' : 'Verify draft'}
                </span>
              </button>
            </div>
          )}

          {/* Uncertain Commit Banner (UNKNOWN / documentCreated: null) */}
          {snapshot.uncertainState && (
            <div
              data-testid="quarantine-catalog-handoff-uncertain-banner"
              role="alert"
              className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/60 border-2 border-amber-400 dark:border-amber-700 text-amber-950 dark:text-amber-100 space-y-2.5"
            >
              <div className="font-extrabold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                <span>
                  {isAr
                    ? 'نتيجة إنشاء المسودة غير مؤكدة — تم إيقاف إعادة الإرسال التلقائي'
                    : 'Draft Creation Outcome Uncertain — Automatic Resubmission Stopped'}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed">
                {isAr
                  ? 'انقطع تأكيد المعاملة بعد بدء الكتابة. لتجنب التكرار، يرجى الضغط على «تحقق من المسودة» لقراءة الحالة الفعلية من الخادم.'
                  : 'Transaction commit confirmation was lost after staging writes. Click "Verify draft" to check whether the catalog draft was created on the server.'}
              </p>
              <button
                type="button"
                data-testid="verify-quarantine-catalog-draft-btn"
                onClick={() => {
                  void controller.verifyDraftStatus();
                }}
                className="px-3.5 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-extrabold text-xs cursor-pointer inline-flex items-center gap-1.5"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>{isAr ? 'تحقق من المسودة' : 'Verify draft'}</span>
              </button>
            </div>
          )}

          {/* Conflict Banner */}
          {snapshot.conflictState && (
            <div
              data-testid="quarantine-catalog-handoff-conflict-banner"
              role="alert"
              className="p-4 rounded-xl bg-orange-50 dark:bg-orange-950/50 border border-orange-300 dark:border-orange-800 text-orange-950 dark:text-orange-100 space-y-2"
            >
              <div className="font-extrabold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-600 shrink-0" />
                <span>
                  {isAr
                    ? `تعارض في حالة السجل (النسخة الحالية #${snapshot.conflictState.currentCaseRevision})`
                    : `Case or Handoff Conflict (Current Case Revision #${snapshot.conflictState.currentCaseRevision})`}
                </span>
              </div>
              <p className="font-mono text-[11px] break-words">
                {snapshot.conflictState.errorCode}:{' '}
                {snapshot.conflictState.errorMessage}
              </p>
              {onReloadHumanReviewCase && (
                <button
                  type="button"
                  data-testid="reload-case-from-handoff-conflict-btn"
                  onClick={() => onReloadHumanReviewCase()}
                  className="px-3 py-1.5 rounded-lg bg-orange-700 hover:bg-orange-800 text-white font-extrabold text-xs cursor-pointer inline-flex items-center gap-1.5"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>
                    {isAr
                      ? 'إعادة تحميل سجل المراجعة'
                      : 'Reload human review case'}
                  </span>
                </button>
              )}
            </div>
          )}

          {/* Submit Error Banner */}
          {snapshot.submitError &&
            !snapshot.uncertainState &&
            !snapshot.conflictState && (
              <div
                data-testid="quarantine-catalog-handoff-submit-error"
                role="alert"
                className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200 space-y-1"
              >
                <div className="font-extrabold flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
                  <span>
                    {isAr
                      ? 'تعذر إنشاء مسودة فهرس المكتبة'
                      : 'Could Not Create Library Catalog Draft'}
                  </span>
                </div>
                <p className="font-mono text-[11px] break-words">
                  {snapshot.submitError}
                </p>
              </div>
            )}

          {/* Linked Catalog Draft Read-Only Summary Card (when handoffExists === true) */}
          {!snapshot.loadingStatus &&
            snapshot.handoffExists &&
            snapshot.catalogDocument && (
              <div
                data-testid="quarantine-catalog-handoff-linked-card"
                className="p-4 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-extrabold text-emerald-950 dark:text-emerald-200 flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>
                      {snapshot.lastDisposition === 'CREATED'
                        ? isAr
                          ? 'تم إنشاء مسودة الفهرس الداخلية وربطها بنجاح'
                          : 'Internal Catalog Draft Created & Linked'
                        : isAr
                          ? 'مسودة الفهرس الداخلية مرتبطة مسبقاً بهذا الإيصال'
                          : 'Internal Catalog Draft Linked to Receipt'}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      data-testid="quarantine-catalog-draft-workflow-badge"
                      className="px-2 py-0.5 rounded-md bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-200 font-mono font-bold text-[10px]"
                    >
                      {snapshot.catalogDocument.workflowState}
                    </span>
                    <span
                      data-testid="quarantine-catalog-draft-rights-badge"
                      className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/80 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-800 font-mono font-bold text-[10px]"
                    >
                      {snapshot.catalogDocument.rightsStatus}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-gray-700 dark:text-gray-300">
                  <div>
                    <span className="font-bold">
                      {isAr ? 'معرّف مسودة المكتبة: ' : 'Draft Document ID: '}
                    </span>
                    <span
                      data-testid="quarantine-catalog-draft-document-id"
                      className="font-mono break-all"
                      dir="ltr"
                    >
                      {snapshot.catalogDocument.id}
                    </span>
                  </div>
                  <div>
                    <span className="font-bold">
                      {isAr ? 'نوع الوثيقة: ' : 'Document Type: '}
                    </span>
                    <span className="font-mono">
                      {snapshot.catalogDocument.documentType}
                    </span>
                  </div>
                  <div>
                    <span className="font-bold">
                      {isAr ? 'العنوان (عربي): ' : 'Title (AR): '}
                    </span>
                    <span>{snapshot.catalogDocument.titleAr}</span>
                  </div>
                  <div>
                    <span className="font-bold">
                      {isAr ? 'العنوان (إنجليزي): ' : 'Title (EN): '}
                    </span>
                    <span>{snapshot.catalogDocument.titleEn}</span>
                  </div>
                </div>

                <div
                  data-testid="quarantine-catalog-draft-lock-notice"
                  className="p-2.5 rounded-lg bg-amber-100/70 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 text-amber-950 dark:text-amber-200 text-[11px] flex items-start gap-1.5"
                >
                  <Lock className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    {isAr
                      ? 'هذه المسودة مقفلة في حالة مسودة داخلية (Draft / ReviewRequired) بدون أي ملف مرفق أو رابط تنزيل (referenceUrl)، ولا يمكن ترقيتها أو نشرها للجمهور قبل اجتياز بوابات الفحص الثنائي وتطهير الملف واعتماد الحقوق.'
                      : 'This catalog record is locked in internal Draft / ReviewRequired posture with zero attached files or referenceUrl, and cannot transition or publish until binary safety and rights clearance gates are released.'}
                  </span>
                </div>
              </div>
            )}

          {/* Classification Form (when handoffExists === false) */}
          {!snapshot.loadingStatus &&
            !snapshot.statusError &&
            !snapshot.handoffExists && (
              <div
                data-testid="quarantine-catalog-handoff-form"
                className="space-y-3.5"
              >
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-800 text-[11px] text-gray-700 dark:text-gray-300 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-bold">
                    <ShieldCheck className="h-4 w-4 text-teal-700 dark:text-teal-400 shrink-0" />
                    <span>
                      {isAr
                        ? 'معرّف المسودة الحتمي المخصص:'
                        : 'Deterministic Target Draft ID:'}
                    </span>
                    <span
                      data-testid="quarantine-catalog-target-doc-id"
                      className="font-mono text-teal-800 dark:text-teal-300"
                      dir="ltr"
                    >
                      {snapshot.documentId}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-gray-500">
                    Case Revision #{snapshot.expectedCaseRevision}
                  </span>
                </div>

                {/* Bilingual Titles */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label
                      htmlFor="catalog-handoff-title-ar"
                      className="block font-bold text-gray-700 dark:text-gray-300"
                    >
                      {isAr ? 'العنوان بالعربية *' : 'Arabic Title *'}
                    </label>
                    <input
                      id="catalog-handoff-title-ar"
                      data-testid="catalog-handoff-title-ar-input"
                      type="text"
                      dir="rtl"
                      maxLength={CATALOG_HANDOFF_TITLE_MAX_LENGTH}
                      disabled={isSubmitDisabled}
                      value={snapshot.form.titleAr}
                      onChange={(e) =>
                        controller.updateFormField('titleAr', e.target.value)
                      }
                      className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 text-gray-900 dark:text-gray-100"
                    />
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="catalog-handoff-title-en"
                      className="block font-bold text-gray-700 dark:text-gray-300"
                    >
                      {isAr ? 'العنوان بالإنجليزية *' : 'English Title *'}
                    </label>
                    <input
                      id="catalog-handoff-title-en"
                      data-testid="catalog-handoff-title-en-input"
                      type="text"
                      dir="ltr"
                      maxLength={CATALOG_HANDOFF_TITLE_MAX_LENGTH}
                      disabled={isSubmitDisabled}
                      value={snapshot.form.titleEn}
                      onChange={(e) =>
                        controller.updateFormField('titleEn', e.target.value)
                      }
                      className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                </div>

                {/* Document Type, Language, Publication Date */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label
                      htmlFor="catalog-handoff-doc-type"
                      className="block font-bold text-gray-700 dark:text-gray-300"
                    >
                      {isAr ? 'نوع الوثيقة *' : 'Document Type *'}
                    </label>
                    <select
                      id="catalog-handoff-doc-type"
                      data-testid="catalog-handoff-doc-type-select"
                      disabled={isSubmitDisabled}
                      value={snapshot.form.documentType}
                      onChange={(e) =>
                        controller.updateFormField(
                          'documentType',
                          e.target.value as LibraryDocumentType | ''
                        )
                      }
                      className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                    >
                      <option value="">
                        {isAr ? '-- اختر نوع الوثيقة --' : '-- Select Type --'}
                      </option>
                      {Object.values(LibraryDocumentType).map((dt) => (
                        <option key={dt} value={dt}>
                          {dt}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="catalog-handoff-language"
                      className="block font-bold text-gray-700 dark:text-gray-300"
                    >
                      {isAr ? 'اللغة *' : 'Language *'}
                    </label>
                    <select
                      id="catalog-handoff-language"
                      data-testid="catalog-handoff-language-select"
                      disabled={isSubmitDisabled}
                      value={snapshot.form.language}
                      onChange={(e) =>
                        controller.updateFormField(
                          'language',
                          e.target.value as
                            | 'ar'
                            | 'en'
                            | 'bilingual'
                            | 'other'
                            | ''
                        )
                      }
                      className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                    >
                      <option value="">
                        {isAr ? '-- اختر اللغة --' : '-- Select Language --'}
                      </option>
                      <option value="ar">ar</option>
                      <option value="en">en</option>
                      <option value="bilingual">bilingual</option>
                      <option value="other">other</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="catalog-handoff-pub-date"
                      className="block font-bold text-gray-700 dark:text-gray-300"
                    >
                      {isAr ? 'تاريخ النشر الأصلي *' : 'Publication Date *'}
                    </label>
                    <input
                      id="catalog-handoff-pub-date"
                      data-testid="catalog-handoff-pub-date-input"
                      type="date"
                      dir="ltr"
                      disabled={isSubmitDisabled}
                      value={snapshot.form.publicationDate}
                      onChange={(e) =>
                        controller.updateFormField(
                          'publicationDate',
                          e.target.value
                        )
                      }
                      className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                </div>

                {/* Registered Organization & Verified Source Selectors */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label
                      htmlFor="catalog-handoff-org"
                      className="block font-bold text-gray-700 dark:text-gray-300"
                    >
                      {isAr
                        ? 'المؤسسة المسجلة المعتمدة *'
                        : 'Registered Organization *'}
                    </label>
                    <select
                      id="catalog-handoff-org"
                      data-testid="catalog-handoff-org-select"
                      disabled={isSubmitDisabled}
                      value={snapshot.form.organizationId}
                      onChange={(e) =>
                        controller.updateFormField(
                          'organizationId',
                          e.target.value
                        )
                      }
                      className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                    >
                      <option value="">
                        {isAr
                          ? '-- اختر المؤسسة المسجلة --'
                          : '-- Select Registered Organization --'}
                      </option>
                      {organizations.map((org) => (
                        <option key={org.id} value={org.id}>
                          {isAr
                            ? `${org.nameAr} (${org.nameEn})`
                            : `${org.nameEn} (${org.nameAr})`}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="catalog-handoff-source"
                      className="block font-bold text-gray-700 dark:text-gray-300"
                    >
                      {isAr
                        ? 'المصدر الموثق المرتبط بالمؤسسة (Verified) *'
                        : 'Verified Source for Organization *'}
                    </label>
                    <select
                      id="catalog-handoff-source"
                      data-testid="catalog-handoff-source-select"
                      disabled={
                        isSubmitDisabled || !snapshot.form.organizationId
                      }
                      value={snapshot.form.sourceId}
                      onChange={(e) =>
                        controller.updateFormField('sourceId', e.target.value)
                      }
                      className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                    >
                      <option value="">
                        {isAr
                          ? '-- اختر المصدر الموثق (Verified) --'
                          : '-- Select Verified Source --'}
                      </option>
                      {verifiedSourcesForSelectedOrg.map((src) => (
                        <option key={src.id} value={src.id}>
                          {isAr
                            ? `${src.sourceNameAr} (${src.sourceNameEn})`
                            : `${src.sourceNameEn} (${src.sourceNameAr})`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Geography AR / EN */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label
                      htmlFor="catalog-handoff-geo-ar"
                      className="block font-bold text-gray-700 dark:text-gray-300"
                    >
                      {isAr ? 'النطاق الجغرافي (عربي) *' : 'Geography (AR) *'}
                    </label>
                    <input
                      id="catalog-handoff-geo-ar"
                      data-testid="catalog-handoff-geo-ar-input"
                      type="text"
                      dir="rtl"
                      maxLength={CATALOG_HANDOFF_GEOGRAPHY_MAX_LENGTH}
                      disabled={isSubmitDisabled}
                      value={snapshot.form.geographyAr}
                      onChange={(e) =>
                        controller.updateFormField(
                          'geographyAr',
                          e.target.value
                        )
                      }
                      className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 text-gray-900 dark:text-gray-100"
                    />
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="catalog-handoff-geo-en"
                      className="block font-bold text-gray-700 dark:text-gray-300"
                    >
                      {isAr
                        ? 'النطاق الجغرافي (إنجليزي) *'
                        : 'Geography (EN) *'}
                    </label>
                    <input
                      id="catalog-handoff-geo-en"
                      data-testid="catalog-handoff-geo-en-input"
                      type="text"
                      dir="ltr"
                      maxLength={CATALOG_HANDOFF_GEOGRAPHY_MAX_LENGTH}
                      disabled={isSubmitDisabled}
                      value={snapshot.form.geographyEn}
                      onChange={(e) =>
                        controller.updateFormField(
                          'geographyEn',
                          e.target.value
                        )
                      }
                      className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                </div>

                {/* Summaries AR / EN */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label
                      htmlFor="catalog-handoff-summary-ar"
                      className="block font-bold text-gray-700 dark:text-gray-300"
                    >
                      {isAr ? 'الملخص (عربي) *' : 'Summary (AR) *'}
                    </label>
                    <textarea
                      id="catalog-handoff-summary-ar"
                      data-testid="catalog-handoff-summary-ar-input"
                      rows={2}
                      dir="rtl"
                      maxLength={CATALOG_HANDOFF_SUMMARY_MAX_LENGTH}
                      disabled={isSubmitDisabled}
                      value={snapshot.form.summaryAr}
                      onChange={(e) =>
                        controller.updateFormField('summaryAr', e.target.value)
                      }
                      className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 text-gray-900 dark:text-gray-100"
                    />
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="catalog-handoff-summary-en"
                      className="block font-bold text-gray-700 dark:text-gray-300"
                    >
                      {isAr ? 'الملخص (إنجليزي) *' : 'Summary (EN) *'}
                    </label>
                    <textarea
                      id="catalog-handoff-summary-en"
                      data-testid="catalog-handoff-summary-en-input"
                      rows={2}
                      dir="ltr"
                      maxLength={CATALOG_HANDOFF_SUMMARY_MAX_LENGTH}
                      disabled={isSubmitDisabled}
                      value={snapshot.form.summaryEn}
                      onChange={(e) =>
                        controller.updateFormField('summaryEn', e.target.value)
                      }
                      className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                </div>

                {/* Topics AR / EN & Environmental Domains */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label
                      htmlFor="catalog-handoff-topics-ar"
                      className="block font-bold text-gray-700 dark:text-gray-300"
                    >
                      {isAr
                        ? 'الموضوعات (عربي، مفصولة بفاصلة) *'
                        : 'Topics (AR, comma-separated) *'}
                    </label>
                    <input
                      id="catalog-handoff-topics-ar"
                      data-testid="catalog-handoff-topics-ar-input"
                      type="text"
                      dir="rtl"
                      disabled={isSubmitDisabled}
                      value={snapshot.form.topicsArText}
                      onChange={(e) =>
                        controller.updateFormField(
                          'topicsArText',
                          e.target.value
                        )
                      }
                      className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 text-gray-900 dark:text-gray-100"
                    />
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="catalog-handoff-topics-en"
                      className="block font-bold text-gray-700 dark:text-gray-300"
                    >
                      {isAr
                        ? 'الموضوعات (إنجليزي، مفصولة بفاصلة) *'
                        : 'Topics (EN, comma-separated) *'}
                    </label>
                    <input
                      id="catalog-handoff-topics-en"
                      data-testid="catalog-handoff-topics-en-input"
                      type="text"
                      dir="ltr"
                      disabled={isSubmitDisabled}
                      value={snapshot.form.topicsEnText}
                      onChange={(e) =>
                        controller.updateFormField(
                          'topicsEnText',
                          e.target.value
                        )
                      }
                      className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 text-gray-900 dark:text-gray-100"
                    />
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="catalog-handoff-domains"
                      className="block font-bold text-gray-700 dark:text-gray-300"
                    >
                      {isAr
                        ? 'المجالات البيئية (مفصولة بفاصلة) *'
                        : 'Environmental Domains (comma-separated) *'}
                    </label>
                    <input
                      id="catalog-handoff-domains"
                      data-testid="catalog-handoff-domains-input"
                      type="text"
                      dir="ltr"
                      disabled={isSubmitDisabled}
                      value={snapshot.form.environmentalDomainsText}
                      onChange={(e) =>
                        controller.updateFormField(
                          'environmentalDomainsText',
                          e.target.value
                        )
                      }
                      className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                </div>

                {/* Legal Status Description AR / EN */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label
                      htmlFor="catalog-handoff-legal-ar"
                      className="block font-bold text-gray-700 dark:text-gray-300"
                    >
                      {isAr
                        ? 'وصف الوضع القانوني/التنظيمي (عربي) *'
                        : 'Legal Status Description (AR) *'}
                    </label>
                    <textarea
                      id="catalog-handoff-legal-ar"
                      data-testid="catalog-handoff-legal-ar-input"
                      rows={2}
                      dir="rtl"
                      maxLength={CATALOG_HANDOFF_LEGAL_STATUS_MAX_LENGTH}
                      disabled={isSubmitDisabled}
                      value={snapshot.form.legalStatusDescriptionAr}
                      onChange={(e) =>
                        controller.updateFormField(
                          'legalStatusDescriptionAr',
                          e.target.value
                        )
                      }
                      className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 text-gray-900 dark:text-gray-100"
                    />
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="catalog-handoff-legal-en"
                      className="block font-bold text-gray-700 dark:text-gray-300"
                    >
                      {isAr
                        ? 'وصف الوضع القانوني/التنظيمي (إنجليزي) *'
                        : 'Legal Status Description (EN) *'}
                    </label>
                    <textarea
                      id="catalog-handoff-legal-en"
                      data-testid="catalog-handoff-legal-en-input"
                      rows={2}
                      dir="ltr"
                      maxLength={CATALOG_HANDOFF_LEGAL_STATUS_MAX_LENGTH}
                      disabled={isSubmitDisabled}
                      value={snapshot.form.legalStatusDescriptionEn}
                      onChange={(e) =>
                        controller.updateFormField(
                          'legalStatusDescriptionEn',
                          e.target.value
                        )
                      }
                      className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                </div>

                {/* Submit Action Row */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    data-testid="submit-quarantine-catalog-draft-btn"
                    disabled={isSubmitDisabled}
                    onClick={() => {
                      void controller.submitCatalogDraft();
                    }}
                    className="px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-extrabold text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
                  >
                    {snapshot.submitting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                    ) : (
                      <FileText className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span>
                      {snapshot.submitting
                        ? isAr
                          ? 'جاري إنشاء المسودة الداخلية...'
                          : 'Creating internal catalog draft...'
                        : isAr
                          ? 'تأكيد إنشاء مسودة الفهرس الداخلية'
                          : 'Create internal catalog draft'}
                    </span>
                  </button>
                </div>
              </div>
            )}
        </div>
      )}
    </div>
  );
}
