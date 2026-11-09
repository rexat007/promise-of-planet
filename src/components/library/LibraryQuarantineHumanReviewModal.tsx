import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Lock,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { AdminUser } from '../../types/admin';
import type { SanitizedLibraryQuarantineAdminReceiptDto } from '../../services/libraryAdminClient';
import {
  HUMAN_REVIEW_CLIENT_SAFE_ERRORS,
  HUMAN_REVIEW_NOTES_MAX_LENGTH,
  HUMAN_REVIEW_ORGANIZATION_MAX_LENGTH,
  HUMAN_REVIEW_TITLE_MAX_LENGTH,
  LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_STATUSES,
  LibraryQuarantineHumanReviewClient,
  canOpenLibraryQuarantineHumanReviewCase,
  isHumanCaseReviewNotReleasedError,
  isLibraryQuarantineHumanReviewEnabled,
  validateClientHumanReviewEditorialInput,
  type GetLibraryQuarantineHumanReviewCaseResponseDto,
  type LibraryQuarantineHumanReviewCaseStatus,
  type LibraryQuarantineHumanReviewEditorialFields,
  type SanitizedLibraryQuarantineHumanReviewCaseDto,
  type SaveLibraryQuarantineHumanReviewCaseEditorialInput,
  type SaveLibraryQuarantineHumanReviewCaseResponseDto,
} from '../../services/libraryQuarantineHumanReviewClient';

/**
 * LIB-FILE-HUMAN-CASEWORK-01 — Human Review Case Modal & State Controller
 *
 * ARCHITECTURAL & SECURITY BOUNDARY:
 * - Single bounded modal opened from the existing Admin Library Intake Inbox
 *   for `Quarantined` receipts whose review draft status is `PENDING_HUMAN_REVIEW`.
 * - Displays sanitized administrative receipt metadata ONLY. Never renders or
 *   fetches raw PDF/DOCX binaries, `storagePath`, `generation`, `gs://` URIs,
 *   signed URLs, or download links.
 * - Allows authorized human Library reviewers (`AdminPermission.Review`) to record
 *   and update bilingual titles, issuing organization, editorial summaries,
 *   source evidence notes, rights evidence notes, reviewer notes, and preliminary
 *   triage status: `IN_REVIEW | NEEDS_INFORMATION | METADATA_RECORDED | NOT_SUITABLE`.
 * - `METADATA_RECORDED` records preliminary descriptive metadata ONLY and never
 *   implies binary sanitization, active-content safety, rights approval, PEIA
 *   readiness, or public publication.
 * - Enforces compare-and-swap (`expectedRevision`), duplicate-click lock, fresh
 *   server readback after save, explicit conflict resolution banner (`CONFLICT`),
 *   and fail-closed commit uncertainty hold (`UNKNOWN` / `caseSaved: null`) with
 *   manual verification («تحقق من السجل / Verify case record») and zero auto-retry.
 */

export interface LibraryQuarantineHumanReviewConflictState {
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly serverRevision: number;
  readonly serverCase: SanitizedLibraryQuarantineHumanReviewCaseDto | null;
}

export interface LibraryQuarantineHumanReviewUncertainState {
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly caseSaveOutcome: 'UNKNOWN';
  readonly caseSaved: null;
}

export interface LibraryQuarantineHumanReviewModalSnapshot {
  readonly isOpen: boolean;
  readonly humanReviewEnabled: boolean;
  readonly activeReceipt: SanitizedLibraryQuarantineAdminReceiptDto | null;
  readonly sourceRevision: number | null;
  readonly currentRevision: number;
  readonly reviewCase: SanitizedLibraryQuarantineHumanReviewCaseDto | null;
  readonly form: LibraryQuarantineHumanReviewEditorialFields;
  readonly loading: boolean;
  readonly saving: boolean;
  readonly loadError: string | null;
  readonly saveError: string | null;
  readonly lastSaveOutcome: 'CREATED' | 'UPDATED' | null;
  readonly conflictState: LibraryQuarantineHumanReviewConflictState | null;
  readonly uncertainState: LibraryQuarantineHumanReviewUncertainState | null;
  readonly sessionToken: number;
}

export function createEmptyHumanReviewEditorialForm(): LibraryQuarantineHumanReviewEditorialFields {
  return Object.freeze({
    status: 'IN_REVIEW' as const,
    titleAr: '',
    titleEn: '',
    issuingOrganization: '',
    summaryAr: '',
    summaryEn: '',
    sourceEvidenceNotes: '',
    rightsEvidenceNotes: '',
    editorialNotes: '',
  });
}

export function createFormFromSanitizedHumanReviewCase(
  reviewCase: SanitizedLibraryQuarantineHumanReviewCaseDto | null
): LibraryQuarantineHumanReviewEditorialFields {
  if (!reviewCase) {
    return createEmptyHumanReviewEditorialForm();
  }
  return Object.freeze({
    status: reviewCase.status,
    titleAr: reviewCase.titleAr,
    titleEn: reviewCase.titleEn,
    issuingOrganization: reviewCase.issuingOrganization,
    summaryAr: reviewCase.summaryAr,
    summaryEn: reviewCase.summaryEn,
    sourceEvidenceNotes: reviewCase.sourceEvidenceNotes,
    rightsEvidenceNotes: reviewCase.rightsEvidenceNotes,
    editorialNotes: reviewCase.editorialNotes,
  });
}

