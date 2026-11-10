import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  Loader2,
  Lock,
  RefreshCw,
  Scale,
  ShieldAlert,
} from 'lucide-react';
import type { AdminUser } from '../../types/admin';
import type { SanitizedLibraryQuarantineHumanReviewCaseDto } from '../../services/libraryQuarantineHumanReviewClient';
import {
  LIBRARY_QUARANTINE_RIGHTS_BASES,
  LIBRARY_QUARANTINE_RIGHTS_DECISION_STATUSES,
  LIBRARY_QUARANTINE_RIGHTS_SCOPE,
  QUARANTINE_RIGHTS_READINESS_INDICATORS,
  RIGHTS_DECISION_CLIENT_SAFE_ERRORS,
  RIGHTS_DECISION_EVIDENCE_REFERENCE_MAX_LENGTH,
  RIGHTS_DECISION_NOTES_MAX_LENGTH,
  LibraryQuarantineRightsDecisionClient,
  canReviewLibraryQuarantineRights,
  deriveQuarantineCatalogDocumentId,
  isLibraryQuarantineRightsDecisionEnabled,
  isRightsDecisionNotReleasedError,
  validateClientRightsDecisionInput,
  type GetLibraryQuarantineRightsDecisionResponseDto,
  type LibraryQuarantineReadinessIndicatorsDto,
  type LibraryQuarantineRightsBasis,
  type LibraryQuarantineRightsDecisionEditorialFields,
  type LibraryQuarantineRightsDecisionStatus,
  type SanitizedLibraryQuarantineRightsDecisionDto,
  type SaveLibraryQuarantineRightsDecisionInput,
  type SaveLibraryQuarantineRightsDecisionResponseDto,
} from '../../services/libraryQuarantineRightsDecisionClient';

/**
 * LIB-FILE-RIGHTS-AND-READINESS-01 — Inline Human Rights Review Decision Panel & Controller
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Renders inline directly inside `LibraryQuarantineHumanReviewModal` (NOT inside
 *   `LibraryQuarantineCatalogHandoffPanel`, because `RightsReviewer` has
 *   `Review + ManageRights` and does NOT have `Create`).
 * - Visible ONLY when all 4 UI release flags (`VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED`,
 *   `VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED`, `VITE_LIBRARY_CATALOG_HANDOFF_ENABLED`,
 *   `VITE_LIBRARY_RIGHTS_DECISION_ENABLED`) equal `'true'`, the active human user
 *   holds `Review + ManageRights` (`Owner` or `RightsReviewer`), and the saved
 *   human review case is in `METADATA_RECORDED` state without unsaved edits.
 * - Never prefills rights decisions or evidence from AI or unverified preliminary
 *   metadata; populates ONLY from an existing server-persisted rights decision or
 *   explicit human reviewer input.
 * - If the `qcat-<receiptId>` catalog draft has not yet been created, displays
 *   explicit prerequisite guidance («أنشئ مسودة المكتبة أولًا بواسطة المحرر المخوّل»)
 *   and hides editable form inputs.
 * - If the human review case version drifted after catalog handoff
 *   (`SOURCE_CASE_VERSION_DRIFT_HOLD`), displays an explicit drift hold notice and
 *   blocks saving.
 * - Displays constant readiness indicators (`binarySafety: 'NOT_VERIFIED'`,
 *   `fileSanitization: 'NOT_PERFORMED'`, `publication: 'BLOCKED'`,
 *   `catalogWorkflow: 'Draft'`) before and after saving any decision (including
 *   `METADATA_USE_CLEARED`).
 * - Enforces single-save CTA, duplicate-click lock, CAS (`expectedRevision`),
 *   fresh server readback after save, `CONFLICT` banner, and `UNKNOWN`
 *   (`decisionSaved: null`) verify-only action («تحقق من القرار» / «Verify decision»).
 */

export interface LibraryQuarantineRightsDecisionConflictState {
  readonly errorCode: 'RIGHTS_DECISION_REVISION_CONFLICT';
  readonly errorMessage: string;
  readonly serverRevision: number;
  readonly serverDecision: SanitizedLibraryQuarantineRightsDecisionDto | null;
}

export interface LibraryQuarantineRightsDecisionUncertainState {
  readonly errorCode: 'TRANSACTION_COMMIT_UNCERTAIN';
  readonly errorMessage: string;
  readonly decisionSaveOutcome: 'UNKNOWN';
  readonly decisionSaved: null;
}

export interface LibraryQuarantineRightsDecisionPanelSnapshot {
  readonly isExpanded: boolean;
  readonly rightsDecisionEnabled: boolean;
  readonly receiptId: string | null;
  readonly documentId: string | null;
  readonly sourceRevision: number | null;
  readonly catalogHandoffCaseRevision: number | null;
  readonly effectiveCaseRevision: number | null;
  readonly currentHumanCaseRevision: number | null;
  readonly currentRevision: number;
  readonly rightsDecision: SanitizedLibraryQuarantineRightsDecisionDto | null;
  readonly rightsDecisionIsCurrent: boolean;
  readonly requiresFreshHumanRightsReview: boolean;
  readonly stalePreviousDecision: SanitizedLibraryQuarantineRightsDecisionDto | null;
  readonly acknowledgedCurrentCaseRevision: boolean;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly form: LibraryQuarantineRightsDecisionEditorialFields;
  readonly loading: boolean;
  readonly saving: boolean;
  readonly holdCode: string | null;
  readonly loadError: string | null;
  readonly saveError: string | null;
  readonly lastSaveOutcome: 'CREATED' | 'UPDATED' | null;
  readonly conflictState: LibraryQuarantineRightsDecisionConflictState | null;
  readonly uncertainState: LibraryQuarantineRightsDecisionUncertainState | null;
  readonly sessionToken: number;
}

export function createEmptyRightsDecisionForm(): LibraryQuarantineRightsDecisionEditorialFields {
  return Object.freeze({
    decision: 'EVIDENCE_PENDING' as const,
    basis: 'UNDETERMINED' as const,
    evidenceReference: '',
    evidenceNotes: '',
    reviewNotes: '',
  });
}

export function createFormFromSanitizedRightsDecision(
  decisionDto: SanitizedLibraryQuarantineRightsDecisionDto | null
): LibraryQuarantineRightsDecisionEditorialFields {
  if (!decisionDto) {
    return createEmptyRightsDecisionForm();
  }
  return Object.freeze({
    decision: decisionDto.decision,
    basis: decisionDto.basis,
    evidenceReference: decisionDto.evidenceReference,
    evidenceNotes: decisionDto.evidenceNotes,
    reviewNotes: decisionDto.reviewNotes,
  });
}

export function isSavedHumanCaseEligibleForRightsPanel(
  reviewCase: SanitizedLibraryQuarantineHumanReviewCaseDto | null | undefined
): reviewCase is SanitizedLibraryQuarantineHumanReviewCaseDto {
  if (!reviewCase || typeof reviewCase !== 'object') {
    return false;
  }
  return (
    reviewCase.status === 'METADATA_RECORDED' &&
    reviewCase.revision >= 1 &&
    reviewCase.sourceEvidenceNotes.trim().length > 0 &&
    (reviewCase.titleAr.trim().length > 0 ||
      reviewCase.titleEn.trim().length > 0)
  );
}

export interface LibraryQuarantineRightsDecisionControllerOptions {
  readonly rightsDecisionEnabled?: boolean;
  readonly getDecisionFn?: (
    receiptId: string
  ) => Promise<GetLibraryQuarantineRightsDecisionResponseDto>;
  readonly saveDecisionFn?: (params: {
    readonly receiptId: string;
    readonly expectedRevision: number;
    readonly acknowledgedHumanCaseRevision?: number;
    readonly input: SaveLibraryQuarantineRightsDecisionInput;
  }) => Promise<SaveLibraryQuarantineRightsDecisionResponseDto>;
  readonly onDecisionSaved?: (
    savedDecision: SanitizedLibraryQuarantineRightsDecisionDto
  ) => void;
}

export class LibraryQuarantineRightsDecisionPanelController {
  private currentUser: AdminUser | null;
  private getDecisionFn: (
    receiptId: string
  ) => Promise<GetLibraryQuarantineRightsDecisionResponseDto>;
  private saveDecisionFn: (params: {
    readonly receiptId: string;
    readonly expectedRevision: number;
    readonly acknowledgedHumanCaseRevision?: number;
    readonly input: SaveLibraryQuarantineRightsDecisionInput;
  }) => Promise<SaveLibraryQuarantineRightsDecisionResponseDto>;
  private onDecisionSaved?: (
    savedDecision: SanitizedLibraryQuarantineRightsDecisionDto
  ) => void;
  private state: LibraryQuarantineRightsDecisionPanelSnapshot;
  private readonly listeners = new Set<
    (snapshot: LibraryQuarantineRightsDecisionPanelSnapshot) => void
  >();

  constructor(
    currentUser: AdminUser | null,
    options?: LibraryQuarantineRightsDecisionControllerOptions
  ) {
    this.currentUser = currentUser;
    this.getDecisionFn =
      options?.getDecisionFn ??
      ((receiptId) =>
        LibraryQuarantineRightsDecisionClient.getQuarantineRightsDecision(
          receiptId
        ));
    this.saveDecisionFn =
      options?.saveDecisionFn ??
      ((params) =>
        LibraryQuarantineRightsDecisionClient.saveQuarantineRightsDecision(
          params
        ));
    this.onDecisionSaved = options?.onDecisionSaved;

    const resolvedEnabled =
      options?.rightsDecisionEnabled !== undefined
        ? options.rightsDecisionEnabled === true
        : isLibraryQuarantineRightsDecisionEnabled();

    this.state = Object.freeze({
      isExpanded: false,
      rightsDecisionEnabled: resolvedEnabled,
      receiptId: null,
      documentId: null,
      sourceRevision: null,
      catalogHandoffCaseRevision: null,
      effectiveCaseRevision: null,
      currentHumanCaseRevision: null,
      currentRevision: 0,
      rightsDecision: null,
      rightsDecisionIsCurrent: false,
      requiresFreshHumanRightsReview: true,
      stalePreviousDecision: null,
      acknowledgedCurrentCaseRevision: false,
      readiness: QUARANTINE_RIGHTS_READINESS_INDICATORS,
      form: createEmptyRightsDecisionForm(),
      loading: false,
      saving: false,
      holdCode: null,
      loadError: null,
      saveError: null,
      lastSaveOutcome: null,
      conflictState: null,
      uncertainState: null,
      sessionToken: 0,
    });
  }

  public getSnapshot(): LibraryQuarantineRightsDecisionPanelSnapshot {
    return this.state;
  }

  public subscribe(
    listener: (snapshot: LibraryQuarantineRightsDecisionPanelSnapshot) => void
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(
    patch: Partial<LibraryQuarantineRightsDecisionPanelSnapshot>
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
      !canReviewLibraryQuarantineRights(user)
    ) {
      this.resetPanel();
    }
  }

  public setOptions(
    options: LibraryQuarantineRightsDecisionControllerOptions
  ): void {
    if (options.getDecisionFn) {
      this.getDecisionFn = options.getDecisionFn;
    }
    if (options.saveDecisionFn) {
      this.saveDecisionFn = options.saveDecisionFn;
    }
    if (options.onDecisionSaved !== undefined) {
      this.onDecisionSaved = options.onDecisionSaved;
    }
    if (options.rightsDecisionEnabled !== undefined) {
      const nextEnabled = options.rightsDecisionEnabled === true;
      if (!nextEnabled && this.state.isExpanded) {
        this.resetPanel();
      }
      if (this.state.rightsDecisionEnabled !== nextEnabled) {
        this.setState({ rightsDecisionEnabled: nextEnabled });
      }
    }
  }

  public resetPanel(): void {
    const nextToken = this.state.sessionToken + 1;
    this.setState({
      isExpanded: false,
      receiptId: null,
      documentId: null,
      sourceRevision: null,
      catalogHandoffCaseRevision: null,
      effectiveCaseRevision: null,
      currentHumanCaseRevision: null,
      currentRevision: 0,
      rightsDecision: null,
      rightsDecisionIsCurrent: false,
      requiresFreshHumanRightsReview: true,
      stalePreviousDecision: null,
      acknowledgedCurrentCaseRevision: false,
      readiness: QUARANTINE_RIGHTS_READINESS_INDICATORS,
      form: createEmptyRightsDecisionForm(),
      loading: false,
      saving: false,
      holdCode: null,
      loadError: null,
      saveError: null,
      lastSaveOutcome: null,
      conflictState: null,
      uncertainState: null,
      sessionToken: nextToken,
    });
  }