export interface LibraryQuarantineHumanReviewControllerOptions {
  readonly humanReviewEnabled?: boolean;
  readonly getCaseFn?: (
    receiptId: string
  ) => Promise<GetLibraryQuarantineHumanReviewCaseResponseDto>;
  readonly saveCaseFn?: (params: {
    readonly receiptId: string;
    readonly expectedRevision: number;
    readonly input: SaveLibraryQuarantineHumanReviewCaseEditorialInput;
  }) => Promise<SaveLibraryQuarantineHumanReviewCaseResponseDto>;
  readonly onCaseSaved?: (
    savedCase: SanitizedLibraryQuarantineHumanReviewCaseDto
  ) => void;
}

export class LibraryQuarantineHumanReviewModalController {
  private currentUser: AdminUser | null;
  private getCaseFn: (
    receiptId: string
  ) => Promise<GetLibraryQuarantineHumanReviewCaseResponseDto>;
  private saveCaseFn: (params: {
    readonly receiptId: string;
    readonly expectedRevision: number;
    readonly input: SaveLibraryQuarantineHumanReviewCaseEditorialInput;
  }) => Promise<SaveLibraryQuarantineHumanReviewCaseResponseDto>;
  private onCaseSaved?: (
    savedCase: SanitizedLibraryQuarantineHumanReviewCaseDto
  ) => void;
  private state: LibraryQuarantineHumanReviewModalSnapshot;
  private readonly listeners = new Set<
    (snapshot: LibraryQuarantineHumanReviewModalSnapshot) => void
  >();

  constructor(
    currentUser: AdminUser | null,
    options?: LibraryQuarantineHumanReviewControllerOptions
  ) {
    this.currentUser = currentUser;
    this.getCaseFn =
      options?.getCaseFn ??
      ((receiptId) =>
        LibraryQuarantineHumanReviewClient.getQuarantineHumanReviewCase(
          receiptId
        ));
    this.saveCaseFn =
      options?.saveCaseFn ??
      ((params) =>
        LibraryQuarantineHumanReviewClient.saveQuarantineHumanReviewCase(
          params
        ));
    this.onCaseSaved = options?.onCaseSaved;

    const resolvedEnabled =
      options?.humanReviewEnabled !== undefined
        ? options.humanReviewEnabled === true
        : isLibraryQuarantineHumanReviewEnabled();

    this.state = Object.freeze({
      isOpen: false,
      humanReviewEnabled: resolvedEnabled,
      activeReceipt: null,
      sourceRevision: null,
      currentRevision: 0,
      reviewCase: null,
      form: createEmptyHumanReviewEditorialForm(),
      loading: false,
      saving: false,
      loadError: null,
      saveError: null,
      lastSaveOutcome: null,
      conflictState: null,
      uncertainState: null,
      sessionToken: 0,
    });
  }

  public getSnapshot(): LibraryQuarantineHumanReviewModalSnapshot {
    return this.state;
  }

  public subscribe(
    listener: (snapshot: LibraryQuarantineHumanReviewModalSnapshot) => void
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(
    patch: Partial<LibraryQuarantineHumanReviewModalSnapshot>
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
      !canOpenLibraryQuarantineHumanReviewCase(user)
    ) {
      this.closeModal();
    }
  }

  public setOptions(
    options: LibraryQuarantineHumanReviewControllerOptions
  ): void {
    if (options.getCaseFn) {
      this.getCaseFn = options.getCaseFn;
    }
    if (options.saveCaseFn) {
      this.saveCaseFn = options.saveCaseFn;
    }
    if (options.onCaseSaved !== undefined) {
      this.onCaseSaved = options.onCaseSaved;
    }
    if (options.humanReviewEnabled !== undefined) {
      const nextEnabled = options.humanReviewEnabled === true;
      if (!nextEnabled && this.state.isOpen) {
        this.closeModal();
      }
      if (this.state.humanReviewEnabled !== nextEnabled) {
        this.setState({ humanReviewEnabled: nextEnabled });
      }
    }
  }

  public invalidateSession(): void {
    this.closeModal();
  }

  public closeModal(): void {
    const nextToken = this.state.sessionToken + 1;
    this.setState({
      isOpen: false,
      activeReceipt: null,
      sourceRevision: null,
      currentRevision: 0,
      reviewCase: null,
      form: createEmptyHumanReviewEditorialForm(),
      loading: false,
      saving: false,
      loadError: null,
      saveError: null,
      lastSaveOutcome: null,
      conflictState: null,
      uncertainState: null,
      sessionToken: nextToken,
    });
  }