  public setAcknowledgedCurrentCaseRevision(acknowledged: boolean): void {
    if (
      !this.state.isExpanded ||
      this.state.loading ||
      this.state.saving ||
      this.state.holdCode !== null ||
      this.state.uncertainState !== null
    ) {
      return;
    }
    this.setState({
      acknowledgedCurrentCaseRevision: acknowledged === true,
      ...(this.state.saveError ===
      RIGHTS_DECISION_CLIENT_SAFE_ERRORS.UNACKNOWLEDGED_CASE_REVISION
        ? { saveError: null }
        : {}),
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

    if (!isSavedHumanCaseEligibleForRightsPanel(reviewCase)) {
      if (this.state.isExpanded) {
        this.resetPanel();
      }
      return;
    }

    // If the human review case revision changed while the rights panel is open,
    // detect version drift relative to the loaded effectiveCaseRevision (or catalogHandoffCaseRevision)
    const expectedAlignedCaseRevision =
      this.state.effectiveCaseRevision ?? this.state.catalogHandoffCaseRevision;
    if (
      this.state.isExpanded &&
      this.state.receiptId === reviewCase.receiptId &&
      expectedAlignedCaseRevision !== null &&
      reviewCase.revision !== expectedAlignedCaseRevision
    ) {
      this.setState({
        currentHumanCaseRevision: reviewCase.revision,
        holdCode: 'SOURCE_CASE_VERSION_DRIFT_HOLD',
        loadError:
          'SOURCE_CASE_VERSION_DRIFT_HOLD: Current human review case revision has drifted from the revision linked at catalog handoff; rights decision is held until human case/catalog realignment.',
      });
    }
  }

  public updateFormField<
    K extends keyof LibraryQuarantineRightsDecisionEditorialFields,
  >(field: K, value: LibraryQuarantineRightsDecisionEditorialFields[K]): void {
    if (
      !this.state.isExpanded ||
      this.state.loading ||
      this.state.saving ||
      this.state.holdCode !== null ||
      this.state.uncertainState !== null
    ) {
      return;
    }
    this.setState({
      form: Object.freeze({
        ...this.state.form,
        [field]: value,
      }),
      saveError: null,
      lastSaveOutcome: null,
    });
  }

  public async openPanelForCase(
    reviewCase: SanitizedLibraryQuarantineHumanReviewCaseDto
  ): Promise<GetLibraryQuarantineRightsDecisionResponseDto | null> {
    if (
      !this.state.rightsDecisionEnabled ||
      !canReviewLibraryQuarantineRights(this.currentUser) ||
      !isSavedHumanCaseEligibleForRightsPanel(reviewCase)
    ) {
      return null;
    }

    const nextToken = this.state.sessionToken + 1;
    const expectedUserId = this.currentUser?.id ?? null;
    const targetReceiptId = reviewCase.receiptId;
    const targetDocumentId = deriveQuarantineCatalogDocumentId(targetReceiptId);
    const isNewReceipt = this.state.receiptId !== targetReceiptId;

    this.setState({
      isExpanded: true,
      receiptId: targetReceiptId,
      documentId: targetDocumentId,
      currentHumanCaseRevision: reviewCase.revision,
      ...(isNewReceipt
        ? {
            sourceRevision: reviewCase.sourceRevision,
            catalogHandoffCaseRevision: null,
            effectiveCaseRevision: null,
            currentRevision: 0,
            rightsDecision: null,
            rightsDecisionIsCurrent: false,
            requiresFreshHumanRightsReview: true,
            stalePreviousDecision: null,
            acknowledgedCurrentCaseRevision: false,
            form: createEmptyRightsDecisionForm(),
            lastSaveOutcome: null,
          }
        : {}),
      loading: true,
      saving: false,
      holdCode: null,
      loadError: null,
      saveError: null,
      conflictState: null,
      uncertainState: null,
      sessionToken: nextToken,
    });

    return this.executeLoadDecision(targetReceiptId, nextToken, expectedUserId, {
      preserveSaveOutcome: false,
    });
  }

  public async verifyDecisionStatus(): Promise<GetLibraryQuarantineRightsDecisionResponseDto | null> {
    if (
      !this.state.isExpanded ||
      !this.state.receiptId ||
      this.state.loading ||
      this.state.saving
    ) {
      return null;
    }
    if (
      !this.state.rightsDecisionEnabled ||
      !canReviewLibraryQuarantineRights(this.currentUser)
    ) {
      this.resetPanel();
      return null;
    }

    const nextToken = this.state.sessionToken + 1;
    const expectedUserId = this.currentUser?.id ?? null;
    const targetReceiptId = this.state.receiptId;

    this.setState({
      loading: true,
      holdCode: null,
      loadError: null,
      saveError: null,
      lastSaveOutcome: null,
      conflictState: null,
      uncertainState: null,
      sessionToken: nextToken,
    });

    return this.executeLoadDecision(targetReceiptId, nextToken, expectedUserId, {
      preserveSaveOutcome: false,
    });
  }

  private async executeLoadDecision(
    targetReceiptId: string,
    activeToken: number,
    expectedUserId: string | null,
    options: { readonly preserveSaveOutcome: boolean }
  ): Promise<GetLibraryQuarantineRightsDecisionResponseDto | null> {
    try {
      const response = await this.getDecisionFn(targetReceiptId);

      if (
        !this.state.isExpanded ||
        this.state.sessionToken !== activeToken ||
        this.state.receiptId !== targetReceiptId ||
        (this.currentUser?.id ?? null) !== expectedUserId ||
        !canReviewLibraryQuarantineRights(this.currentUser)
      ) {
        return null;
      }

      if (!response.ok) {
        this.setState({
          loading: false,
          holdCode: response.errorCode,
          loadError: `${response.errorCode}: ${response.errorMessage}`,
          readiness: response.readiness,
        });
        return response;
      }

      const effectiveCaseRevision =
        response.effectiveCaseRevision ?? response.currentHumanCaseRevision;
      const isDecisionCurrent =
        response.rightsDecision !== null
          ? (response.rightsDecisionIsCurrent ??
            response.rightsDecision.currentHumanCaseRevision ===
              effectiveCaseRevision)
          : false;
      const requiresFreshReview =
        response.requiresFreshHumanRightsReview ?? !isDecisionCurrent;
      const stalePreviousDecision =
        response.rightsDecision !== null && !isDecisionCurrent
          ? response.rightsDecision
          : null;

      // Critical invariant: when a stored rights decision is stale for the current
      // aligned case revision (`!isDecisionCurrent`), the renewal form MUST open blank
      // (`createEmptyRightsDecisionForm()`) and NEVER prefill from the stale decision!
      const nextForm = isDecisionCurrent
        ? createFormFromSanitizedRightsDecision(response.rightsDecision)
        : createEmptyRightsDecisionForm();

      this.setState({
        documentId: response.documentId,
        sourceRevision: response.sourceRevision,
        catalogHandoffCaseRevision: response.catalogHandoffCaseRevision,
        effectiveCaseRevision,
        currentHumanCaseRevision: response.currentHumanCaseRevision,
        currentRevision: response.currentRevision,
        rightsDecision: response.rightsDecision,
        rightsDecisionIsCurrent: isDecisionCurrent,
        requiresFreshHumanRightsReview: requiresFreshReview,
        stalePreviousDecision,
        acknowledgedCurrentCaseRevision: false,
        readiness: response.readiness,
        form: nextForm,
        loading: false,
        holdCode: null,
        loadError: null,
        saveError: null,
        conflictState: null,
        uncertainState: null,
        ...(options.preserveSaveOutcome && isDecisionCurrent
          ? {}
          : { lastSaveOutcome: null }),
      });

      return response;
    } catch (err: unknown) {
      if (
        !this.state.isExpanded ||
        this.state.sessionToken !== activeToken ||
        this.state.receiptId !== targetReceiptId ||
        (this.currentUser?.id ?? null) !== expectedUserId
      ) {
        return null;
      }

      if (isRightsDecisionNotReleasedError(err)) {
        this.setState({
          loading: false,
          rightsDecisionEnabled: false,
          holdCode: 'RIGHTS_DECISION_NOT_RELEASED',
          loadError: RIGHTS_DECISION_CLIENT_SAFE_ERRORS.FEATURE_NOT_RELEASED,
        });
        return null;
      }

      const safeMessage =
        err instanceof Error &&
        (err.message ===
          RIGHTS_DECISION_CLIENT_SAFE_ERRORS.GET_RESPONSE_CONTRACT_INVALID ||
          err.message ===
            RIGHTS_DECISION_CLIENT_SAFE_ERRORS.DECISION_DTO_CONTRACT_INVALID ||
          err.message ===
            RIGHTS_DECISION_CLIENT_SAFE_ERRORS.BACKEND_UNAVAILABLE)
          ? err.message
          : RIGHTS_DECISION_CLIENT_SAFE_ERRORS.GET_CALL_FAILED;

      this.setState({
        loading: false,
        holdCode: 'GET_CALL_FAILED',
        loadError: safeMessage,
      });
      return null;
    }
  }

  public applyConflictServerVersion(): void {
    if (!this.state.isExpanded || !this.state.conflictState) {
      return;
    }
    const { serverRevision, serverDecision } = this.state.conflictState;
    const effectiveCaseRev =
      this.state.effectiveCaseRevision ??
      this.state.currentHumanCaseRevision ??
      this.state.catalogHandoffCaseRevision;
    const isCurrent =
      serverDecision !== null &&
      effectiveCaseRev !== null &&
      serverDecision.currentHumanCaseRevision === effectiveCaseRev;
    const stalePrev =
      serverDecision !== null && !isCurrent ? serverDecision : null;

    this.setState({
      currentRevision: serverRevision,
      rightsDecision: serverDecision,
      rightsDecisionIsCurrent: isCurrent,
      requiresFreshHumanRightsReview: !isCurrent,
      stalePreviousDecision: stalePrev,
      acknowledgedCurrentCaseRevision: false,
      form: isCurrent
        ? createFormFromSanitizedRightsDecision(serverDecision)
        : createEmptyRightsDecisionForm(),
      conflictState: null,
      saveError: null,
      lastSaveOutcome: null,
    });
  }

  public async saveDecision(): Promise<SaveLibraryQuarantineRightsDecisionResponseDto | null> {
    if (
      !this.state.isExpanded ||
      !this.state.receiptId ||
      this.state.loading ||
      this.state.saving ||
      this.state.holdCode !== null ||
      this.state.uncertainState !== null
    ) {
      return null;
    }

    if (
      !this.state.rightsDecisionEnabled ||
      !canReviewLibraryQuarantineRights(this.currentUser)
    ) {
      this.resetPanel();
      return null;
    }

    const effectiveCaseRev =
      this.state.effectiveCaseRevision ??
      this.state.currentHumanCaseRevision ??
      this.state.catalogHandoffCaseRevision;
    const requiresCaseRevisionAck =
      (effectiveCaseRev !== null &&
        this.state.catalogHandoffCaseRevision !== null &&
        effectiveCaseRev > this.state.catalogHandoffCaseRevision) ||
      this.state.stalePreviousDecision !== null;

    if (
      requiresCaseRevisionAck &&
      this.state.acknowledgedCurrentCaseRevision !== true
    ) {
      this.setState({
        saveError: RIGHTS_DECISION_CLIENT_SAFE_ERRORS.UNACKNOWLEDGED_CASE_REVISION,
        lastSaveOutcome: null,
      });
      return null;
    }

    let validatedEditorial: LibraryQuarantineRightsDecisionEditorialFields;
    try {
      validatedEditorial = validateClientRightsDecisionInput(this.state.form);
    } catch (validationErr: unknown) {
      const msg =
        validationErr instanceof Error
          ? validationErr.message
          : RIGHTS_DECISION_CLIENT_SAFE_ERRORS.INVALID_RIGHTS_INPUT;
      this.setState({
        saveError: msg,
        lastSaveOutcome: null,
      });
      return null;
    }

    const activeToken = this.state.sessionToken;
    const expectedUserId = this.currentUser?.id ?? null;
    const receiptId = this.state.receiptId;
    const expectedRevision = this.state.currentRevision;

    this.setState({
      saving: true,
      saveError: null,
      lastSaveOutcome: null,
      conflictState: null,
    });

    try {
      const response = await this.saveDecisionFn({
        receiptId,
        expectedRevision,
        ...((requiresCaseRevisionAck ||
          this.state.acknowledgedCurrentCaseRevision) &&
        effectiveCaseRev !== null
          ? { acknowledgedHumanCaseRevision: effectiveCaseRev }
          : {}),
        input: validatedEditorial,
      });

      if (
        !this.state.isExpanded ||
        this.state.sessionToken !== activeToken ||
        this.state.receiptId !== receiptId ||
        (this.currentUser?.id ?? null) !== expectedUserId ||
        !canReviewLibraryQuarantineRights(this.currentUser)
      ) {
        return null;
      }

      if (response.ok && response.status === 'SAVED') {
        const nextEffectiveCaseRev =
          response.effectiveCaseRevision ?? response.currentHumanCaseRevision;
        this.setState({
          saving: false,
          documentId: response.documentId,
          sourceRevision: response.sourceRevision,
          catalogHandoffCaseRevision: response.catalogHandoffCaseRevision,
          effectiveCaseRevision: nextEffectiveCaseRev,
          currentHumanCaseRevision: response.currentHumanCaseRevision,
          currentRevision: response.currentRevision,
          rightsDecision: response.rightsDecision,
          rightsDecisionIsCurrent: true,
          requiresFreshHumanRightsReview: false,
          stalePreviousDecision: null,
          acknowledgedCurrentCaseRevision: false,
          readiness: response.readiness,
          form: createFormFromSanitizedRightsDecision(response.rightsDecision),
          saveError: null,
          conflictState: null,
          uncertainState: null,
          lastSaveOutcome: response.decisionSaveOutcome,
        });

        this.onDecisionSaved?.(response.rightsDecision);

        // Fresh server readback after save so UI always reflects canonical stored state
        await this.executeLoadDecision(receiptId, activeToken, expectedUserId, {
          preserveSaveOutcome: true,
        });

        return response;
      }

      if (!response.ok && response.status === 'CONFLICT') {
        this.setState({
          saving: false,
          lastSaveOutcome: null,
          readiness: response.readiness,
          conflictState: Object.freeze({
            errorCode: response.errorCode,
            errorMessage: response.errorMessage,
            serverRevision: response.currentRevision,
            serverDecision: response.currentDecision,
          }),
        });
        return response;
      }

      if (
        !response.ok &&
        (response.status === 'UNKNOWN' || response.decisionSaved === null)
      ) {
        this.setState({
          saving: false,
          lastSaveOutcome: null,
          readiness: response.readiness,
          uncertainState: Object.freeze({
            errorCode: 'TRANSACTION_COMMIT_UNCERTAIN' as const,
            errorMessage: response.errorMessage,
            decisionSaveOutcome: 'UNKNOWN' as const,
            decisionSaved: null,
          }),
        });
        return response;
      }

      // status === 'HOLD'
      const shouldLockHold =
        response.errorCode === 'SOURCE_CASE_VERSION_DRIFT_HOLD' ||
        response.errorCode === 'CATALOG_HANDOFF_NOT_CREATED_HOLD';

      this.setState({
        saving: false,
        lastSaveOutcome: null,
        readiness: response.readiness,
        ...(shouldLockHold
          ? {
              holdCode: response.errorCode,
              loadError: `${response.errorCode}: ${response.errorMessage}`,
            }
          : {}),
        saveError: `${response.errorCode}: ${response.errorMessage}`,
      });
      return response;
    } catch (err: unknown) {
      if (
        !this.state.isExpanded ||
        this.state.sessionToken !== activeToken ||
        this.state.receiptId !== receiptId ||
        (this.currentUser?.id ?? null) !== expectedUserId
      ) {
        return null;
      }

      if (isRightsDecisionNotReleasedError(err)) {
        this.setState({
          saving: false,
          rightsDecisionEnabled: false,
          holdCode: 'RIGHTS_DECISION_NOT_RELEASED',
          saveError: RIGHTS_DECISION_CLIENT_SAFE_ERRORS.FEATURE_NOT_RELEASED,
        });
        return null;
      }

      if (
        err instanceof Error &&
        err.message === RIGHTS_DECISION_CLIENT_SAFE_ERRORS.BACKEND_UNAVAILABLE
      ) {
        this.setState({
          saving: false,
          lastSaveOutcome: null,
          saveError: RIGHTS_DECISION_CLIENT_SAFE_ERRORS.BACKEND_UNAVAILABLE,
        });
        return null;
      }

      // Any post-dispatch callable rejection or malformed response validation error
      // transitions to UNKNOWN (commit uncertain) requiring GET-only verification.
      const safeMessage =
        err instanceof Error &&
        (err.message ===
          RIGHTS_DECISION_CLIENT_SAFE_ERRORS.SAVE_RESPONSE_CONTRACT_INVALID ||
          err.message ===
            RIGHTS_DECISION_CLIENT_SAFE_ERRORS.DECISION_DTO_CONTRACT_INVALID)
          ? err.message
          : RIGHTS_DECISION_CLIENT_SAFE_ERRORS.SAVE_CALL_FAILED;

      this.setState({
        saving: false,
        lastSaveOutcome: null,
        saveError: null,
        uncertainState: Object.freeze({
          errorCode: 'TRANSACTION_COMMIT_UNCERTAIN' as const,
          errorMessage: safeMessage,
          decisionSaveOutcome: 'UNKNOWN' as const,
          decisionSaved: null,
        }),
      });
      return null;
    }
  }
}

export function getRightsDecisionStatusLabel(
  decision: LibraryQuarantineRightsDecisionStatus,
  isAr: boolean
): string {
  switch (decision) {
    case 'EVIDENCE_PENDING':
      return isAr
        ? 'بانتظار استكمال أدلة الحقوق'
        : 'Rights Evidence Pending';
    case 'PERMISSION_REQUIRED':
      return isAr
        ? 'يتطلب تصريحاً أو وثيقة إضافية'
        : 'Permission or Authorization Required';
    case 'METADATA_USE_CLEARED':
      return isAr
        ? 'مسموح باستخدام البيانات الوصفية فقط (لا يشمل نشر الملف)'
        : 'Metadata Use Cleared Only (Binary Publication Blocked)';
    case 'RESTRICTED':
      return isAr ? 'استخدام مقيد' : 'Restricted Use';
    case 'NOT_PERMITTED':
      return isAr
        ? 'غير مسموح بالاستخدام في هذا النطاق'
        : 'Not Permitted in Scope';
  }
}

export function getRightsBasisLabel(
  basis: LibraryQuarantineRightsBasis,
  isAr: boolean
): string {
  switch (basis) {
    case 'OFFICIAL_RECORD':
      return isAr
        ? 'سجل رسمي / وثيقة حكومية منشورة'
        : 'Official Government / Institutional Record';
    case 'OPEN_LICENSE':
      return isAr
        ? 'ترخيص مفتوح موثق'
        : 'Documented Open License';
    case 'EXPLICIT_PERMISSION_METADATA':
      return isAr
        ? 'تصريح خطي صريح للبيانات الوصفية'
        : 'Explicit Written Permission for Metadata';
    case 'PUBLIC_DOMAIN':
      return isAr ? 'ملكية عامة موثقة' : 'Documented Public Domain';
    case 'INTERNAL_ONLY':
      return isAr
        ? 'مرجع داخلي فقط (غير مخصص للنشر)'
        : 'Internal Reference Only';
    case 'UNDETERMINED':
      return isAr
        ? 'غير محدد بعد'
        : 'Undetermined / Under Investigation';
  }
}

export interface LibraryQuarantineRightsDecisionPanelProps {
  readonly controller: LibraryQuarantineRightsDecisionPanelController;
  readonly currentUser: AdminUser | null;
  readonly savedReviewCase: SanitizedLibraryQuarantineHumanReviewCaseDto | null;
  readonly hasUnsavedCaseEdits: boolean;
  readonly isAr: boolean;
}

export function LibraryQuarantineRightsDecisionPanel({
  controller,
  currentUser,
  savedReviewCase,
  hasUnsavedCaseEdits,
  isAr,
}: LibraryQuarantineRightsDecisionPanelProps) {
  const [snapshot, setSnapshot] =
    useState<LibraryQuarantineRightsDecisionPanelSnapshot>(() =>
      controller.getSnapshot()
    );

  useEffect(() => {
    setSnapshot(controller.getSnapshot());
    return controller.subscribe((next) => {
      setSnapshot(next);
    });
  }, [controller]);

  useEffect(() => {
    controller.setCurrentUser(currentUser);
  }, [controller, currentUser]);

  useEffect(() => {
    controller.syncWithSavedReviewCase(savedReviewCase);
  }, [controller, savedReviewCase]);

  const canReviewRights = canReviewLibraryQuarantineRights(currentUser);
  const isCaseEligible = isSavedHumanCaseEligibleForRightsPanel(savedReviewCase);

  // Auto-open or keep synchronized when eligible saved METADATA_RECORDED case is present
  useEffect(() => {
    if (
      snapshot.rightsDecisionEnabled &&
      canReviewRights &&
      isCaseEligible &&
      savedReviewCase &&
      !hasUnsavedCaseEdits &&
      (!snapshot.isExpanded || snapshot.receiptId !== savedReviewCase.receiptId)
    ) {
      void controller.openPanelForCase(savedReviewCase);
    }
  }, [
    controller,
    snapshot.rightsDecisionEnabled,
    snapshot.isExpanded,
    snapshot.receiptId,
    canReviewRights,
    isCaseEligible,
    savedReviewCase,
    hasUnsavedCaseEdits,
  ]);

  if (!snapshot.rightsDecisionEnabled || !canReviewRights || !savedReviewCase) {
    return null;
  }

  if (!isCaseEligible) {
    return null;
  }

  const targetDocumentId =
    snapshot.documentId ??
    deriveQuarantineCatalogDocumentId(savedReviewCase.receiptId);

  const effectiveCaseRev =
    snapshot.effectiveCaseRevision ??
    snapshot.currentHumanCaseRevision ??
    snapshot.catalogHandoffCaseRevision ??
    savedReviewCase.revision;

  const isStaleDecision = Boolean(
    snapshot.stalePreviousDecision !== null ||
      (!snapshot.rightsDecisionIsCurrent && snapshot.rightsDecision !== null)
  );

  const requiresCaseRevisionAck =
    (effectiveCaseRev !== null &&
      snapshot.catalogHandoffCaseRevision !== null &&
      effectiveCaseRev > snapshot.catalogHandoffCaseRevision) ||
    isStaleDecision;

  const isSaveBlocked =
    snapshot.loading ||
    snapshot.saving ||
    hasUnsavedCaseEdits ||
    snapshot.holdCode !== null ||
    snapshot.uncertainState !== null;

  const handleFormSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void controller.saveDecision();
  };

  return (
    <section
      data-testid="quarantine-rights-decision-panel"
      dir={isAr ? 'rtl' : 'ltr'}
      aria-label={
        isAr
          ? 'قرار المراجعة الحقوقية البشرية ودفتر الأدلة ومؤشرات الجاهزية'
          : 'Human Rights Review Decision, Evidence Ledger & Readiness Indicators'
      }
      className="px-6 py-5 border-t border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/20 text-xs space-y-4"
    >
      {/* Header & Single Open/Refresh Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Scale className="h-5 w-5 text-indigo-700 dark:text-indigo-400 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-extrabold text-gray-900 dark:text-white">
              {isAr
                ? 'قرار المراجعة الحقوقية البشرية ودفتر الأدلة (بيانات وصفية فقط)'
                : 'Human Rights Review Decision & Evidence Ledger (Metadata Scope Only)'}
            </h4>
            <p className="text-[11px] text-gray-600 dark:text-gray-300 mt-0.5">
              {isAr
                ? `السجل الداخلي المرتبط: ${targetDocumentId} — نطاق القرار ثابت على (${LIBRARY_QUARANTINE_RIGHTS_SCOPE}) ولا يعتمد سلامة الملف الثنائي أو نشره.`
                : `Linked internal draft: ${targetDocumentId} — Scope is fixed to (${LIBRARY_QUARANTINE_RIGHTS_SCOPE}) and never approves binary file safety or public publication.`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!snapshot.isExpanded ? (
            <button
              type="button"
              data-testid="open-quarantine-rights-decision-panel-btn"
              disabled={hasUnsavedCaseEdits || snapshot.loading}
              onClick={() => {
                void controller.openPanelForCase(savedReviewCase);
              }}
              className="px-3.5 py-2 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-bold text-xs cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <Scale className="h-3.5 w-3.5" />
              <span>
                {isAr
                  ? 'فتح مراجعة الحقوق والأدلة'
                  : 'Open Rights Review & Evidence'}
              </span>
            </button>
          ) : (
            <button
              type="button"
              data-testid="reload-quarantine-rights-decision-btn"
              disabled={snapshot.loading || snapshot.saving}
              onClick={() => {
                void controller.verifyDecisionStatus();
              }}
              className="px-3 py-1.5 rounded-xl border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-gray-700 text-indigo-800 dark:text-indigo-200 font-bold text-[11px] cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>
                {isAr ? 'تحديث سجل الحقوق' : 'Refresh Rights Record'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Constant Internal Library Readiness & Safety Indicators (Always Visible) */}
      <div
        data-testid="quarantine-rights-readiness-indicators"
        className="p-3.5 rounded-xl bg-amber-50/90 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 space-y-2"
      >
        <div className="flex items-center gap-2 font-extrabold text-amber-950 dark:text-amber-200">
          <ShieldAlert className="h-4 w-4 text-amber-700 dark:text-amber-400 shrink-0" />
          <span>
            {isAr
              ? 'مؤشرات جاهزية المكتبة الداخلية وحدود الأمان والنشر (ثابتة في هذه المرحلة)'
              : 'Internal Library Readiness & Publication Safety Indicators (Constant Blocking Posture)'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-[11px]">
          <div
            data-testid="readiness-indicator-rights-scope"
            className="p-2 rounded-lg bg-white/90 dark:bg-gray-900/70 border border-amber-200/80 dark:border-amber-800/50"
          >
            <span className="text-gray-500 dark:text-gray-400 block">
              {isAr ? 'نطاق قرار الحقوق:' : 'Rights Decision Scope:'}
            </span>
            <span className="font-mono font-bold text-indigo-800 dark:text-indigo-300">
              {LIBRARY_QUARANTINE_RIGHTS_SCOPE}
            </span>
          </div>

          <div
            data-testid="readiness-indicator-binary-safety"
            className="p-2 rounded-lg bg-white/90 dark:bg-gray-900/70 border border-amber-200/80 dark:border-amber-800/50"
          >
            <span className="text-gray-500 dark:text-gray-400 block">
              {isAr ? 'سلامة الملف الثنائي والتطهير:' : 'Binary Safety & Sanitization:'}
            </span>
            <span className="font-mono font-bold text-red-700 dark:text-red-400">
              {snapshot.readiness.binarySafety} /{' '}
              {snapshot.readiness.fileSanitization}
            </span>
          </div>

          <div
            data-testid="readiness-indicator-publication"
            className="p-2 rounded-lg bg-white/90 dark:bg-gray-900/70 border border-amber-200/80 dark:border-amber-800/50"
          >
            <span className="text-gray-500 dark:text-gray-400 block">
              {isAr ? 'حالة النشر العام وتوزيع الملف:' : 'Public Publication & File Release:'}
            </span>
            <span className="font-mono font-bold text-red-700 dark:text-red-400">
              {snapshot.readiness.publication}
            </span>
          </div>

          <div
            data-testid="readiness-indicator-catalog-workflow"
            className="p-2 rounded-lg bg-white/90 dark:bg-gray-900/70 border border-amber-200/80 dark:border-amber-800/50"
          >
            <span className="text-gray-500 dark:text-gray-400 block">
              {isAr ? 'حالة مسودة الفهرس:' : 'Catalog Draft Workflow:'}
            </span>
            <span className="font-mono font-bold text-gray-800 dark:text-gray-200">
              {snapshot.readiness.catalogWorkflow} (ReviewRequired)
            </span>
          </div>
        </div>

        <p className="text-[11px] text-amber-900 dark:text-amber-300 leading-relaxed">
          {isAr
            ? 'تنبيه حاكم: حتى عند اختيار «METADATA_USE_CLEARED»، يقتصر الاعتماد على البيانات الوصفية النصية داخل المسودة الداخلية (qcat-)، ويظل نشر ملف PDF/DOCX محظوراً (publication: BLOCKED) لأن سلامة البنية الثنائية غير معتمدة (binarySafety: NOT_VERIFIED).'
            : 'Governing Notice: Even when METADATA_USE_CLEARED is recorded, clearance applies strictly to descriptive catalog metadata on the internal qcat- draft. Binary PDF/DOCX publication remains BLOCKED (publication: BLOCKED) and binary safety remains unverified (binarySafety: NOT_VERIFIED).'}
        </p>
      </div>

      {/* Unsaved Human Review Case Edits Warning */}
      {hasUnsavedCaseEdits && (
        <div
          role="alert"
          data-testid="rights-decision-unsaved-case-edits-warning"
          className="p-3 rounded-xl bg-amber-100/80 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 text-amber-950 dark:text-amber-200 flex items-center gap-2 font-semibold"
        >
          <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />
          <span>
            {isAr
              ? 'يوجد تعديل غير محفوظ في نموذج المراجعة البشرية أعلاه؛ احفظ أو حدّث سجل المراجعة البشرية أولاً قبل تسجيل قرار الحقوق.'
              : 'There are unsaved edits in the human review case form above; save or refresh the human review case first before recording a rights decision.'}
          </span>
        </div>
      )}

      {/* Loading Indicator */}
      {snapshot.isExpanded && snapshot.loading && (
        <div
          data-testid="quarantine-rights-decision-loading"
          className="py-5 flex items-center justify-center gap-2.5 text-gray-600 dark:text-gray-300 font-semibold"
        >
          <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
          <span>
            {isAr
              ? 'جاري التحقق من مسودة الفهرس وسجل قرار الحقوق...'
              : 'Verifying catalog draft provenance and loading rights decision...'}
          </span>
        </div>
      )}

      {/* Prerequisite Hold: Catalog Handoff Not Created Yet */}
      {snapshot.isExpanded &&
        !snapshot.loading &&
        snapshot.holdCode === 'CATALOG_HANDOFF_NOT_CREATED_HOLD' && (
          <div
            role="status"
            data-testid="quarantine-rights-handoff-prerequisite-notice"
            className="p-4 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-950 dark:text-blue-200 space-y-1.5"
          >
            <div className="flex items-center gap-2 font-extrabold">
              <Lock className="h-4 w-4 text-blue-700 dark:text-blue-400 shrink-0" />
              <span>
                {isAr
                  ? 'أنشئ مسودة المكتبة أولًا بواسطة المحرر المخوّل'
                  : 'Create the internal library draft first via an authorized curator'}
              </span>
            </div>
            <p className="text-[11px] leading-relaxed">
              {isAr
                ? `لم يتم بعد إنشاء مسودة المكتبة الداخلية (${targetDocumentId}) لهذا الإيصال. يتطلب تسجيل القرار الحقوقي وجود مسودة فهرس داخلية مرتبطة ينشئها محرر المكتبة المخوّل (صلاحية Review + Create).`
                : `Internal catalog draft (${targetDocumentId}) has not been created yet for this receipt. Recording a rights decision requires an existing linked catalog draft created by an authorized Library Curator (Review + Create).`}
            </p>
          </div>
        )}

      {/* Source / Case Version Drift Hold */}
      {snapshot.isExpanded &&
        !snapshot.loading &&
        snapshot.holdCode === 'SOURCE_CASE_VERSION_DRIFT_HOLD' && (
          <div
            role="alert"
            data-testid="quarantine-rights-version-drift-hold-banner"
            className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-900 dark:text-red-200 space-y-1.5"
          >
            <div className="flex items-center gap-2 font-extrabold">
              <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
              <span>
                {isAr
                  ? 'تعليق بسبب اختلاف نسخة المراجعة البشرية عن نسخة الفهرس (SOURCE_CASE_VERSION_DRIFT_HOLD)'
                  : 'Hold: Human Review Case Version Drift Detected (SOURCE_CASE_VERSION_DRIFT_HOLD)'}
              </span>
            </div>
            <p className="text-[11px] leading-relaxed">
              {isAr
                ? 'تم تعديل ملف المراجعة البشرية بعد إنشاء مسودة الفهرس (qcat-). لا يعتمد القرار الحقوقي ضمنياً نسخاً متعارضة ولا يعيد مواءمة الفهرس تلقائياً في هذه الحزمة؛ يرجى انتظار مسار إعادة المواءمة البشرية المستقبلي.'
                : 'The human review case was modified after the internal catalog draft (qcat-) was created. Rights decisions never implicitly endorse drifted versions or auto-reconcile catalog handoffs in this unit; human realignment is required.'}
            </p>
          </div>
        )}

      {/* Generic Load / Prerequisite Hold Error */}
      {snapshot.isExpanded &&
        !snapshot.loading &&
        snapshot.loadError &&
        snapshot.holdCode !== 'CATALOG_HANDOFF_NOT_CREATED_HOLD' &&
        snapshot.holdCode !== 'SOURCE_CASE_VERSION_DRIFT_HOLD' && (
          <div
            role="alert"
            data-testid="quarantine-rights-decision-load-error"
            className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 flex items-start gap-2.5"
          >
            <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-bold">
                {isAr
                  ? 'تعذر فتح نموذج القرار الحقوقي لهذا السجل'
                  : 'Cannot open rights decision form for this record'}
              </div>
              <div className="font-mono text-[11px] break-all">
                {snapshot.loadError}
              </div>
            </div>
          </div>
        )}

      {/* Commit Uncertainty Hold Banner (UNKNOWN / decisionSaved: null) */}
      {snapshot.isExpanded && snapshot.uncertainState && (
        <div
          role="alert"
          data-testid="quarantine-rights-decision-uncertain-banner"
          className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/50 border-2 border-amber-400 dark:border-amber-700 text-amber-950 dark:text-amber-200 space-y-2.5"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-extrabold">
                {isAr
                  ? 'حالة التزام المعاملة غير مؤكدة (UNKNOWN — decisionSaved: null)'
                  : 'Transaction Commit Outcome Uncertain (UNKNOWN — decisionSaved: null)'}
              </div>
              <p className="text-[11px] leading-relaxed">
                {isAr
                  ? 'انقطع تأكيد الخادم بعد بدء معاملة حفظ القرار الحقوقي. لمنع الكتابة المكررة، تم إيقاف الحفظ التلقائي؛ اضغط «تحقق من القرار» لقراءة الحالة الفعلية من الخادم أولاً.'
                  : 'Server commit acknowledgement was lost after staging the rights decision transaction. Automatic retry is disabled; click "Verify decision" to read the authoritative server state first.'}
              </p>
              <div className="font-mono text-[11px]">
                {snapshot.uncertainState.errorCode}:{' '}
                {snapshot.uncertainState.errorMessage}
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              data-testid="verify-quarantine-rights-decision-btn"
              disabled={snapshot.loading || snapshot.saving}
              onClick={() => {
                void controller.verifyDecisionStatus();
              }}
              className="px-3.5 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-extrabold text-xs cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>
                {isAr
                  ? 'تحقق من القرار (قراءة فقط)'
                  : 'Verify decision (read-only)'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* CAS Revision Conflict Banner */}
      {snapshot.isExpanded && snapshot.conflictState && (
        <div
          role="alert"
          data-testid="quarantine-rights-decision-conflict-banner"
          className="p-4 rounded-xl bg-orange-50 dark:bg-orange-950/50 border border-orange-300 dark:border-orange-800 text-orange-950 dark:text-orange-200 space-y-2.5"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-orange-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-extrabold">
                {isAr
                  ? `تعارض في نسخة قرار الحقوق (النسخة الخادمية الحالية: ${snapshot.conflictState.serverRevision})`
                  : `Rights Decision Revision Conflict (Current server revision: ${snapshot.conflictState.serverRevision})`}
              </div>
              <p className="text-[11px]">
                {snapshot.conflictState.errorMessage}
              </p>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              data-testid="apply-conflict-rights-decision-btn"
              onClick={() => controller.applyConflictServerVersion()}
              className="px-3.5 py-1.5 rounded-xl bg-orange-700 hover:bg-orange-800 text-white font-bold text-xs cursor-pointer"
            >
              {isAr
                ? 'اعتماد النسخة الخادمية الأحدث في النموذج'
                : 'Load latest server revision into form'}
            </button>
          </div>
        </div>
      )}

      {/* Save Error Banner */}
      {snapshot.isExpanded && snapshot.saveError && (
        <div
          role="alert"
          data-testid="quarantine-rights-decision-save-error"
          className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 flex items-center gap-2 font-semibold"
        >
          <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
          <span className="break-all">{snapshot.saveError}</span>
        </div>
      )}

      {/* Save Success Banner */}
      {snapshot.isExpanded &&
        snapshot.lastSaveOutcome &&
        snapshot.rightsDecision && (
          <div
            role="status"
            data-testid="quarantine-rights-decision-saved-banner"
            className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 flex items-start gap-2.5"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-extrabold">
                {snapshot.lastSaveOutcome === 'CREATED'
                  ? isAr
                    ? `تم تسجيل القرار الحقوقي الأولي (النسخة ${snapshot.currentRevision}) بنطاق البيانات الوصفية فقط.`
                    : `Recorded initial human rights decision (Revision ${snapshot.currentRevision}) for metadata scope only.`
                  : isAr
                    ? `تم تحديث القرار الحقوقي (النسخة ${snapshot.currentRevision}) بنطاق البيانات الوصفية فقط.`
                    : `Updated human rights decision (Revision ${snapshot.currentRevision}) for metadata scope only.`}
              </div>
              <div className="text-[11px]">
                {isAr
                  ? `الحالة المسجلة: ${snapshot.rightsDecision.decision} — الأساس: ${snapshot.rightsDecision.basis} — النشر العام للملف: ${snapshot.readiness.publication} — سلامة الملف الثنائي: ${snapshot.readiness.binarySafety}.`
                  : `Recorded decision: ${snapshot.rightsDecision.decision} — Basis: ${snapshot.rightsDecision.basis} — Binary publication: ${snapshot.readiness.publication} — Binary safety: ${snapshot.readiness.binarySafety}.`}
              </div>
            </div>
          </div>
        )}

      {/* Stale Previous Decision Banner (When case was aligned to a newer revision) */}
      {snapshot.isExpanded &&
        !snapshot.loading &&
        snapshot.holdCode === null &&
        isStaleDecision && (
          <div
            role="status"
            data-testid="quarantine-rights-decision-stale-previous-banner"
            className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 text-amber-950 dark:text-amber-200 space-y-2"
          >
            <div className="flex items-center gap-2 font-extrabold text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-400 shrink-0" />
              <span>
                {isAr
                  ? 'قرار حقوق سابق — غير سارٍ للنسخة الحالية من ملف المراجعة'
                  : 'Previous rights decision — not effective for current case'}
              </span>
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100 font-bold">
                Previous / Not Effective
              </span>
            </div>
            <p className="text-[11px] leading-relaxed">
              {isAr
                ? `صدر القرار الحقوقي السابق للنسخة #${(snapshot.stalePreviousDecision ?? snapshot.rightsDecision)?.currentHumanCaseRevision}، بينما مسودة الفهرس المعتمدة الحالية مواءمة مع النسخة #${effectiveCaseRev}. يتطلب النظام إقراراً بالنسخة الحالية وإعادة تقييم حقوقي مستقل وكتابة الحقول من جديد دون تعبئة تلقائية.`
                : `The previous rights decision was recorded for review case revision #${(snapshot.stalePreviousDecision ?? snapshot.rightsDecision)?.currentHumanCaseRevision}, whereas the current catalog draft is aligned with review case revision #${effectiveCaseRev}. A fresh independent evaluation must be entered manually with explicit acknowledgment of the current case revision.`}
            </p>
            <div className="text-[10px] font-mono text-amber-800 dark:text-amber-300">
              {isAr ? 'القرار المحفوظ السابق: ' : 'Previous saved decision: '}
              {(snapshot.stalePreviousDecision ?? snapshot.rightsDecision)?.decision} | {isAr ? 'الأساس: ' : 'Basis: '}
              {(snapshot.stalePreviousDecision ?? snapshot.rightsDecision)?.basis} | {isAr ? 'المرجع: ' : 'Ref: '}
              {(snapshot.stalePreviousDecision ?? snapshot.rightsDecision)?.evidenceReference}
            </div>
          </div>
        )}

      {/* Editable Rights Decision & Evidence Form (Only when expanded, loaded, and not held) */}
      {snapshot.isExpanded &&
        !snapshot.loading &&
        snapshot.holdCode === null && (
          <form
            data-testid="quarantine-rights-decision-form"
            onSubmit={handleFormSubmit}
            className="space-y-3.5 pt-1"
          >
            {/* Current Stored Metadata Summary */}
            <div
              data-testid="quarantine-rights-decision-meta-bar"
              className="p-2.5 rounded-xl bg-white dark:bg-gray-900 border border-indigo-200/80 dark:border-indigo-900/60 flex flex-wrap items-center justify-between gap-2 text-[11px]"
            >
              <div className="flex items-center gap-2 font-semibold text-gray-700 dark:text-gray-300">
                <FileCheck2 className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                <span>
                  {snapshot.currentRevision === 0
                    ? isAr
                      ? 'لا يوجد قرار حقوقي محفوظ بعد (سيتم إنشاء النسخة 1)'
                      : 'No rights decision saved yet (will create revision 1)'
                    : isStaleDecision
                      ? isAr
                        ? `النسخة السابقة: ${snapshot.currentRevision} (غير سارية — يتطلب مراجعة جديدة للنسخة #${effectiveCaseRev})`
                        : `Previous revision: ${snapshot.currentRevision} (Not effective — renewal required for case #${effectiveCaseRev})`
                      : isAr
                        ? `النسخة المحفوظة الحالية: ${snapshot.currentRevision} (${snapshot.rightsDecision?.decision ?? ''})`
                        : `Current saved revision: ${snapshot.currentRevision} (${snapshot.rightsDecision?.decision ?? ''})`}
                </span>
              </div>

              <div className="font-mono text-gray-500 dark:text-gray-400">
                {isAr
                  ? `مراجعة المصدر: #${snapshot.sourceRevision ?? savedReviewCase.sourceRevision} | نسخة المراجعة البشرية المرتبطة: #${snapshot.catalogHandoffCaseRevision ?? savedReviewCase.revision} | النسخة الفعالة: #${effectiveCaseRev}`
                  : `Source rev: #${snapshot.sourceRevision ?? savedReviewCase.sourceRevision} | Linked case rev: #${snapshot.catalogHandoffCaseRevision ?? savedReviewCase.revision} | Effective rev: #${effectiveCaseRev}`}
              </div>
            </div>

            {/* Decision Status & Basis */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label
                  htmlFor="rights-decision-status-select"
                  className="block font-bold text-gray-800 dark:text-gray-200"
                >
                  {isAr
                    ? 'حكم مراجعة الحقوق (نطاق البيانات الوصفية فقط)'
                    : 'Rights Review Decision (Metadata Scope Only)'}
                </label>
                <select
                  id="rights-decision-status-select"
                  data-testid="rights-decision-status-select"
                  disabled={isSaveBlocked}
                  value={snapshot.form.decision}
                  onChange={(e) =>
                    controller.updateFormField(
                      'decision',
                      e.target.value as LibraryQuarantineRightsDecisionStatus
                    )
                  }
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {LIBRARY_QUARANTINE_RIGHTS_DECISION_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {getRightsDecisionStatusLabel(st, isAr)} ({st})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="rights-decision-basis-select"
                  className="block font-bold text-gray-800 dark:text-gray-200"
                >
                  {isAr
                    ? 'الأساس الحقوقي والنظامي الموثق'
                    : 'Documented Legal / Rights Basis'}
                </label>
                <select
                  id="rights-decision-basis-select"
                  data-testid="rights-decision-basis-select"
                  disabled={isSaveBlocked}
                  value={snapshot.form.basis}
                  onChange={(e) =>
                    controller.updateFormField(
                      'basis',
                      e.target.value as LibraryQuarantineRightsBasis
                    )
                  }
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {LIBRARY_QUARANTINE_RIGHTS_BASES.map((b) => (
                    <option key={b} value={b}>
                      {getRightsBasisLabel(b, isAr)} ({b})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Evidence Reference (Single-line plain text, no URLs) */}
            <div className="space-y-1">
              <label
                htmlFor="rights-decision-evidence-reference"
                className="block font-bold text-gray-800 dark:text-gray-200"
              >
                {isAr
                  ? 'مرجع الدليل أو رقم التصريح / السجل الرسمي (نص عادي بدون روابط)'
                  : 'Evidence Reference / Permit or Official Record Number (Plain text, no URLs)'}
              </label>
              <input
                id="rights-decision-evidence-reference"
                data-testid="rights-decision-evidence-reference-input"
                type="text"
                maxLength={RIGHTS_DECISION_EVIDENCE_REFERENCE_MAX_LENGTH}
                disabled={isSaveBlocked}
                value={snapshot.form.evidenceReference}
                onChange={(e) =>
                  controller.updateFormField(
                    'evidenceReference',
                    e.target.value
                  )
                }
                placeholder={
                  isAr
                    ? 'مثال: الجريدة الرسمية العدد 4210 / تصريح metadata رقم PR-2026-14...'
                    : 'e.g., Official Gazette Issue 4210 / Metadata Permit Ref PR-2026-14...'
                }
                className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Evidence Notes & Reviewer Notes */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label
                  htmlFor="rights-decision-evidence-notes"
                  className="block font-bold text-gray-800 dark:text-gray-200"
                >
                  {isAr
                    ? 'تفاصيل الدليل الحقوقي ونطاق الاستخدام المسموح'
                    : 'Rights Evidence Details & Permitted Metadata Scope'}
                </label>
                <textarea
                  id="rights-decision-evidence-notes"
                  data-testid="rights-decision-evidence-notes-input"
                  rows={3}
                  maxLength={RIGHTS_DECISION_NOTES_MAX_LENGTH}
                  disabled={isSaveBlocked}
                  value={snapshot.form.evidenceNotes}
                  onChange={(e) =>
                    controller.updateFormField('evidenceNotes', e.target.value)
                  }
                  placeholder={
                    isAr
                      ? 'اشرح الدليل الموثق وحدود السماح باستخدام البيانات الوصفية داخل الفهرس...'
                      : 'Document the verified evidence and scope of permitted catalog metadata usage...'
                  }
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="rights-decision-review-notes"
                  className="block font-bold text-gray-800 dark:text-gray-200"
                >
                  {isAr
                    ? 'ملاحظات مراجع الحقوق والقيود الإضافية'
                    : 'Rights Reviewer Notes & Restrictions'}
                </label>
                <textarea
                  id="rights-decision-review-notes"
                  data-testid="rights-decision-review-notes-input"
                  rows={3}
                  maxLength={RIGHTS_DECISION_NOTES_MAX_LENGTH}
                  disabled={isSaveBlocked}
                  value={snapshot.form.reviewNotes}
                  onChange={(e) =>
                    controller.updateFormField('reviewNotes', e.target.value)
                  }
                  placeholder={
                    isAr
                      ? 'ملاحظات التقييد أو سبب المنع أو المتطلبات المتبقية...'
                      : 'Restriction justification, denial reason, or remaining requirements...'
                  }
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* Case Revision Acknowledgment Checkbox (When aligned to a newer case revision or when stale decision exists) */}
            {requiresCaseRevisionAck && (
              <div
                data-testid="quarantine-rights-acknowledge-case-revision-box"
                className="p-3 rounded-xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 space-y-1.5"
              >
                <label
                  htmlFor="acknowledge-current-case-revision-checkbox"
                  className="flex items-start gap-2.5 cursor-pointer text-[12px] font-bold text-indigo-950 dark:text-indigo-200"
                >
                  <input
                    type="checkbox"
                    id="acknowledge-current-case-revision-checkbox"
                    data-testid="acknowledge-current-case-revision-checkbox"
                    disabled={isSaveBlocked}
                    checked={snapshot.acknowledgedCurrentCaseRevision}
                    onChange={(e) =>
                      controller.setAcknowledgedCurrentCaseRevision(e.target.checked)
                    }
                    className="mt-0.5 h-4 w-4 rounded border-indigo-400 text-indigo-600 focus:ring-indigo-500 cursor-pointer shrink-0"
                  />
                  <span>
                    {isAr
                      ? `أقر بأنني راجعت التعديلات المعتمدة في ملف المراجعة البشرية للنسخة #${effectiveCaseRev}، وأن هذا القرار الحقوقي يصدر كتقييم جديد ومستقل لهذه النسخة تحديداً.`
                      : `I acknowledge that I have reviewed the human review case metadata for effective revision #${effectiveCaseRev}, and that this rights decision is submitted as a fresh, independent evaluation for this revision.`}
                  </span>
                </label>
              </div>
            )}

            {/* Single Save Button */}
            <div className="flex items-center justify-between gap-3 pt-2">
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {snapshot.form.decision === 'METADATA_USE_CLEARED'
                  ? isAr
                    ? 'يتطلب هذا القرار أساساً محدداً (غير UNDETERMINED) ومرجع دليل نصي وملاحظات تشرح نطاق الاستخدام.'
                    : 'Requires a determined basis (not UNDETERMINED), non-empty evidence reference, and non-empty evidence scope notes.'
                  : snapshot.form.decision === 'RESTRICTED' ||
                      snapshot.form.decision === 'NOT_PERMITTED'
                    ? isAr
                      ? 'يتطلب هذا القرار تدوين سبب واضح في حقل الدليل أو ملاحظات مراجع الحقوق.'
                      : 'Requires clear justification in evidence notes or reviewer notes.'
                    : isAr
                      ? 'أدخل مرجع الدليل أو ملاحظة واحدة على الأقل لحفظ سجل الحقوق.'
                      : 'Enter at least one evidence reference or note field to save.'}
              </p>

              <button
                type="submit"
                data-testid="save-quarantine-rights-decision-btn"
                disabled={isSaveBlocked}
                className="px-4 py-2.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-extrabold text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5 shrink-0 shadow-sm"
              >
                {snapshot.saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                ) : (
                  <Scale className="h-3.5 w-3.5 shrink-0" />
                )}
                <span>
                  {snapshot.saving
                    ? isAr
                      ? 'جاري حفظ قرار الحقوق...'
                      : 'Saving rights decision...'
                    : isAr
                      ? 'حفظ قرار الحقوق (بيانات وصفية فقط)'
                      : 'Save Rights Decision (Metadata Only)'}
                </span>
              </button>
            </div>
          </form>
        )}
    </section>
  );
}