  public updateFormField<
    K extends keyof LibraryQuarantineHumanReviewEditorialFields,
  >(field: K, value: LibraryQuarantineHumanReviewEditorialFields[K]): void {
    if (!this.state.isOpen || this.state.saving) {
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

  public async openCase(
    receipt: SanitizedLibraryQuarantineAdminReceiptDto,
    sourceRevision?: number
  ): Promise<GetLibraryQuarantineHumanReviewCaseResponseDto | null> {
    if (
      !this.state.humanReviewEnabled ||
      !canOpenLibraryQuarantineHumanReviewCase(this.currentUser) ||
      !receipt ||
      receipt.state !== 'Quarantined'
    ) {
      return null;
    }

    const nextToken = this.state.sessionToken + 1;
    const expectedUserId = this.currentUser?.id ?? null;
    const targetReceiptId = receipt.receiptId;

    this.setState({
      isOpen: true,
      activeReceipt: receipt,
      sourceRevision: sourceRevision ?? null,
      currentRevision: 0,
      reviewCase: null,
      form: createEmptyHumanReviewEditorialForm(),
      loading: true,
      saving: false,
      loadError: null,
      saveError: null,
      lastSaveOutcome: null,
      conflictState: null,
      uncertainState: null,
      sessionToken: nextToken,
    });

    return this.executeLoadCase(targetReceiptId, nextToken, expectedUserId, {
      preserveSaveOutcome: false,
    });
  }

  public async reloadCase(): Promise<GetLibraryQuarantineHumanReviewCaseResponseDto | null> {
    if (
      !this.state.isOpen ||
      !this.state.activeReceipt ||
      this.state.loading ||
      this.state.saving
    ) {
      return null;
    }
    if (
      !this.state.humanReviewEnabled ||
      !canOpenLibraryQuarantineHumanReviewCase(this.currentUser)
    ) {
      this.closeModal();
      return null;
    }

    const nextToken = this.state.sessionToken + 1;
    const expectedUserId = this.currentUser?.id ?? null;
    const targetReceiptId = this.state.activeReceipt.receiptId;

    this.setState({
      loading: true,
      loadError: null,
      saveError: null,
      lastSaveOutcome: null,
      conflictState: null,
      uncertainState: null,
      sessionToken: nextToken,
    });

    return this.executeLoadCase(targetReceiptId, nextToken, expectedUserId, {
      preserveSaveOutcome: false,
    });
  }

  private async executeLoadCase(
    targetReceiptId: string,
    activeToken: number,
    expectedUserId: string | null,
    options: { readonly preserveSaveOutcome: boolean }
  ): Promise<GetLibraryQuarantineHumanReviewCaseResponseDto | null> {
    try {
      const response = await this.getCaseFn(targetReceiptId);

      if (
        !this.state.isOpen ||
        this.state.sessionToken !== activeToken ||
        (this.currentUser?.id ?? null) !== expectedUserId ||
        !canOpenLibraryQuarantineHumanReviewCase(this.currentUser)
      ) {
        return null;
      }

      if (!response.ok) {
        this.setState({
          loading: false,
          loadError: `${response.errorCode}: ${response.errorMessage}`,
        });
        return response;
      }

      this.setState({
        activeReceipt: response.adminReceipt,
        sourceRevision: response.sourceRevision,
        currentRevision: response.currentRevision,
        reviewCase: response.reviewCase,
        form: createFormFromSanitizedHumanReviewCase(response.reviewCase),
        loading: false,
        loadError: null,
        saveError: null,
        conflictState: null,
        uncertainState: null,
        ...(options.preserveSaveOutcome ? {} : { lastSaveOutcome: null }),
      });

      return response;
    } catch (err: unknown) {
      if (
        !this.state.isOpen ||
        this.state.sessionToken !== activeToken ||
        (this.currentUser?.id ?? null) !== expectedUserId
      ) {
        return null;
      }

      if (isHumanCaseReviewNotReleasedError(err)) {
        this.setState({
          loading: false,
          humanReviewEnabled: false,
          loadError: HUMAN_REVIEW_CLIENT_SAFE_ERRORS.FEATURE_NOT_RELEASED,
        });
        return null;
      }

      const safeMessage =
        err instanceof Error &&
        (err.message ===
          HUMAN_REVIEW_CLIENT_SAFE_ERRORS.GET_RESPONSE_CONTRACT_INVALID ||
          err.message ===
            HUMAN_REVIEW_CLIENT_SAFE_ERRORS.CASE_DTO_CONTRACT_INVALID ||
          err.message === HUMAN_REVIEW_CLIENT_SAFE_ERRORS.BACKEND_UNAVAILABLE)
          ? err.message
          : HUMAN_REVIEW_CLIENT_SAFE_ERRORS.GET_CALL_FAILED;

      this.setState({
        loading: false,
        loadError: safeMessage,
      });
      return null;
    }
  }

  public applyConflictServerVersion(): void {
    if (!this.state.isOpen || !this.state.conflictState) {
      return;
    }
    const { serverRevision, serverCase } = this.state.conflictState;
    this.setState({
      currentRevision: serverRevision,
      reviewCase: serverCase,
      form: createFormFromSanitizedHumanReviewCase(serverCase),
      conflictState: null,
      saveError: null,
      lastSaveOutcome: null,
    });
  }

  public async saveCase(): Promise<SaveLibraryQuarantineHumanReviewCaseResponseDto | null> {
    if (
      !this.state.isOpen ||
      !this.state.activeReceipt ||
      this.state.loading ||
      this.state.saving ||
      this.state.uncertainState !== null
    ) {
      return null;
    }

    if (
      !this.state.humanReviewEnabled ||
      !canOpenLibraryQuarantineHumanReviewCase(this.currentUser)
    ) {
      this.closeModal();
      return null;
    }

    let validatedEditorial: LibraryQuarantineHumanReviewEditorialFields;
    try {
      validatedEditorial = validateClientHumanReviewEditorialInput(
        this.state.form
      );
    } catch (validationErr: unknown) {
      const msg =
        validationErr instanceof Error
          ? validationErr.message
          : HUMAN_REVIEW_CLIENT_SAFE_ERRORS.INVALID_EDITORIAL_INPUT;
      this.setState({
        saveError: msg,
        lastSaveOutcome: null,
      });
      return null;
    }

    const activeToken = this.state.sessionToken;
    const expectedUserId = this.currentUser?.id ?? null;
    const receiptId = this.state.activeReceipt.receiptId;
    const expectedRevision = this.state.currentRevision;

    this.setState({
      saving: true,
      saveError: null,
      lastSaveOutcome: null,
      conflictState: null,
    });

    try {
      const response = await this.saveCaseFn({
        receiptId,
        expectedRevision,
        input: validatedEditorial,
      });

      if (
        !this.state.isOpen ||
        this.state.sessionToken !== activeToken ||
        (this.currentUser?.id ?? null) !== expectedUserId ||
        !canOpenLibraryQuarantineHumanReviewCase(this.currentUser)
      ) {
        return null;
      }

      if (response.ok && response.status === 'SAVED') {
        this.setState({
          saving: false,
          currentRevision: response.currentRevision,
          reviewCase: response.reviewCase,
          form: createFormFromSanitizedHumanReviewCase(response.reviewCase),
          saveError: null,
          conflictState: null,
          uncertainState: null,
          lastSaveOutcome: response.caseSaveOutcome,
        });

        this.onCaseSaved?.(response.reviewCase);

        // Fresh server readback after save so UI always reflects canonical stored state
        await this.executeLoadCase(receiptId, activeToken, expectedUserId, {
          preserveSaveOutcome: true,
        });

        return response;
      }

      if (!response.ok && response.status === 'CONFLICT') {
        this.setState({
          saving: false,
          lastSaveOutcome: null,
          conflictState: Object.freeze({
            errorCode: response.errorCode,
            errorMessage: response.errorMessage,
            serverRevision: response.currentRevision,
            serverCase: response.currentCase,
          }),
        });
        return response;
      }

      if (
        !response.ok &&
        (response.status === 'UNKNOWN' || response.caseSaved === null)
      ) {
        this.setState({
          saving: false,
          lastSaveOutcome: null,
          uncertainState: Object.freeze({
            errorCode: response.errorCode,
            errorMessage: response.errorMessage,
            caseSaveOutcome: 'UNKNOWN' as const,
            caseSaved: null,
          }),
        });
        return response;
      }

      // status === 'HOLD'
      this.setState({
        saving: false,
        lastSaveOutcome: null,
        saveError: `${response.errorCode}: ${response.errorMessage}`,
      });
      return response;
    } catch (err: unknown) {
      if (
        !this.state.isOpen ||
        this.state.sessionToken !== activeToken ||
        (this.currentUser?.id ?? null) !== expectedUserId
      ) {
        return null;
      }

      if (isHumanCaseReviewNotReleasedError(err)) {
        this.setState({
          saving: false,
          humanReviewEnabled: false,
          saveError: HUMAN_REVIEW_CLIENT_SAFE_ERRORS.FEATURE_NOT_RELEASED,
        });
        return null;
      }

      const safeMessage =
        err instanceof Error &&
        (err.message ===
          HUMAN_REVIEW_CLIENT_SAFE_ERRORS.SAVE_RESPONSE_CONTRACT_INVALID ||
          err.message ===
            HUMAN_REVIEW_CLIENT_SAFE_ERRORS.CASE_DTO_CONTRACT_INVALID ||
          err.message === HUMAN_REVIEW_CLIENT_SAFE_ERRORS.BACKEND_UNAVAILABLE)
          ? err.message
          : HUMAN_REVIEW_CLIENT_SAFE_ERRORS.SAVE_CALL_FAILED;

      this.setState({
        saving: false,
        lastSaveOutcome: null,
        saveError: safeMessage,
      });
      return null;
    }
  }
}

export interface LibraryQuarantineHumanReviewModalProps {
  readonly controller: LibraryQuarantineHumanReviewModalController;
  readonly isAr: boolean;
}

export function getHumanReviewCaseStatusLabel(
  status: LibraryQuarantineHumanReviewCaseStatus,
  isAr: boolean
): string {
  switch (status) {
    case 'IN_REVIEW':
      return isAr
        ? 'قيد المراجعة والفرز الأولي'
        : 'In Preliminary Review';
    case 'NEEDS_INFORMATION':
      return isAr
        ? 'يتطلب استكمال معلومات أو وثائق مصدرية'
        : 'Needs Additional Information';
    case 'METADATA_RECORDED':
      return isAr
        ? 'تم تسجيل البيانات الوصفية الأولية فقط'
        : 'Preliminary Metadata Recorded Only';
    case 'NOT_SUITABLE':
      return isAr
        ? 'غير مناسب للإدراج في المكتبة'
        : 'Not Suitable for Library Inclusion';
  }
}

export function LibraryQuarantineHumanReviewModal({
  controller,
  isAr,
}: LibraryQuarantineHumanReviewModalProps) {
  const [snapshot, setSnapshot] =
    useState<LibraryQuarantineHumanReviewModalSnapshot>(() =>
      controller.getSnapshot()
    );

  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setSnapshot(controller.getSnapshot());
    return controller.subscribe((next) => {
      setSnapshot(next);
    });
  }, [controller]);

  useEffect(() => {
    if (!snapshot.isOpen) {
      return;
    }
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !snapshot.saving) {
        event.preventDefault();
        controller.closeModal();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [snapshot.isOpen, snapshot.saving, controller]);

  if (!snapshot.isOpen || !snapshot.activeReceipt) {
    return null;
  }

  const receipt = snapshot.activeReceipt;
  const {
    form,
    currentRevision,
    reviewCase,
    loading,
    saving,
    loadError,
    saveError,
    lastSaveOutcome,
    conflictState,
    uncertainState,
  } = snapshot;

  const sizeKb = (receipt.byteSize / 1024).toFixed(1);
  const isSaveBlocked = loading || saving || uncertainState !== null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void controller.saveCase();
  };

  return (
    <div
      data-testid="quarantine-human-review-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto"
      dir={isAr ? 'rtl' : 'ltr'}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quarantine-human-review-modal-title"
        data-testid="quarantine-human-review-modal"
        className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto p-4 sm:p-6 space-y-5 text-start"
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 dark:border-gray-800 pb-4">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="p-2 rounded-xl bg-teal-100 dark:bg-teal-950/80 text-teal-800 dark:text-teal-300">
                <FileText className="h-5 w-5" />
              </span>
              <h3
                id="quarantine-human-review-modal-title"
                data-testid="quarantine-human-review-modal-title"
                className="text-base sm:text-lg font-extrabold text-gray-900 dark:text-gray-100"
              >
                {isAr
                  ? 'سجل المراجعة البشرية للملف المحجور'
                  : 'Quarantined File Human Review Case'}
              </h3>
              <span
                data-testid="quarantine-human-review-revision-badge"
                className="px-2.5 py-0.5 rounded-md text-xs font-extrabold bg-indigo-100 text-indigo-900 dark:bg-indigo-950/80 dark:text-indigo-200 border border-indigo-300 dark:border-indigo-800"
              >
                {currentRevision === 0
                  ? isAr
                    ? 'سجل جديد (النسخة 0)'
                    : 'New Case (Revision 0)'
                  : isAr
                    ? `نسخة المراجعة #${currentRevision}`
                    : `Case Revision #${currentRevision}`}
              </span>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              {isAr
                ? 'توثيق البيانات الوصفية الأولية وملاحظات المصدر والحقوق لإيصال الحجر الخاص المرتبط بمسودة المراجعة.'
                : 'Record preliminary descriptive metadata and source/rights evidence notes for this quarantined receipt.'}
            </p>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            data-testid="close-quarantine-human-review-modal-btn"
            disabled={saving}
            onClick={() => controller.closeModal()}
            aria-label={
              isAr ? 'إغلاق سجل المراجعة' : 'Close human review case modal'
            }
            className="p-2 rounded-xl text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Non-Assurance Governance & Safety Notice */}
        <div
          data-testid="quarantine-human-review-governance-notice"
          className="p-3.5 rounded-xl bg-amber-50/80 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs space-y-1.5"
        >
          <div className="font-extrabold flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-amber-700 dark:text-amber-400 shrink-0" />
            <span>
              {isAr
                ? 'حدود المراجعة الأولية: هذا السجل لا يعتمد الملف أمنياً أو حقوقياً ولا ينشره للجمهور'
                : 'Preliminary Triage Boundary: This case record does NOT approve file safety, rights, or public publication'}
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
            {isAr
              ? 'حالة «تم تسجيل البيانات الوصفية الأولية فقط» تعني اكتمال التوصيف الأولي وملاحظات المصدر فقط، بينما يظل فحص الملف الثنائي المعزول وتطهيره وموافقة الحقوق والنشر العام غير معتمدة.'
              : '"Preliminary Metadata Recorded Only" indicates initial cataloging and source evidence notes only. Binary sanitization, isolated PDF inspection, rights clearance, and publication remain unapproved.'}
          </p>
        </div>

        {/* Sanitized Read-Only Receipt Summary Card */}
        <div
          data-testid="quarantine-human-review-receipt-summary"
          className="p-3.5 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-800 space-y-2 text-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-extrabold text-gray-900 dark:text-gray-100 flex items-center gap-1.5 break-all">
              <Lock className="h-3.5 w-3.5 text-teal-700 dark:text-teal-400 shrink-0" />
              <span data-testid="quarantine-human-review-filename">
                {receipt.originalFilename}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="px-2 py-0.5 rounded-md bg-teal-100 dark:bg-teal-950/80 text-teal-900 dark:text-teal-300 border border-teal-300 dark:border-teal-800 font-extrabold text-[11px]">
                {receipt.format} • {sizeKb} KB
              </span>
              <span className="px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/80 text-emerald-900 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 font-extrabold text-[11px]">
                {isAr ? 'محجور في التخزين الخاص' : 'Quarantined (Private)'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-[11px] text-gray-600 dark:text-gray-400">
            <div>
              <span className="font-bold text-gray-700 dark:text-gray-300">
                {isAr ? 'معرّف الإيصال: ' : 'Receipt ID: '}
              </span>
              <span
                data-testid="quarantine-human-review-receipt-id"
                className="font-mono break-all"
                dir="ltr"
              >
                {receipt.receiptId}
              </span>
            </div>
            <div>
              <span className="font-bold text-gray-700 dark:text-gray-300">
                {isAr ? 'حالة الفحص الأولي: ' : 'Inspection Posture: '}
              </span>
              <span className="font-mono">{receipt.deepInspectionStatus}</span>
            </div>
          </div>

          {reviewCase && (
            <div
              data-testid="quarantine-human-review-persisted-summary"
              className="pt-2 border-t border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-2 text-[11px]"
            >
              <div className="flex items-center gap-1.5 font-bold text-teal-800 dark:text-teal-300">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {isAr ? 'الحالة المحفوظة حالياً: ' : 'Current Saved Status: '}
                  {getHumanReviewCaseStatusLabel(reviewCase.status, isAr)}
                </span>
              </div>
              <div className="text-gray-500 dark:text-gray-400 font-mono" dir="ltr">
                Updated: {reviewCase.updatedAt}
              </div>
            </div>
          )}
        </div>

        {/* Loading State */}
        {loading && (
          <div
            data-testid="quarantine-human-review-loading"
            className="p-8 text-center space-y-2"
          >
            <Loader2 className="h-6 w-6 text-teal-600 animate-spin mx-auto" />
            <p className="text-xs font-extrabold text-gray-700 dark:text-gray-300">
              {isAr
                ? 'جاري تحميل سجل المراجعة البشرية من الخادم...'
                : 'Loading human review case record from server...'}
            </p>
          </div>
        )}

        {/* Load Error Banner */}
        {!loading && loadError && (
          <div
            data-testid="quarantine-human-review-load-error"
            role="alert"
            className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200 text-xs space-y-2"
          >
            <div className="font-extrabold flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0" />
              <span>
                {isAr
                  ? 'تعذر قراءة سجل المراجعة البشرية'
                  : 'Failed to Load Human Review Case'}
              </span>
            </div>
            <p className="font-mono text-[11px] break-words">{loadError}</p>
            <button
              type="button"
              data-testid="quarantine-human-review-retry-load-btn"
              onClick={() => {
                void controller.reloadCase();
              }}
              className="px-3 py-1.5 rounded-lg bg-white dark:bg-gray-800 border border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-200 font-extrabold text-xs cursor-pointer inline-flex items-center gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>{isAr ? 'إعادة تحميل السجل' : 'Reload Case Record'}</span>
            </button>
          </div>
        )}

        {/* Ambiguous Commit Hold Banner (UNKNOWN / caseSaved: null) */}
        {uncertainState && (
          <div
            data-testid="quarantine-human-review-uncertain-banner"
            role="alert"
            className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/60 border-2 border-amber-400 dark:border-amber-700 text-amber-950 dark:text-amber-100 text-xs space-y-2.5"
          >
            <div className="font-extrabold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>
                {isAr
                  ? 'حالة الحفظ غير مؤكدة — تم إيقاف إعادة الإرسال التلقائي'
                  : 'Save Outcome Uncertain — Automatic Resubmission Stopped'}
              </span>
            </div>
            <p className="leading-relaxed">
              {isAr
                ? 'انقطع تأكيد المعاملة بعد بدء الكتابة. لتجنب الكتابة المكررة، يرجى الضغط على «تحقق من السجل» لقراءة الحالة الفعلية المحفوظة على الخادم قبل أي تعديل إضافي.'
                : 'Transaction commit confirmation was lost after staging writes. Click "Verify case record" to read the authoritative server state before making further changes.'}
            </p>
            <div className="pt-1">
              <button
                type="button"
                data-testid="verify-quarantine-human-review-case-btn"
                onClick={() => {
                  void controller.reloadCase();
                }}
                className="px-3.5 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-extrabold text-xs cursor-pointer inline-flex items-center gap-1.5 shadow-xs"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>
                  {isAr ? 'تحقق من السجل' : 'Verify case record'}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Revision Conflict Banner (CONFLICT) */}
        {conflictState && (
          <div
            data-testid="quarantine-human-review-conflict-banner"
            role="alert"
            className="p-4 rounded-xl bg-orange-50 dark:bg-orange-950/50 border border-orange-300 dark:border-orange-800 text-orange-950 dark:text-orange-100 text-xs space-y-2.5"
          >
            <div className="font-extrabold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400 shrink-0" />
              <span>
                {isAr
                  ? `تعارض في نسخة السجل: تم تحديث السجل إلى النسخة #${conflictState.serverRevision} بواسطة مراجع آخر`
                  : `Revision Conflict: Case was updated to Revision #${conflictState.serverRevision} concurrently`}
              </span>
            </div>
            <p className="leading-relaxed">
              {isAr
                ? 'تم إيقاف الحفظ لمنع الكتابة فوق تعديلات سابقة. يمكنك تحميل أحدث نسخة محفوظة لمراجعتها ثم إعادة الحفظ.'
                : 'Save was halted to prevent overwriting concurrent changes. Load the latest saved version to review before saving.'}
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                data-testid="apply-conflict-latest-case-btn"
                onClick={() => controller.applyConflictServerVersion()}
                className="px-3.5 py-2 rounded-xl bg-orange-700 hover:bg-orange-800 text-white font-extrabold text-xs cursor-pointer inline-flex items-center gap-1.5"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>
                  {isAr
                    ? 'تحميل أحدث نسخة محفوظة'
                    : 'Load latest saved version'}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Save Error Banner */}
        {saveError && !uncertainState && !conflictState && (
          <div
            data-testid="quarantine-human-review-save-error"
            role="alert"
            className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200 text-xs space-y-1"
          >
            <div className="font-extrabold flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0" />
              <span>
                {isAr
                  ? 'تعذر حفظ سجل المراجعة البشرية'
                  : 'Could Not Save Human Review Case'}
              </span>
            </div>
            <p className="font-mono text-[11px] break-words">{saveError}</p>
          </div>
        )}

        {/* Save Success Banner (Only shown after confirmed server SAVED result) */}
        {lastSaveOutcome && !saving && !uncertainState && !conflictState && (
          <div
            data-testid="quarantine-human-review-save-success"
            role="status"
            className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 text-xs flex items-center gap-2 font-extrabold"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>
              {lastSaveOutcome === 'CREATED'
                ? isAr
                  ? `تم إنشاء سجل المراجعة البشرية وحفظه بنجاح (النسخة #${currentRevision}) — الحقوق والفحص الثنائي والنشر ما زالت غير معتمدة.`
                  : `Human review case created and saved (Revision #${currentRevision}) — Rights, binary safety, and publication remain unapproved.`
                : isAr
                  ? `تم تحديث سجل المراجعة البشرية وحفظه بنجاح (النسخة #${currentRevision}) — الحقوق والفحص الثنائي والنشر ما زالت غير معتمدة.`
                  : `Human review case updated and saved (Revision #${currentRevision}) — Rights, binary safety, and publication remain unapproved.`}
            </span>
          </div>
        )}

        {/* Editorial Case Form */}
        {!loading && !loadError && (
          <form
            data-testid="quarantine-human-review-form"
            onSubmit={handleSubmit}
            className="space-y-4 text-xs"
          >
            {/* Status Selector */}
            <div className="space-y-1.5">
              <label
                htmlFor="human-review-status-select"
                className="block font-extrabold text-gray-800 dark:text-gray-200"
              >
                {isAr
                  ? 'قرار الفرز الأولي للبيانات الوصفية'
                  : 'Preliminary Metadata Triage Decision'}
              </label>
              <select
                id="human-review-status-select"
                data-testid="human-review-status-select"
                disabled={isSaveBlocked}
                value={form.status}
                onChange={(e) =>
                  controller.updateFormField(
                    'status',
                    e.target.value as LibraryQuarantineHumanReviewCaseStatus
                  )
                }
                className="w-full px-3 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-bold outline-none focus:ring-2 focus:ring-teal-500"
              >
                {LIBRARY_QUARANTINE_HUMAN_REVIEW_CASE_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {getHumanReviewCaseStatusLabel(st, isAr)} ({st})
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {form.status === 'METADATA_RECORDED'
                  ? isAr
                    ? 'يتطلب هذا الخيار إدخال عنوان واحد على الأقل (عربي أو إنجليزي) وملاحظات إثبات المصدر.'
                    : 'Requires at least one document title (Arabic or English) and non-empty source evidence notes.'
                  : form.status === 'NEEDS_INFORMATION' ||
                      form.status === 'NOT_SUITABLE'
                    ? isAr
                      ? 'يتطلب هذا الخيار تدوين سبب واضح في حقل «ملاحظات المراجع والتبرير التحريري».'
                      : 'Requires clear justification in the Reviewer Editorial & Justification Notes field.'
                    : isAr
                      ? 'أدخل عنواناً أو ملاحظة واحدة على الأقل لحفظ التقدم الأولي للمراجعة.'
                      : 'Enter at least one descriptive field or reviewer note to save preliminary review progress.'}
              </p>
            </div>

            {/* Titles (Arabic & English) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label
                  htmlFor="human-review-title-ar"
                  className="block font-bold text-gray-700 dark:text-gray-300"
                >
                  {isAr
                    ? 'عنوان الوثيقة (بالعربية)'
                    : 'Document Title (Arabic)'}
                </label>
                <input
                  id="human-review-title-ar"
                  data-testid="human-review-title-ar-input"
                  type="text"
                  dir="rtl"
                  maxLength={HUMAN_REVIEW_TITLE_MAX_LENGTH}
                  disabled={isSaveBlocked}
                  value={form.titleAr}
                  onChange={(e) =>
                    controller.updateFormField('titleAr', e.target.value)
                  }
                  placeholder={
                    isAr
                      ? 'أدخل العنوان الرسمي للوثيقة بالعربية...'
                      : 'Enter Arabic document title...'
                  }
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="human-review-title-en"
                  className="block font-bold text-gray-700 dark:text-gray-300"
                >
                  {isAr
                    ? 'عنوان الوثيقة (بالإنجليزية)'
                    : 'Document Title (English)'}
                </label>
                <input
                  id="human-review-title-en"
                  data-testid="human-review-title-en-input"
                  type="text"
                  dir="ltr"
                  maxLength={HUMAN_REVIEW_TITLE_MAX_LENGTH}
                  disabled={isSaveBlocked}
                  value={form.titleEn}
                  onChange={(e) =>
                    controller.updateFormField('titleEn', e.target.value)
                  }
                  placeholder={
                    isAr
                      ? 'Enter English document title...'
                      : 'Enter official English document title...'
                  }
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>

            {/* Issuing Organization */}
            <div className="space-y-1">
              <label
                htmlFor="human-review-issuing-org"
                className="block font-bold text-gray-700 dark:text-gray-300"
              >
                {isAr
                  ? 'الجهة المُصدرة للوثيقة'
                  : 'Issuing Organization / Authority'}
              </label>
              <input
                id="human-review-issuing-org"
                data-testid="human-review-issuing-org-input"
                type="text"
                maxLength={HUMAN_REVIEW_ORGANIZATION_MAX_LENGTH}
                disabled={isSaveBlocked}
                value={form.issuingOrganization}
                onChange={(e) =>
                  controller.updateFormField(
                    'issuingOrganization',
                    e.target.value
                  )
                }
                placeholder={
                  isAr
                    ? 'مثال: برنامج الأمم المتحدة للبيئة (UNEP) / وزارة البيئة...'
                    : 'e.g., UNEP / Ministry of Environment...'
                }
                className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>

            {/* Summaries (Arabic & English) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label
                  htmlFor="human-review-summary-ar"
                  className="block font-bold text-gray-700 dark:text-gray-300"
                >
                  {isAr
                    ? 'الموجز التحريري الأولي (بالعربية)'
                    : 'Preliminary Editorial Summary (Arabic)'}
                </label>
                <textarea
                  id="human-review-summary-ar"
                  data-testid="human-review-summary-ar-input"
                  rows={3}
                  dir="rtl"
                  maxLength={HUMAN_REVIEW_NOTES_MAX_LENGTH}
                  disabled={isSaveBlocked}
                  value={form.summaryAr}
                  onChange={(e) =>
                    controller.updateFormField('summaryAr', e.target.value)
                  }
                  placeholder={
                    isAr
                      ? 'ملخص تحريري أولي لمضمون الوثيقة...'
                      : 'Preliminary Arabic summary...'
                  }
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="human-review-summary-en"
                  className="block font-bold text-gray-700 dark:text-gray-300"
                >
                  {isAr
                    ? 'الموجز التحريري الأولي (بالإنجليزية)'
                    : 'Preliminary Editorial Summary (English)'}
                </label>
                <textarea
                  id="human-review-summary-en"
                  data-testid="human-review-summary-en-input"
                  rows={3}
                  dir="ltr"
                  maxLength={HUMAN_REVIEW_NOTES_MAX_LENGTH}
                  disabled={isSaveBlocked}
                  value={form.summaryEn}
                  onChange={(e) =>
                    controller.updateFormField('summaryEn', e.target.value)
                  }
                  placeholder={
                    isAr
                      ? 'Preliminary English summary...'
                      : 'Preliminary editorial summary of the document...'
                  }
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>

            {/* Source Evidence & Rights Evidence Notes */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label
                  htmlFor="human-review-source-evidence"
                  className="block font-bold text-gray-700 dark:text-gray-300"
                >
                  {isAr
                    ? 'ملاحظات إثبات المصدر الأصلي'
                    : 'Source Provenance & Evidence Notes'}
                </label>
                <textarea
                  id="human-review-source-evidence"
                  data-testid="human-review-source-evidence-input"
                  rows={3}
                  maxLength={HUMAN_REVIEW_NOTES_MAX_LENGTH}
                  disabled={isSaveBlocked}
                  value={form.sourceEvidenceNotes}
                  onChange={(e) =>
                    controller.updateFormField(
                      'sourceEvidenceNotes',
                      e.target.value
                    )
                  }
                  placeholder={
                    isAr
                      ? 'بيانات الجريدة الرسمية، رقم القرار، أو سجل المصدر المعتمد...'
                      : 'Official gazette reference, decision number, or institutional source evidence...'
                  }
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="human-review-rights-evidence"
                  className="block font-bold text-gray-700 dark:text-gray-300"
                >
                  {isAr
                    ? 'ملاحظات دليل الحقوق والترخيص (أولية غير معتمدة)'
                    : 'Preliminary Rights & Licensing Evidence Notes'}
                </label>
                <textarea
                  id="human-review-rights-evidence"
                  data-testid="human-review-rights-evidence-input"
                  rows={3}
                  maxLength={HUMAN_REVIEW_NOTES_MAX_LENGTH}
                  disabled={isSaveBlocked}
                  value={form.rightsEvidenceNotes}
                  onChange={(e) =>
                    controller.updateFormField(
                      'rightsEvidenceNotes',
                      e.target.value
                    )
                  }
                  placeholder={
                    isAr
                      ? 'ملاحظات أولية حول حالة الملكية العامة أو شروط إعادة النشر...'
                      : 'Preliminary notes on public-domain status or redistribution terms...'
                  }
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>

            {/* Reviewer Editorial & Justification Notes */}
            <div className="space-y-1">
              <label
                htmlFor="human-review-editorial-notes"
                className="block font-bold text-gray-700 dark:text-gray-300"
              >
                {isAr
                  ? 'ملاحظات المراجع والتبرير التحريري'
                  : 'Reviewer Editorial & Justification Notes'}
              </label>
              <textarea
                id="human-review-editorial-notes"
                data-testid="human-review-editorial-notes-input"
                rows={3}
                maxLength={HUMAN_REVIEW_NOTES_MAX_LENGTH}
                disabled={isSaveBlocked}
                value={form.editorialNotes}
                onChange={(e) =>
                  controller.updateFormField('editorialNotes', e.target.value)
                }
                placeholder={
                  isAr
                    ? 'ملاحظات الفرز البشري أو أسباب طلب معلومات إضافية / عدم الملاءمة...'
                    : 'Reviewer triage notes or justification for Needs Information / Not Suitable...'
                }
                className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>

            {/* Modal Footer Actions */}
            <div className="pt-4 border-t border-gray-200 dark:border-gray-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
              <button
                type="button"
                data-testid="reload-quarantine-human-review-case-btn"
                disabled={loading || saving}
                onClick={() => {
                  void controller.reloadCase();
                }}
                className="px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-bold text-xs cursor-pointer disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>
                  {isAr ? 'تحديث بيانات السجل' : 'Refresh Case Record'}
                </span>
              </button>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <button
                  type="button"
                  data-testid="cancel-quarantine-human-review-modal-btn"
                  disabled={saving}
                  onClick={() => controller.closeModal()}
                  className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold text-xs cursor-pointer disabled:opacity-50"
                >
                  {isAr ? 'إغلاق' : 'Close'}
                </button>

                <button
                  type="submit"
                  data-testid="save-quarantine-human-review-case-btn"
                  disabled={isSaveBlocked}
                  className="px-5 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-extrabold text-xs transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5 shadow-sm"
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  ) : (
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span>
                    {saving
                      ? isAr
                        ? 'جاري حفظ سجل المراجعة...'
                        : 'Saving review case...'
                      : isAr
                        ? 'حفظ سجل المراجعة الأولية'
                        : 'Save preliminary review case'}
                  </span>
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
