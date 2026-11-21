import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Globe,
  Lock,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { AdminUser } from '../../types/admin';
import type { LibraryOrganization, LibrarySource } from '../../types/library';
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
import {
  LibraryQuarantineCatalogHandoffPanel,
  type LibraryQuarantineCatalogHandoffPanelController,
} from './LibraryQuarantineCatalogHandoffPanel';
import {
  LibraryQuarantineRightsDecisionPanel,
  LibraryQuarantineRightsDecisionPanelController,
} from './LibraryQuarantineRightsDecisionPanel';
import {
  LibraryQuarantineBinarySafetyCasePanel,
} from './LibraryQuarantineBinarySafetyCasePanel';
import {
  LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL,
  LibraryQuarantineReviewedSourceReleasePanelController,
  REVIEWED_PUBLIC_LINK_BASES,
  REVIEWED_PUBLIC_RIGHTS_STATUSES,
  canUserPublishReviewedLibrarySourceReference,
  isLibraryQuarantineReviewedSourceReleaseEnabled,
  type LibraryQuarantineReviewedSourceReleasePanelSnapshot,
  type ReviewedPublicLibraryRightsStatus,
  type ReviewedPublicLinkBasis,
} from '../../services/libraryReviewedSourceReleaseClient';
import {
  LIBRARY_PUBLISHED_BINARY_RELEASE_CONFIRMATION_LITERAL,
  LibraryQuarantinePublishedBinaryReleasePanelController,
  PUBLISHED_BINARY_PUBLIC_RIGHTS_STATUSES,
  PUBLISHED_BINARY_RIGHTS_BASES,
  canUserPublishQuarantinedBinaryToPublicLibrary,
  isLibraryQuarantinePublishedBinaryReleaseEnabled,
  type LibraryQuarantinePublishedBinaryReleasePanelSnapshot,
  type PublishedBinaryPublicLibraryRightsStatus,
  type PublishedBinaryRightsBasis,
} from '../../services/libraryPublishedBinaryClient';

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

export const HUMAN_REVIEW_CLIENT_SAVE_UNCONFIRMED_CODE =
  'SAVE_RESULT_UNCONFIRMED' as const;

export type LibraryQuarantineHumanReviewUncertainVerificationStatus =
  | 'UNVERIFIED'
  | 'STILL_AT_EXPECTED_REVISION'
  | 'REVISION_OR_CONTENT_MISMATCH'
  | 'SOURCE_CHANGED'
  | 'VERIFY_HOLD'
  | 'VERIFY_CALL_FAILED';

export interface LibraryQuarantineHumanReviewPendingSaveAttempt {
  readonly receiptId: string;
  readonly sourceRevision: number | null;
  readonly expectedRevision: number;
  readonly attemptedFields: LibraryQuarantineHumanReviewEditorialFields;
}

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
  readonly origin?: 'SERVER_TRANSACTION_UNCERTAIN' | 'CLIENT_SAVE_UNCONFIRMED';
  readonly expectedRevision?: number;
  readonly verifiedServerRevision?: number | null;
  readonly verificationStatus?: LibraryQuarantineHumanReviewUncertainVerificationStatus;
  readonly verificationErrorCode?: string | null;
  readonly verificationMessageAr?: string | null;
  readonly verificationMessageEn?: string | null;
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

export function doHumanReviewEditorialFieldsExactlyMatch(
  actual:
    | SanitizedLibraryQuarantineHumanReviewCaseDto
    | LibraryQuarantineHumanReviewEditorialFields
    | null
    | undefined,
  expected: LibraryQuarantineHumanReviewEditorialFields
): boolean {
  if (!actual) {
    return false;
  }
  return (
    actual.status === expected.status &&
    actual.titleAr.trim() === expected.titleAr.trim() &&
    actual.titleEn.trim() === expected.titleEn.trim() &&
    actual.issuingOrganization.trim() === expected.issuingOrganization.trim() &&
    actual.summaryAr.trim() === expected.summaryAr.trim() &&
    actual.summaryEn.trim() === expected.summaryEn.trim() &&
    actual.sourceEvidenceNotes.trim() === expected.sourceEvidenceNotes.trim() &&
    actual.rightsEvidenceNotes.trim() === expected.rightsEvidenceNotes.trim() &&
    actual.editorialNotes.trim() === expected.editorialNotes.trim()
  );
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
  private pendingSaveAttempt: LibraryQuarantineHumanReviewPendingSaveAttempt | null =
    null;
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
    this.pendingSaveAttempt = null;
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
    if (
      !this.state.isOpen ||
      this.state.saving ||
      this.state.loading ||
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
    this.pendingSaveAttempt = null;

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

    if (this.state.uncertainState !== null) {
      this.setState({
        loading: true,
        loadError: null,
        saveError: null,
        lastSaveOutcome: null,
        conflictState: null,
        sessionToken: nextToken,
      });

      return this.executeVerifyUncertainCase(
        targetReceiptId,
        nextToken,
        expectedUserId
      );
    }

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

  public acknowledgeUncommittedSaveAfterVerify(): boolean {
    if (
      !this.state.isOpen ||
      !this.state.activeReceipt ||
      this.state.loading ||
      this.state.saving ||
      !this.state.uncertainState ||
      this.state.uncertainState.verificationStatus !==
        'STILL_AT_EXPECTED_REVISION' ||
      !this.pendingSaveAttempt ||
      this.state.uncertainState.verifiedServerRevision !==
        this.pendingSaveAttempt.expectedRevision
    ) {
      return false;
    }

    const verifiedRevision = this.pendingSaveAttempt.expectedRevision;
    const preservedForm = this.pendingSaveAttempt.attemptedFields;
    this.pendingSaveAttempt = null;

    this.setState({
      currentRevision: verifiedRevision,
      form: preservedForm,
      uncertainState: null,
      saveError: null,
      lastSaveOutcome: null,
    });
    return true;
  }

  private async executeVerifyUncertainCase(
    targetReceiptId: string,
    activeToken: number,
    expectedUserId: string | null
  ): Promise<GetLibraryQuarantineHumanReviewCaseResponseDto | null> {
    const pendingAttempt = this.pendingSaveAttempt;

    try {
      const response = await this.getCaseFn(targetReceiptId);

      if (
        !this.state.isOpen ||
        this.state.sessionToken !== activeToken ||
        (this.currentUser?.id ?? null) !== expectedUserId ||
        !canOpenLibraryQuarantineHumanReviewCase(this.currentUser) ||
        this.state.activeReceipt?.receiptId !== targetReceiptId ||
        !this.state.uncertainState
      ) {
        return null;
      }

      if (!response.ok) {
        this.setState({
          loading: false,
          loadError: null,
          uncertainState: Object.freeze({
            ...this.state.uncertainState,
            verificationStatus: 'VERIFY_HOLD' as const,
            verificationErrorCode: response.errorCode,
            verificationMessageAr: `تعذر التحقق من السجل على الخادم (${response.errorCode}). تم الاحتفاظ بمسودة التعديلات وإبقاء القفل لمنع الكتابة المكررة.`,
            verificationMessageEn: `Could not verify server case record (${response.errorCode}). Your attempted edits remain preserved and locked to prevent duplicate writes.`,
          }),
        });
        return response;
      }

      if (
        pendingAttempt &&
        pendingAttempt.sourceRevision !== null &&
        response.sourceRevision !== pendingAttempt.sourceRevision
      ) {
        this.setState({
          activeReceipt: response.adminReceipt,
          sourceRevision: response.sourceRevision,
          currentRevision: response.currentRevision,
          reviewCase: response.reviewCase,
          loading: false,
          loadError: null,
          uncertainState: Object.freeze({
            ...this.state.uncertainState,
            verifiedServerRevision: response.currentRevision,
            verificationStatus: 'SOURCE_CHANGED' as const,
            verificationErrorCode: 'SOURCE_REVISION_CHANGED',
            verificationMessageAr: `تغيرت نسخة مصدر المراجعة على الخادم (إلى النسخة المصدرية #${response.sourceRevision} / نسخة السجل #${response.currentRevision}). تم الإبقاء على القفل والاحتفاظ بمسودة تعديلاتك دون استبدالها.`,
            verificationMessageEn: `Server source revision changed (to source revision #${response.sourceRevision} / case revision #${response.currentRevision}). Hold remains active and your attempted edits are preserved without overwrite.`,
          }),
        });
        return response;
      }

      if (
        pendingAttempt &&
        pendingAttempt.receiptId === targetReceiptId &&
        response.adminReceipt.receiptId === targetReceiptId &&
        response.currentRevision === pendingAttempt.expectedRevision + 1 &&
        response.reviewCase !== null &&
        response.reviewCase.receiptId === targetReceiptId &&
        response.reviewCase.revision === pendingAttempt.expectedRevision + 1 &&
        doHumanReviewEditorialFieldsExactlyMatch(
          response.reviewCase,
          pendingAttempt.attemptedFields
        )
      ) {
        const resolvedOutcome: 'CREATED' | 'UPDATED' =
          pendingAttempt.expectedRevision === 0 ? 'CREATED' : 'UPDATED';
        this.pendingSaveAttempt = null;

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
          lastSaveOutcome: resolvedOutcome,
        });

        this.onCaseSaved?.(response.reviewCase);
        return response;
      }

      if (
        pendingAttempt &&
        response.currentRevision === pendingAttempt.expectedRevision
      ) {
        this.setState({
          activeReceipt: response.adminReceipt,
          sourceRevision: response.sourceRevision,
          currentRevision: response.currentRevision,
          reviewCase: response.reviewCase,
          loading: false,
          loadError: null,
          uncertainState: Object.freeze({
            ...this.state.uncertainState,
            verifiedServerRevision: response.currentRevision,
            verificationStatus: 'STILL_AT_EXPECTED_REVISION' as const,
            verificationErrorCode: null,
            verificationMessageAr: `يُظهر الخادم أن السجل ما زال عند النسخة #${response.currentRevision} (لم يُسجّل التعديل على الخادم حتى لحظة القراءة). تم الاحتفاظ بمسودة حقولك التسعة دون حذف؛ يمكنك إعادة التحقق أو فتح المسودة يدوياً للحفظ المحمي برقم النسخة.`,
            verificationMessageEn: `Server still shows Revision #${response.currentRevision} (the attempted write was not persisted as of this readback). All 9 attempted fields remain preserved; you may re-verify or explicitly unlock the preserved draft at the verified CAS revision.`,
          }),
        });
        return response;
      }

      this.setState({
        activeReceipt: response.adminReceipt,
        sourceRevision: response.sourceRevision,
        currentRevision: response.currentRevision,
        reviewCase: response.reviewCase,
        loading: false,
        loadError: null,
        uncertainState: Object.freeze({
          ...this.state.uncertainState,
          verifiedServerRevision: response.currentRevision,
          verificationStatus: 'REVISION_OR_CONTENT_MISMATCH' as const,
          verificationErrorCode: 'SERVER_CASE_MISMATCH',
          verificationMessageAr: `يُظهر الخادم النسخة #${response.currentRevision} ببيانات لا تطابق محاولة الحفظ الحالية. تم الإبقاء على القفل والاحتفاظ بمسودة تعديلاتك لمنع الكتابة فوق بيانات الخادم.`,
          verificationMessageEn: `Server record is at Revision #${response.currentRevision} with content that does not match your attempted save. Hold remains active and your attempted edits are preserved to prevent overwriting server data.`,
        }),
      });
      return response;
    } catch (err: unknown) {
      if (
        !this.state.isOpen ||
        this.state.sessionToken !== activeToken ||
        (this.currentUser?.id ?? null) !== expectedUserId ||
        this.state.activeReceipt?.receiptId !== targetReceiptId ||
        !this.state.uncertainState
      ) {
        return null;
      }

      const safeVerifyCode = isHumanCaseReviewNotReleasedError(err)
        ? HUMAN_REVIEW_CLIENT_SAFE_ERRORS.FEATURE_NOT_RELEASED
        : err instanceof Error &&
            (err.message ===
              HUMAN_REVIEW_CLIENT_SAFE_ERRORS.GET_RESPONSE_CONTRACT_INVALID ||
              err.message ===
                HUMAN_REVIEW_CLIENT_SAFE_ERRORS.CASE_DTO_CONTRACT_INVALID ||
              err.message ===
                HUMAN_REVIEW_CLIENT_SAFE_ERRORS.BACKEND_UNAVAILABLE)
          ? err.message
          : HUMAN_REVIEW_CLIENT_SAFE_ERRORS.GET_CALL_FAILED;

      this.setState({
        loading: false,
        loadError: null,
        uncertainState: Object.freeze({
          ...this.state.uncertainState,
          verificationStatus: 'VERIFY_CALL_FAILED' as const,
          verificationErrorCode: safeVerifyCode,
          verificationMessageAr: `فشل طلب التحقق من السجل (${safeVerifyCode}). تم الاحتفاظ بمسودة التعديلات وإبقاء إيقاف الإرسال لمنع التكرار.`,
          verificationMessageEn: `Verification readback failed (${safeVerifyCode}). Your attempted edits remain preserved and submission stays locked.`,
        }),
      });
      return null;
    }
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
        !canOpenLibraryQuarantineHumanReviewCase(this.currentUser) ||
        this.state.activeReceipt?.receiptId !== targetReceiptId
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
        (this.currentUser?.id ?? null) !== expectedUserId ||
        this.state.activeReceipt?.receiptId !== targetReceiptId
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
    this.pendingSaveAttempt = null;
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
    const attemptedAttempt: LibraryQuarantineHumanReviewPendingSaveAttempt =
      Object.freeze({
        receiptId,
        sourceRevision: this.state.sourceRevision,
        expectedRevision,
        attemptedFields: validatedEditorial,
      });

    this.pendingSaveAttempt = attemptedAttempt;

    this.setState({
      saving: true,
      form: validatedEditorial,
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
        !canOpenLibraryQuarantineHumanReviewCase(this.currentUser) ||
        this.state.activeReceipt?.receiptId !== receiptId
      ) {
        return null;
      }

      if (response.ok && response.status === 'SAVED') {
        this.pendingSaveAttempt = null;
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
        this.pendingSaveAttempt = null;
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
        this.pendingSaveAttempt = attemptedAttempt;
        this.setState({
          saving: false,
          lastSaveOutcome: null,
          saveError: null,
          uncertainState: Object.freeze({
            errorCode: response.errorCode,
            errorMessage: response.errorMessage,
            caseSaveOutcome: 'UNKNOWN' as const,
            caseSaved: null,
            origin: 'SERVER_TRANSACTION_UNCERTAIN' as const,
            expectedRevision,
            verifiedServerRevision: null,
            verificationStatus: 'UNVERIFIED' as const,
            verificationErrorCode: null,
            verificationMessageAr: null,
            verificationMessageEn: null,
          }),
        });
        return response;
      }

      // status === 'HOLD'
      this.pendingSaveAttempt = null;
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
        (this.currentUser?.id ?? null) !== expectedUserId ||
        this.state.activeReceipt?.receiptId !== receiptId
      ) {
        return null;
      }

      if (isHumanCaseReviewNotReleasedError(err)) {
        this.pendingSaveAttempt = null;
        this.setState({
          saving: false,
          humanReviewEnabled: false,
          saveError: HUMAN_REVIEW_CLIENT_SAFE_ERRORS.FEATURE_NOT_RELEASED,
        });
        return null;
      }

      if (
        err instanceof Error &&
        (err.message === HUMAN_REVIEW_CLIENT_SAFE_ERRORS.BACKEND_UNAVAILABLE ||
          err.message === HUMAN_REVIEW_CLIENT_SAFE_ERRORS.INVALID_RECEIPT_ID ||
          err.message ===
            HUMAN_REVIEW_CLIENT_SAFE_ERRORS.INVALID_EXPECTED_REVISION ||
          err.message ===
            HUMAN_REVIEW_CLIENT_SAFE_ERRORS.INVALID_EDITORIAL_INPUT ||
          err.message ===
            HUMAN_REVIEW_CLIENT_SAFE_ERRORS.METADATA_RECORDED_REQUIREMENTS_NOT_MET ||
          err.message ===
            HUMAN_REVIEW_CLIENT_SAFE_ERRORS.JUSTIFICATION_NOTES_REQUIRED ||
          err.message ===
            HUMAN_REVIEW_CLIENT_SAFE_ERRORS.EMPTY_REVIEW_CASE_NOT_ALLOWED)
      ) {
        this.pendingSaveAttempt = null;
        this.setState({
          saving: false,
          lastSaveOutcome: null,
          saveError: err.message,
        });
        return null;
      }

      this.pendingSaveAttempt = attemptedAttempt;
      this.setState({
        saving: false,
        lastSaveOutcome: null,
        saveError: null,
        conflictState: null,
        uncertainState: Object.freeze({
          errorCode: HUMAN_REVIEW_CLIENT_SAVE_UNCONFIRMED_CODE,
          errorMessage:
            'SAVE_RESULT_UNCONFIRMED: Save request outcome could not be confirmed due to a call or response error. Verify the server case record before making further changes.',
          caseSaveOutcome: 'UNKNOWN' as const,
          caseSaved: null,
          origin: 'CLIENT_SAVE_UNCONFIRMED' as const,
          expectedRevision,
          verifiedServerRevision: null,
          verificationStatus: 'UNVERIFIED' as const,
          verificationErrorCode: null,
          verificationMessageAr: null,
          verificationMessageEn: null,
        }),
      });
      return null;
    }
  }
}

export interface LibraryQuarantineHumanReviewModalProps {
  readonly controller: LibraryQuarantineHumanReviewModalController;
  readonly isAr: boolean;
  readonly currentUser?: AdminUser | null;
  readonly organizations?: readonly LibraryOrganization[];
  readonly sources?: readonly LibrarySource[];
  readonly catalogHandoffController?: LibraryQuarantineCatalogHandoffPanelController;
  readonly rightsDecisionController?: LibraryQuarantineRightsDecisionPanelController;
  readonly reviewedSourceReleaseController?: LibraryQuarantineReviewedSourceReleasePanelController;
  readonly publishedBinaryReleaseController?: LibraryQuarantinePublishedBinaryReleasePanelController;
  readonly envOverride?: Record<string, unknown>;
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
  currentUser = null,
  organizations = [],
  sources = [],
  catalogHandoffController,
  rightsDecisionController,
  reviewedSourceReleaseController,
  publishedBinaryReleaseController,
  envOverride,
}: LibraryQuarantineHumanReviewModalProps) {
  const [snapshot, setSnapshot] =
    useState<LibraryQuarantineHumanReviewModalSnapshot>(() =>
      controller.getSnapshot()
    );

  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const fallbackRightsControllerRef =
    useRef<LibraryQuarantineRightsDecisionPanelController | null>(null);
  const fallbackReleaseControllerRef =
    useRef<LibraryQuarantineReviewedSourceReleasePanelController | null>(null);
  const fallbackBinaryReleaseControllerRef =
    useRef<LibraryQuarantinePublishedBinaryReleasePanelController | null>(null);

  if (!rightsDecisionController && !fallbackRightsControllerRef.current) {
    fallbackRightsControllerRef.current =
      new LibraryQuarantineRightsDecisionPanelController(currentUser);
  }

  if (
    !reviewedSourceReleaseController &&
    !fallbackReleaseControllerRef.current
  ) {
    fallbackReleaseControllerRef.current =
      new LibraryQuarantineReviewedSourceReleasePanelController(currentUser, {
        enabled: isLibraryQuarantineReviewedSourceReleaseEnabled(envOverride),
      });
  }

  if (
    !publishedBinaryReleaseController &&
    !fallbackBinaryReleaseControllerRef.current
  ) {
    fallbackBinaryReleaseControllerRef.current =
      new LibraryQuarantinePublishedBinaryReleasePanelController(currentUser, {
        enabled: isLibraryQuarantinePublishedBinaryReleaseEnabled(envOverride),
      });
  }

  const effectiveRightsDecisionController =
    rightsDecisionController ?? fallbackRightsControllerRef.current!;

  const effectiveReleaseController =
    reviewedSourceReleaseController ?? fallbackReleaseControllerRef.current!;

  const effectiveBinaryReleaseController =
    publishedBinaryReleaseController ??
    fallbackBinaryReleaseControllerRef.current!;

  useEffect(() => {
    setSnapshot(controller.getSnapshot());
    return controller.subscribe((next) => {
      setSnapshot(next);
    });
  }, [controller]);

  useEffect(() => {
    effectiveReleaseController.setCurrentUser(currentUser);
    effectiveBinaryReleaseController.setCurrentUser(currentUser);
  }, [
    effectiveReleaseController,
    effectiveBinaryReleaseController,
    currentUser,
  ]);

  useEffect(() => {
    if (!snapshot.isOpen) {
      effectiveRightsDecisionController.resetPanel();
      effectiveReleaseController.resetPanel();
      effectiveBinaryReleaseController.resetPanel();
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
  }, [
    snapshot.isOpen,
    snapshot.saving,
    controller,
    effectiveRightsDecisionController,
    effectiveReleaseController,
    effectiveBinaryReleaseController,
  ]);

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

        {/* Ambiguous Commit / Unconfirmed Save Hold Banner (UNKNOWN / caseSaved: null / SAVE_RESULT_UNCONFIRMED) */}
        {uncertainState && (
          <div
            data-testid="quarantine-human-review-uncertain-banner"
            role="alert"
            className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/60 border-2 border-amber-400 dark:border-amber-700 text-amber-950 dark:text-amber-100 text-xs space-y-2.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-extrabold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>
                  {isAr
                    ? 'حالة الحفظ غير مؤكدة — تم إيقاف إعادة الإرسال التلقائي'
                    : 'Save Outcome Uncertain — Automatic Resubmission Stopped'}
                </span>
              </div>
              <span
                data-testid="quarantine-human-review-uncertain-code"
                className="px-2 py-0.5 rounded-md font-mono text-[11px] font-bold bg-amber-100 dark:bg-amber-900/70 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700"
                dir="ltr"
              >
                {uncertainState.errorCode}
              </span>
            </div>
            <p className="leading-relaxed">
              {uncertainState.origin === 'CLIENT_SAVE_UNCONFIRMED' ||
              uncertainState.errorCode ===
                HUMAN_REVIEW_CLIENT_SAVE_UNCONFIRMED_CODE
                ? isAr
                  ? 'تعذر تأكيد نتيجة طلب الحفظ بسبب انقطاع الاتصال أو خطأ في استجابة الخدمة (قد يكون الحفظ قد اكتمل على الخادم أو لم يكتمل). تم الاحتفاظ بمسودة تعديلاتك وإيقاف الحفظ لتجنب التكرار. يرجى الضغط على «تحقق من السجل» لقراءة الحالة الفعلية على الخادم.'
                  : 'Save request outcome could not be confirmed due to a call or response error (the server write may or may not have completed). Your attempted edits are preserved and locked to prevent duplicate writes. Click "Verify case record" to inspect the server state.'
                : isAr
                  ? 'انقطع تأكيد المعاملة بعد بدء الكتابة. لتجنب الكتابة المكررة، يرجى الضغط على «تحقق من السجل» لقراءة الحالة الفعلية المحفوظة على الخادم قبل أي تعديل إضافي.'
                  : 'Transaction commit confirmation was lost after staging writes. Click "Verify case record" to read the authoritative server state before making further changes.'}
            </p>
            {uncertainState.verificationStatus &&
              uncertainState.verificationStatus !== 'UNVERIFIED' && (
                <div
                  data-testid="quarantine-human-review-uncertain-verification-status"
                  className="p-2.5 rounded-lg bg-amber-100/80 dark:bg-amber-900/50 border border-amber-300 dark:border-amber-700 text-[11px] space-y-1"
                >
                  <div className="font-extrabold">
                    {isAr
                      ? `نتيجة التحقق من الخادم (${uncertainState.verificationStatus}):`
                      : `Server Verification Result (${uncertainState.verificationStatus}):`}
                  </div>
                  <p className="leading-relaxed">
                    {isAr
                      ? uncertainState.verificationMessageAr
                      : uncertainState.verificationMessageEn}
                  </p>
                </div>
              )}
            <div className="pt-1 flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="verify-quarantine-human-review-case-btn"
                disabled={loading || saving}
                onClick={() => {
                  void controller.reloadCase();
                }}
                className="px-3.5 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-extrabold text-xs cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5 shadow-xs"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>
                  {isAr ? 'تحقق من السجل' : 'Verify case record'}
                </span>
              </button>
              {uncertainState.verificationStatus ===
                'STILL_AT_EXPECTED_REVISION' && (
                <button
                  type="button"
                  data-testid="acknowledge-uncommitted-human-review-save-btn"
                  disabled={loading || saving}
                  onClick={() => {
                    controller.acknowledgeUncommittedSaveAfterVerify();
                  }}
                  className="px-3.5 py-2 rounded-xl bg-white dark:bg-gray-800 hover:bg-amber-100 dark:hover:bg-gray-700 border border-amber-400 dark:border-amber-600 text-amber-950 dark:text-amber-100 font-extrabold text-xs cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  <span>
                    {isAr
                      ? 'فتح مسودة التعديل المحفوظة محلياً بعد التحقق'
                      : 'Unlock preserved draft at verified revision'}
                  </span>
                </button>
              )}
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

        {/* Inline Catalog Draft Handoff Panel (Only rendered when savedReviewCase is METADATA_RECORDED and flags/RBAC pass) */}
        {!loading && !loadError && catalogHandoffController && (
          <LibraryQuarantineCatalogHandoffPanel
            controller={catalogHandoffController}
            currentUser={currentUser}
            savedReviewCase={reviewCase}
            hasUnsavedCaseEdits={Boolean(
              reviewCase &&
                (form.status !== reviewCase.status ||
                  form.titleAr !== reviewCase.titleAr ||
                  form.titleEn !== reviewCase.titleEn ||
                  form.issuingOrganization !== reviewCase.issuingOrganization ||
                  form.summaryAr !== reviewCase.summaryAr ||
                  form.summaryEn !== reviewCase.summaryEn ||
                  form.sourceEvidenceNotes !== reviewCase.sourceEvidenceNotes ||
                  form.rightsEvidenceNotes !== reviewCase.rightsEvidenceNotes ||
                  form.editorialNotes !== reviewCase.editorialNotes)
            )}
            organizations={organizations}
            sources={sources}
            isAr={isAr}
            onReloadHumanReviewCase={() => {
              void controller.reloadCase();
            }}
          />
        )}

        {/* Inline Human Rights Decision & Readiness Panel (Independent of CatalogHandoffPanel so RightsReviewer without Create can access) */}
        {!loading && !loadError && (
          <LibraryQuarantineRightsDecisionPanel
            controller={effectiveRightsDecisionController}
            currentUser={currentUser}
            savedReviewCase={reviewCase}
            hasUnsavedCaseEdits={Boolean(
              reviewCase &&
                (form.status !== reviewCase.status ||
                  form.titleAr !== reviewCase.titleAr ||
                  form.titleEn !== reviewCase.titleEn ||
                  form.issuingOrganization !== reviewCase.issuingOrganization ||
                  form.summaryAr !== reviewCase.summaryAr ||
                  form.summaryEn !== reviewCase.summaryEn ||
                  form.sourceEvidenceNotes !== reviewCase.sourceEvidenceNotes ||
                  form.rightsEvidenceNotes !== reviewCase.rightsEvidenceNotes ||
                  form.editorialNotes !== reviewCase.editorialNotes)
            )}
            isAr={isAr}
          />
        )}

        {/* Inline Binary Safety Casework Panel (Owner only) */}
        {!loading && !loadError && receipt && (
          <LibraryQuarantineBinarySafetyCasePanel
            key={receipt.receiptId}
            receiptId={receipt.receiptId}
            currentUser={currentUser}
            lang={isAr ? 'ar' : 'en'}
            savedReviewCase={reviewCase}
            hasUnsavedCaseEdits={Boolean(
              reviewCase &&
                (form.status !== reviewCase.status ||
                  form.titleAr !== reviewCase.titleAr ||
                  form.titleEn !== reviewCase.titleEn ||
                  form.issuingOrganization !== reviewCase.issuingOrganization ||
                  form.summaryAr !== reviewCase.summaryAr ||
                  form.summaryEn !== reviewCase.summaryEn ||
                  form.sourceEvidenceNotes !== reviewCase.sourceEvidenceNotes ||
                  form.rightsEvidenceNotes !== reviewCase.rightsEvidenceNotes ||
                  form.editorialNotes !== reviewCase.editorialNotes)
            )}
          />
        )}

        {/* Inline External Source Release Panel (LIB-PUBLISH-01) */}
        {!loading && !loadError && (
          <LibraryQuarantineReviewedSourceReleaseSection
            controller={effectiveReleaseController}
            currentUser={currentUser}
            savedReviewCase={reviewCase}
            hasUnsavedCaseEdits={Boolean(
              reviewCase &&
                (form.status !== reviewCase.status ||
                  form.titleAr !== reviewCase.titleAr ||
                  form.titleEn !== reviewCase.titleEn ||
                  form.issuingOrganization !== reviewCase.issuingOrganization ||
                  form.summaryAr !== reviewCase.summaryAr ||
                  form.summaryEn !== reviewCase.summaryEn ||
                  form.sourceEvidenceNotes !== reviewCase.sourceEvidenceNotes ||
                  form.rightsEvidenceNotes !== reviewCase.rightsEvidenceNotes ||
                  form.editorialNotes !== reviewCase.editorialNotes)
            )}
            isAr={isAr}
            envOverride={envOverride}
          />
        )}

        {/* Inline Direct Uploaded Binary Release Panel (LIB-DIRECT-FILE-01) */}
        {!loading && !loadError && (
          <LibraryQuarantinePublishedBinaryReleaseSection
            controller={effectiveBinaryReleaseController}
            currentUser={currentUser}
            savedReviewCase={reviewCase}
            hasUnsavedCaseEdits={Boolean(
              reviewCase &&
                (form.status !== reviewCase.status ||
                  form.titleAr !== reviewCase.titleAr ||
                  form.titleEn !== reviewCase.titleEn ||
                  form.issuingOrganization !== reviewCase.issuingOrganization ||
                  form.summaryAr !== reviewCase.summaryAr ||
                  form.summaryEn !== reviewCase.summaryEn ||
                  form.sourceEvidenceNotes !== reviewCase.sourceEvidenceNotes ||
                  form.rightsEvidenceNotes !== reviewCase.rightsEvidenceNotes ||
                  form.editorialNotes !== reviewCase.editorialNotes)
            )}
            isAr={isAr}
            envOverride={envOverride}
          />
        )}
      </div>
    </div>
  );
}

interface LibraryQuarantineReviewedSourceReleaseSectionProps {
  readonly controller: LibraryQuarantineReviewedSourceReleasePanelController;
  readonly currentUser: AdminUser | null;
  readonly savedReviewCase: SanitizedLibraryQuarantineHumanReviewCaseDto | null;
  readonly hasUnsavedCaseEdits: boolean;
  readonly isAr: boolean;
  readonly envOverride?: Record<string, unknown>;
}

function getPublicLinkBasisLabel(
  basis: ReviewedPublicLinkBasis,
  isAr: boolean
): string {
  switch (basis) {
    case 'PUBLIC_DOMAIN_FULL_TEXT':
      return isAr ? 'ملكية عامة — نص كامل' : 'Public Domain — Full Text';
    case 'OPEN_LICENSE_FULL_TEXT':
      return isAr ? 'ترخيص مفتوح للنص الكامل' : 'Open License — Full Text';
    case 'EXPLICIT_PUBLISHER_PERMISSION_FULL_TEXT':
      return isAr
        ? 'إذن صريح من الناشر للربط العام'
        : 'Explicit Publisher Permission — Public Link';
    case 'OFFICIAL_PUBLIC_SOURCE_LINK':
      return isAr
        ? 'رابط مصدر حكومي/رسمي متاح للعامة'
        : 'Official Public Source Link';
  }
}

export function LibraryQuarantineReviewedSourceReleaseSection({
  controller,
  currentUser,
  savedReviewCase,
  hasUnsavedCaseEdits,
  isAr,
  envOverride,
}: LibraryQuarantineReviewedSourceReleaseSectionProps) {
  const [state, setState] =
    useState<LibraryQuarantineReviewedSourceReleasePanelSnapshot>(() =>
      controller.getSnapshot()
    );

  const lastLoadedKeyRef = useRef<string>('');

  useEffect(() => {
    setState(controller.getSnapshot());
    return controller.subscribe((next) => {
      setState(next);
    });
  }, [controller]);

  const isEnabled =
    state.enabled || isLibraryQuarantineReviewedSourceReleaseEnabled(envOverride);
  const canPublish = canUserPublishReviewedLibrarySourceReference(currentUser);
  const isSavedCaseMetadataRecorded =
    savedReviewCase !== null && savedReviewCase.status === 'METADATA_RECORDED';

  useEffect(() => {
    if (!isEnabled || !canPublish || !isSavedCaseMetadataRecorded) {
      lastLoadedKeyRef.current = '';
      return;
    }
    const loadKey = `${savedReviewCase.receiptId}:${savedReviewCase.revision}`;
    if (lastLoadedKeyRef.current !== loadKey) {
      lastLoadedKeyRef.current = loadKey;
      void controller.openForSavedCase(savedReviewCase);
    }
  }, [
    controller,
    isEnabled,
    canPublish,
    isSavedCaseMetadataRecorded,
    savedReviewCase,
  ]);

  if (!isEnabled || !canPublish || !isSavedCaseMetadataRecorded) {
    return null;
  }

  const {
    loading,
    publishing,
    readinessStatus,
    holdCode,
    holdMessage,
    form,
    confirmed,
    loadError,
    publishError,
    lastOutcome,
    conflictState,
    uncertainState,
  } = state;

  const isPublished = readinessStatus?.isPublished === true;
  const isEligible = readinessStatus?.eligibleForPublish === true;
  const isNotAuthorizedForLink =
    holdCode === 'RIGHTS_NOT_AUTHORIZED_FOR_PUBLIC_LINK' ||
    (readinessStatus !== null &&
      readinessStatus.rightsAuthorizedForMetadata === false);

  return (
    <section
      data-testid="quarantine-reviewed-source-release-panel"
      aria-labelledby="quarantine-reviewed-source-release-heading"
      className="p-4 sm:p-5 rounded-2xl border-2 border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-4 text-xs"
      dir={isAr ? 'rtl' : 'ltr'}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-emerald-200/80 dark:border-emerald-900/60 pb-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300">
              <Globe className="h-4 w-4" />
            </span>
            <h4
              id="quarantine-reviewed-source-release-heading"
              data-testid="quarantine-reviewed-source-release-title"
              className="text-sm font-extrabold text-gray-900 dark:text-gray-100"
            >
              {isAr ? 'إتاحة في المكتبة العامة' : 'Publish to Public Library'}
            </h4>
            <span
              data-testid="quarantine-reviewed-source-release-badge"
              className={`px-2 py-0.5 rounded-md font-bold text-[11px] border ${
                isPublished
                  ? 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-900/60 dark:text-emerald-200 dark:border-emerald-700'
                  : isNotAuthorizedForLink
                    ? 'bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-800'
                    : isEligible
                      ? 'bg-teal-100 text-teal-900 border-teal-300 dark:bg-teal-950/60 dark:text-teal-200 dark:border-teal-800'
                      : 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800'
              }`}
            >
              {isPublished
                ? isAr
                  ? 'متاح في المكتبة العامة'
                  : 'PUBLISHED PUBLIC LINK'
                : isNotAuthorizedForLink
                  ? 'NOT AUTHORIZED FOR PUBLIC LINK'
                  : isEligible
                    ? isAr
                      ? 'جاهز للإتاحة برابط المصدر الأصلي'
                      : 'ELIGIBLE FOR SOURCE RELEASE'
                    : isAr
                      ? 'موقوف لحين استيفاء المتطلبات'
                      : 'HOLD'}
            </span>
          </div>
          <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
            {isAr
              ? 'ينشئ هذا الإجراء سجلاً عاماً مفهرساً مرتبطاً بالرابط الرسمي الموثّق للناشر الأصلي فقط، مع إبقاء مسودة الحجر الداخلية مغلقة ودون أي نسخ أو إتاحة لملفات PDF/DOCX المحجورة.'
              : 'Publishes a reviewed catalog entry linked strictly to a verified external publisher HTTPS URL. The internal quarantine draft stays locked and quarantined binary files are never copied or exposed.'}
          </p>
        </div>

        <button
          type="button"
          data-testid="refresh-reviewed-source-release-btn"
          disabled={loading || publishing}
          onClick={() => {
            void controller.reloadStatus();
          }}
          className="px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold text-[11px] cursor-pointer disabled:opacity-50 inline-flex items-center gap-1"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          <span>{isAr ? 'تحقق من الجاهزية' : 'Check Readiness'}</span>
        </button>
      </div>

      {hasUnsavedCaseEdits && (
        <div
          data-testid="reviewed-source-release-unsaved-hold"
          className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 font-bold"
        >
          {isAr
            ? 'يوجد تعديل غير محفوظ في سجل المراجعة البشرية — احفظ السجل وأجرِ المواءمة قبل الإتاحة العامة.'
            : 'Unsaved edits exist in the human review case. Save and align before publishing.'}
        </div>
      )}

      {loading && (
        <div
          data-testid="reviewed-source-release-loading"
          className="p-4 text-center text-gray-600 dark:text-gray-400 flex items-center justify-center gap-2 font-bold"
        >
          <Loader2 className="h-4 w-4 animate-spin text-emerald-700" />
          <span>
            {isAr
              ? 'جاري فحص أهلية الإتاحة العامة وسلسلة الحقوق...'
              : 'Verifying alignment, source registry, and rights eligibility...'}
          </span>
        </div>
      )}

      {!loading && loadError && (
        <div
          data-testid="reviewed-source-release-load-error"
          role="alert"
          className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200"
        >
          <div className="font-extrabold">
            {isAr ? 'تعذر فحص حالة الإتاحة العامة' : 'Failed to Load Release Status'}
          </div>
          <p className="font-mono text-[11px] mt-1">{loadError}</p>
        </div>
      )}

      {!loading && !loadError && holdCode && (
        <div
          data-testid="reviewed-source-release-hold-banner"
          role="alert"
          className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-950 dark:text-rose-100 space-y-1.5"
        >
          <div className="font-extrabold flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>
              {isNotAuthorizedForLink
                ? isAr
                  ? 'غير مخوّل للنشر أو الربط العام — NOT AUTHORIZED FOR PUBLIC LINK'
                  : 'NOT AUTHORIZED FOR PUBLIC LINK'
                : isAr
                  ? 'الإتاحة العامة موقوفة لحين استيفاء المتطلبات'
                  : 'Public Source Release Held'}
            </span>
          </div>
          <div
            data-testid="reviewed-source-release-hold-code"
            className="font-mono text-[11px] font-bold"
            dir="ltr"
          >
            {holdCode}
          </div>
          {holdMessage && (
            <p className="text-[11px] leading-relaxed">{holdMessage}</p>
          )}
        </div>
      )}

      {uncertainState && (
        <div
          data-testid="reviewed-source-release-uncertain-banner"
          role="alert"
          className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border-2 border-amber-400 text-amber-950 dark:text-amber-100 space-y-2"
        >
          <div className="font-extrabold flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <span>
              {isAr
                ? 'نتيجة النشر غير مؤكدة — تم إيقاف إعادة الإرسال التلقائي'
                : 'Publish Commit Uncertain — Automatic Retry Stopped'}
            </span>
          </div>
          <p className="text-[11px]">{uncertainState.errorMessage}</p>
          <button
            type="button"
            data-testid="verify-reviewed-source-release-btn"
            disabled={loading || publishing}
            onClick={() => {
              void controller.verifyUncertainPublish();
            }}
            className="px-3.5 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-extrabold text-xs cursor-pointer inline-flex items-center gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>{isAr ? 'تحقق من حالة النشر' : 'Verify release status'}</span>
          </button>
        </div>
      )}

      {conflictState && (
        <div
          data-testid="reviewed-source-release-conflict-banner"
          role="alert"
          className="p-3.5 rounded-xl bg-orange-50 dark:bg-orange-950/40 border border-orange-300 dark:border-orange-800 text-orange-950 dark:text-orange-100 space-y-2"
        >
          <div className="font-extrabold">
            {isAr
              ? `تعارض في البيانات (${conflictState.errorCode})`
              : `Release Precondition Conflict (${conflictState.errorCode})`}
          </div>
          <p className="text-[11px]">{conflictState.errorMessage}</p>
          <button
            type="button"
            data-testid="reload-reviewed-source-release-conflict-btn"
            onClick={() => {
              void controller.reloadStatus();
            }}
            className="px-3 py-1.5 rounded-lg bg-orange-700 text-white font-bold text-xs cursor-pointer"
          >
            {isAr ? 'تحديث الحالة الحالية' : 'Refresh Current State'}
          </button>
        </div>
      )}

      {!loading &&
        !loadError &&
        readinessStatus &&
        isPublished &&
        readinessStatus.publicDocument && (
          <div
            data-testid="reviewed-source-release-published-summary"
            className="p-3.5 rounded-xl bg-emerald-100/70 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800 space-y-2 text-emerald-950 dark:text-emerald-100"
          >
            <div className="font-extrabold flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
              <span>
                {lastOutcome === 'ALREADY_PUBLISHED'
                  ? isAr
                    ? 'السجل منشور مسبقاً في المكتبة العامة'
                    : 'Already Published in Public Library'
                  : isAr
                    ? 'تمت الإتاحة في المكتبة العامة برابط المصدر الموثّق'
                    : 'Published to Public Library with Verified Publisher Link'}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="font-bold">
                  {isAr ? 'معرّف السجل العام: ' : 'Public Document ID: '}
                </span>
                <span
                  data-testid="reviewed-source-release-public-doc-id"
                  className="font-mono font-bold"
                  dir="ltr"
                >
                  {readinessStatus.publicDocument.id}
                </span>
              </div>
              <div>
                <span className="font-bold">
                  {isAr ? 'حالة الحقوق العامة: ' : 'Public Rights Status: '}
                </span>
                <span className="font-mono font-bold" dir="ltr">
                  {readinessStatus.publicDocument.rightsStatus}
                </span>
              </div>
              <div>
                <span className="font-bold">
                  {isAr ? 'مسودة الحجر الداخلية: ' : 'Quarantine Draft: '}
                </span>
                <span className="font-mono" dir="ltr">
                  {readinessStatus.quarantineCatalogDocumentId} (
                  {readinessStatus.quarantineDraftWorkflowState})
                </span>
              </div>
              <div>
                <span className="font-bold">
                  {isAr ? 'كشف الملف الثنائي: ' : 'Quarantine Binary Exposed: '}
                </span>
                <span className="font-mono" dir="ltr">
                  {String(readinessStatus.quarantineBinaryExposed)}
                </span>
              </div>
            </div>
            <div className="pt-1">
              <a
                href={readinessStatus.publicDocument.referenceUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="reviewed-source-release-public-link"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-gray-900 border border-emerald-400 text-emerald-900 dark:text-emerald-200 font-bold hover:underline break-all"
                dir="ltr"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                <span>{readinessStatus.publicDocument.referenceUrl}</span>
              </a>
            </div>
          </div>
        )}

      {!loading &&
        !loadError &&
        readinessStatus &&
        !isPublished && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 rounded-xl bg-white dark:bg-gray-900/70 border border-gray-200 dark:border-gray-800 text-[11px]">
              <div>
                <span className="font-bold">
                  {isAr ? 'مواءمة الفهرس والحالة: ' : 'Catalog Alignment: '}
                </span>
                <span className="font-mono" dir="ltr">
                  {readinessStatus.catalogAligned ? 'ALIGNED' : 'NOT_ALIGNED'} (v
                  {readinessStatus.effectiveAlignedCaseRevision})
                </span>
              </div>
              <div>
                <span className="font-bold">
                  {isAr ? 'قرار حقوق الفهرسة: ' : 'Rights Decision: '}
                </span>
                <span className="font-mono" dir="ltr">
                  {readinessStatus.currentRightsDecision ?? 'NONE'}
                </span>
              </div>
              <div>
                <span className="font-bold">
                  {isAr ? 'حالة توثيق المصدر: ' : 'Source Verification: '}
                </span>
                <span className="font-mono" dir="ltr">
                  {readinessStatus.sourceVerified ? 'Verified' : 'NOT_VERIFIED'}
                </span>
              </div>
              <div>
                <span className="font-bold">
                  {isAr ? 'معرّف النشر المتوقع: ' : 'Target Public ID: '}
                </span>
                <span className="font-mono" dir="ltr">
                  {readinessStatus.publicDocumentId}
                </span>
              </div>
            </div>

            {isEligible && !hasUnsavedCaseEdits ? (
              <div
                data-testid="reviewed-source-release-form"
                className="space-y-3"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label
                      htmlFor="release-public-rights-status"
                      className="block font-bold text-gray-700 dark:text-gray-300"
                    >
                      {isAr
                        ? 'تصنيف الحقوق للنشر العام'
                        : 'Public Rights Classification'}
                    </label>
                    <select
                      id="release-public-rights-status"
                      data-testid="release-public-rights-status-select"
                      disabled={publishing}
                      value={form.publicRightsStatus}
                      onChange={(e) =>
                        controller.updateFormField(
                          'publicRightsStatus',
                          e.target.value as ReviewedPublicLibraryRightsStatus
                        )
                      }
                      className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-bold"
                    >
                      {REVIEWED_PUBLIC_RIGHTS_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="release-public-link-basis"
                      className="block font-bold text-gray-700 dark:text-gray-300"
                    >
                      {isAr
                        ? 'الأساس الحقوقي للرابط الكامل'
                        : 'Public Full-Text Link Authorization Basis'}
                    </label>
                    <select
                      id="release-public-link-basis"
                      data-testid="release-public-link-basis-select"
                      disabled={publishing}
                      value={form.publicLinkBasis}
                      onChange={(e) =>
                        controller.updateFormField(
                          'publicLinkBasis',
                          e.target.value as ReviewedPublicLinkBasis
                        )
                      }
                      className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-bold"
                    >
                      {REVIEWED_PUBLIC_LINK_BASES.map((basis) => (
                        <option key={basis} value={basis}>
                          {getPublicLinkBasisLabel(basis, isAr)} ({basis})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="release-verified-source-url"
                    className="block font-bold text-gray-700 dark:text-gray-300"
                  >
                    {isAr
                      ? 'رابط الناشر الأصلي الموثّق (HTTPS فقط)'
                      : 'Verified Original Publisher URL (Strict HTTPS Only)'}
                  </label>
                  <input
                    id="release-verified-source-url"
                    data-testid="release-verified-source-url-input"
                    type="url"
                    dir="ltr"
                    disabled={publishing}
                    value={form.verifiedSourceUrl}
                    onChange={(e) =>
                      controller.updateFormField(
                        'verifiedSourceUrl',
                        e.target.value
                      )
                    }
                    placeholder="https://official-publisher.org/law-document"
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label
                      htmlFor="release-evidence-reference"
                      className="block font-bold text-gray-700 dark:text-gray-300"
                    >
                      {isAr
                        ? 'مرجع سند الحقوق للربط العام'
                        : 'Full-Text Public Link Evidence Reference'}
                    </label>
                    <input
                      id="release-evidence-reference"
                      data-testid="release-evidence-reference-input"
                      type="text"
                      disabled={publishing}
                      value={form.rightsEvidenceReference}
                      onChange={(e) =>
                        controller.updateFormField(
                          'rightsEvidenceReference',
                          e.target.value
                        )
                      }
                      placeholder={
                        isAr
                          ? 'مثال: الجريدة الرسمية / خطاب الموافقة...'
                          : 'e.g., Official Gazette Issue #14 / Written License...'
                      }
                      className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                    />
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="release-evidence-summary"
                      className="block font-bold text-gray-700 dark:text-gray-300"
                    >
                      {isAr
                        ? 'ملخص التحقق البشري من إتاحة الرابط'
                        : 'Human Verification Summary for Public Link'}
                    </label>
                    <textarea
                      id="release-evidence-summary"
                      data-testid="release-evidence-summary-input"
                      rows={2}
                      disabled={publishing}
                      value={form.rightsEvidenceSummary}
                      onChange={(e) =>
                        controller.updateFormField(
                          'rightsEvidenceSummary',
                          e.target.value
                        )
                      }
                      placeholder={
                        isAr
                          ? 'توثيق صريح لصلاحية الربط بالرابط الرسمي الكامل...'
                          : 'Explicit verification of full-text public linking clearance...'
                      }
                      className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                </div>

                {publishError && (
                  <div
                    data-testid="reviewed-source-release-publish-error"
                    role="alert"
                    className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200 font-mono text-[11px]"
                  >
                    {publishError}
                  </div>
                )}

                <label className="flex items-start gap-2 p-2.5 rounded-xl bg-white dark:bg-gray-900/60 border border-emerald-200 dark:border-emerald-900 cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="release-confirmation-checkbox"
                    disabled={publishing}
                    checked={confirmed}
                    onChange={(e) => controller.setConfirmed(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="text-[11px] font-bold text-gray-800 dark:text-gray-200">
                    {isAr
                      ? `أؤكد إتاحة السجل في المكتبة العامة عبر رابط الناشر الرسمي الموثّق دون إتاحة أي ملف محجور (${LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL}).`
                      : `I confirm publishing this catalog entry to the public library via its verified official publisher URL without exposing quarantined binaries (${LIBRARY_REVIEWED_SOURCE_RELEASE_CONFIRMATION_LITERAL}).`}
                  </span>
                </label>

                <button
                  type="button"
                  data-testid="publish-reviewed-source-release-btn"
                  disabled={publishing || !confirmed || uncertainState !== null}
                  onClick={() => {
                    void controller.publish();
                  }}
                  className="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2 shadow-xs"
                >
                  {publishing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Globe className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {publishing
                      ? isAr
                        ? 'جاري الإتاحة في المكتبة العامة...'
                        : 'Publishing to Public Library...'
                      : isAr
                        ? 'إتاحة في المكتبة العامة'
                        : 'Publish to Public Library'}
                  </span>
                </button>
              </div>
            ) : (
              <div className="pt-1">
                <button
                  type="button"
                  data-testid="publish-reviewed-source-release-btn"
                  disabled={true}
                  aria-disabled="true"
                  className="px-4 py-2.5 rounded-xl bg-gray-300 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-extrabold text-xs cursor-not-allowed inline-flex items-center gap-2"
                >
                  <Lock className="h-3.5 w-3.5" />
                  <span>
                    {isNotAuthorizedForLink
                      ? isAr
                        ? 'غير مخوّل للنشر العام — NOT AUTHORIZED FOR PUBLIC LINK'
                        : 'NOT AUTHORIZED FOR PUBLIC LINK'
                      : isAr
                        ? 'إتاحة في المكتبة العامة (موقوف)'
                        : 'Publish to Public Library (Disabled)'}
                  </span>
                </button>
              </div>
            )}
      </div>
        )}
    </section>
  );
}

interface LibraryQuarantinePublishedBinaryReleaseSectionProps {
  readonly controller: LibraryQuarantinePublishedBinaryReleasePanelController;
  readonly currentUser: AdminUser | null;
  readonly savedReviewCase: SanitizedLibraryQuarantineHumanReviewCaseDto | null;
  readonly hasUnsavedCaseEdits: boolean;
  readonly isAr: boolean;
  readonly envOverride?: Record<string, unknown>;
}

function getBinaryRightsBasisLabel(
  basis: PublishedBinaryRightsBasis,
  isAr: boolean
): string {
  switch (basis) {
    case 'OWNER_COPYRIGHT_BINARY_DISTRIBUTION':
      return isAr
        ? 'أنا المالك وأملك حقوق النشر والتوزيع للملف المرفوع'
        : 'Owner / Author Holding Binary Distribution Rights';
    case 'EXPLICIT_BINARY_REDISTRIBUTION_PERMISSION':
      return isAr
        ? 'لدي إذن صريح وموثّق لإعادة نشر الملف المرفوع'
        : 'Explicit Written Binary Redistribution Permission';
    case 'OPEN_LICENSE_BINARY_REDISTRIBUTION':
      return isAr
        ? 'ترخيص مفتوح يسمح بإعادة نشر وتنزيل الملف'
        : 'Open License Allowing Binary Redistribution';
    case 'PUBLIC_DOMAIN_BINARY_DISTRIBUTION':
      return isAr
        ? 'ملكية عامة تسمح بنشر وتنزيل الملف'
        : 'Public Domain Binary Distribution';
  }
}

export function formatLibraryQuarantineHoldGuidance(
  holdCode: string | null | undefined,
  avExecutionState: string | null | undefined,
  isAr: boolean
): string | null {
  const code = (holdCode || '').trim();
  const state = (avExecutionState || '').trim();

  if (code === 'PDF_ACTIVE_CONTENT_OR_UNSAFE_STRUCTURE') {
    return isAr
      ? 'فشل الفحص البنيوي المعزول لملف PDF لاحتوائه على محتوى نشط أو بنية غير آمنة (مثل JavaScript أو ملفات مضمّنة أو أوامر تشغيل أو روابط خارجية غير آمنة). يرجى مراجعة الملف وإعادة تصديره بصيغة PDF نظيفة وثابتة قبل إعادة الرفع.'
      : 'Isolated PDF structural inspection failed because the PDF contains active content or unsafe structure (such as JavaScript, embedded files, launch/form actions, or unsafe URI schemes). Export a clean static PDF before re-uploading.';
  }
  if (code === 'PDF_ENCRYPTED_OR_MALFORMED') {
    return isAr
      ? 'ملف PDF مشفّر/محمي بكلمة مرور أو تالف بنيوياً (أو أظهر تحذيرات من قارئ qpdf). يرجى إزالة التشفير أو إعادة تصدير الملف بصيغة PDF قياسية سليمة.'
      : 'The PDF is encrypted/password-protected or structurally malformed (or produced qpdf warnings). Remove encryption or re-export a clean standard PDF.';
  }
  if (code === 'PDF_PARSER_BINARY_MISSING') {
    return isAr
      ? 'تعذر تنفيذ الفحص البنيوي المعزول لملف PDF لعدم توفر أداة التحليل (qpdf) في حاوية الفحص. يرجى إبلاغ مسؤول التشغيل.'
      : 'Isolated PDF inspection could not run because the qpdf parser binary was unavailable in the worker container. Contact platform operations.';
  }
  if (code === 'PDF_INSPECTION_TIMEOUT') {
    return isAr
      ? 'انتهت المهلة المحددة للفحص البنيوي المعزول لملف PDF. تحقق من حجم/تعقيد الملف أو أعد المحاولة بعد المراجعة.'
      : 'Isolated PDF structural inspection timed out. Check file complexity or retry after review.';
  }
  if (code === 'PDF_INSPECTION_FAILED') {
    return isAr
      ? 'أُغلق الفحص البنيوي المعزول لملف PDF احترازياً قبل اكتمال التحقق. راجع قسم السلامة الثنائية وسجلات عامل الفحص المعزول.'
      : 'Isolated PDF structural inspection failed closed before verification completed. Check the Binary Safety section and worker diagnostic logs.';
  }
  if (code === 'PDF_INSPECTION_ATTESTATION_MISSING_OR_INVALID') {
    return isAr
      ? 'لا تتوفر شهادة فحص بنيوي صالحة للإصدار الحالي من ملف PDF. أعد تشغيل الفحص المعزول قبل النشر.'
      : 'A valid current-revision isolated PDF structural inspection attestation is missing. Re-run isolated inspection before publishing.';
  }
  if (state === 'AV_THREAT_DETECTED' || code === 'AV_THREAT_DETECTED') {
    return isAr
      ? 'رصد فحص ClamAV تهديداً أمنياً في الملف؛ النشر المباشر محظور تماماً.'
      : 'ClamAV detected a security threat in this binary; public publication is permanently blocked.';
  }
  if (state === 'AV_SCAN_FAILED' || code === 'AV_SCAN_FAILED') {
    return isAr
      ? 'فشل الفحص المعزول (ClamAV / فحص PDF البنيوي) وأُغلق احترازياً. راجع رمز الفشل التفصيلي في لوحة السلامة الثنائية أعلاه قبل أي إجراء.'
      : 'Isolated AV or PDF structural inspection failed closed. Check the specific failure code in the Binary Safety panel above before taking action.';
  }
  return null;
}

export function LibraryQuarantinePublishedBinaryReleaseSection({
  controller,
  currentUser,
  savedReviewCase,
  hasUnsavedCaseEdits,
  isAr,
  envOverride,
}: LibraryQuarantinePublishedBinaryReleaseSectionProps) {
  const [state, setState] =
    useState<LibraryQuarantinePublishedBinaryReleasePanelSnapshot>(() =>
      controller.getSnapshot()
    );

  const lastLoadedKeyRef = useRef<string>('');

  useEffect(() => {
    setState(controller.getSnapshot());
    return controller.subscribe((next) => {
      setState(next);
    });
  }, [controller]);

  const isEnabled =
    state.enabled || isLibraryQuarantinePublishedBinaryReleaseEnabled(envOverride);
  const canPublish =
    canUserPublishQuarantinedBinaryToPublicLibrary(currentUser);
  const isSavedCaseMetadataRecorded =
    savedReviewCase !== null && savedReviewCase.status === 'METADATA_RECORDED';

  useEffect(() => {
    if (!isEnabled || !canPublish || !isSavedCaseMetadataRecorded) {
      lastLoadedKeyRef.current = '';
      return;
    }
    const loadKey = `${savedReviewCase.receiptId}:${savedReviewCase.revision}`;
    if (lastLoadedKeyRef.current !== loadKey) {
      lastLoadedKeyRef.current = loadKey;
      void controller.openForSavedCase(savedReviewCase);
    }
  }, [
    controller,
    isEnabled,
    canPublish,
    isSavedCaseMetadataRecorded,
    savedReviewCase,
  ]);

  if (!isEnabled || !canPublish || !isSavedCaseMetadataRecorded) {
    return null;
  }

  const {
    loading,
    publishing,
    readinessStatus,
    holdCode,
    holdMessage,
    form,
    confirmed,
    loadError,
    publishError,
    lastOutcome,
    conflictState,
    uncertainState,
  } = state;

  const isPublished = readinessStatus?.isPublished === true;
  const isEligible = readinessStatus?.eligibleForPublish === true;
  const avExecutionState = readinessStatus?.avExecutionState ?? null;
  const isTerminalScanFailure =
    avExecutionState === 'AV_SCAN_FAILED' ||
    avExecutionState === 'AV_THREAT_DETECTED' ||
    avExecutionState === 'DISPATCH_FAILED' ||
    avExecutionState === 'STALE_HOLD' ||
    (typeof holdCode === 'string' &&
      (holdCode.startsWith('PDF_') ||
        holdCode === 'AV_SCAN_FAILED' ||
        holdCode === 'AV_THREAT_DETECTED'));
  const waitingForScan =
    !isTerminalScanFailure &&
    (holdCode === 'WAITING_FOR_ACTUAL_SCAN' ||
      (readinessStatus !== null &&
        !readinessStatus.isScanCleanForCurrentRevision));
  const holdGuidance = formatLibraryQuarantineHoldGuidance(
    holdCode,
    avExecutionState,
    isAr
  );

  return (
    <section
      data-testid="quarantine-published-binary-release-panel"
      aria-labelledby="quarantine-published-binary-release-heading"
      className="p-4 sm:p-5 rounded-2xl border-2 border-indigo-200 dark:border-indigo-900/70 bg-indigo-50/40 dark:bg-indigo-950/20 space-y-4 text-xs"
      dir={isAr ? 'rtl' : 'ltr'}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-indigo-200/80 dark:border-indigo-900/60 pb-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-900/60 text-indigo-800 dark:text-indigo-300">
              <Download className="h-4 w-4" />
            </span>
            <h4
              id="quarantine-published-binary-release-heading"
              data-testid="quarantine-published-binary-release-title"
              className="text-sm font-extrabold text-gray-900 dark:text-gray-100"
            >
              {isAr
                ? 'نشر الملف المرفوع للتحميل'
                : 'Publish Uploaded File for Download'}
            </h4>
            <span
              data-testid="quarantine-published-binary-release-badge"
              className={`px-2 py-0.5 rounded-md font-bold text-[11px] border ${
                isPublished
                  ? 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-900/60 dark:text-emerald-200 dark:border-emerald-700'
                  : waitingForScan
                    ? 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800'
                    : isEligible
                      ? 'bg-indigo-100 text-indigo-900 border-indigo-300 dark:bg-indigo-950/60 dark:text-indigo-200 dark:border-indigo-800'
                      : 'bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-800'
              }`}
            >
              {isPublished
                ? isAr
                  ? 'منشور للتحميل المباشر'
                  : 'PUBLISHED FOR DIRECT DOWNLOAD'
                : waitingForScan
                  ? isAr
                    ? 'بانتظار نتيجة فحص ClamAV الفعلي'
                    : 'WAITING_FOR_ACTUAL_SCAN'
                  : isEligible
                    ? isAr
                      ? 'جاهز لنشر الملف المرفوع'
                      : 'ELIGIBLE FOR BINARY RELEASE'
                    : isTerminalScanFailure
                      ? isAr
                        ? 'فشل الفحص الأمني / البنيوي (موقوف)'
                        : 'SCAN FAILED (HOLD)'
                      : isAr
                        ? 'موقوف لحين استيفاء المتطلبات'
                        : 'HOLD'}
            </span>
          </div>
          <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
            {isAr
              ? 'يتيح هذا المسار نشر ملف PDF أو Word المرفوع نفسه في المكتبة العامة ليقوم الزائر بتنزيله مباشرةً كمرفق آمن دون الحاجة لأي رابط خارجي أو إعادة رفع، بعد تحقق الفحص النظيف وموافقة المالك.'
              : 'Publishes the already-uploaded PDF or Word binary itself for safe attachment download from Public Library without external publisher links or re-upload, strictly after clean ClamAV verification and explicit binary rights approval.'}
          </p>
        </div>

        <button
          type="button"
          data-testid="refresh-published-binary-release-btn"
          disabled={loading || publishing}
          onClick={() => {
            void controller.reloadStatus();
          }}
          className="px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold text-[11px] cursor-pointer disabled:opacity-50 inline-flex items-center gap-1"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          <span>{isAr ? 'تحديث حالة النشر' : 'Check Binary Readiness'}</span>
        </button>
      </div>

      {hasUnsavedCaseEdits && (
        <div
          data-testid="published-binary-release-unsaved-hold"
          className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 font-bold"
        >
          {isAr
            ? 'يوجد تعديل غير محفوظ في سجل المراجعة البشرية — احفظ السجل وأجرِ المواءمة قبل نشر الملف المرفوع.'
            : 'Unsaved edits exist in the human review case. Save and align before publishing the uploaded file.'}
        </div>
      )}

      {loading && (
        <div
          data-testid="published-binary-release-loading"
          className="p-4 text-center text-gray-600 dark:text-gray-400 flex items-center justify-center gap-2 font-bold"
        >
          <Loader2 className="h-4 w-4 animate-spin text-indigo-700" />
          <span>
            {isAr
              ? 'جاري التحقق من الفحص الأمني ومواءمة الفهرس وأهلية النشر الثنائي...'
              : 'Verifying ClamAV execution, alignment, and binary release readiness...'}
          </span>
        </div>
      )}

      {!loading && loadError && (
        <div
          data-testid="published-binary-release-load-error"
          role="alert"
          className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200"
        >
          <div className="font-extrabold">
            {isAr
              ? 'تعذر فحص حالة نشر الملف المرفوع'
              : 'Failed to Load Binary Release Status'}
          </div>
          <p className="font-mono text-[11px] mt-1">{loadError}</p>
        </div>
      )}

      {!loading && !loadError && (holdCode || isTerminalScanFailure) && (
        <div
          data-testid="published-binary-release-hold-banner"
          role="alert"
          className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-950 dark:text-rose-100 space-y-1.5"
        >
          <div className="font-extrabold flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>
              {waitingForScan
                ? isAr
                  ? 'نشر الملف المرفوع موقوف — بانتظار نتيجة فحص ClamAV النظيفة الفعلية'
                  : 'Binary Release Held — WAITING FOR ACTUAL CLEAN CLAMAV SCAN'
                : isTerminalScanFailure
                  ? isAr
                    ? 'نشر الملف المرفوع موقوف — فشل الفحص الأمني أو البنيوي المعزول'
                    : 'Binary Release Held — Isolated Security / Structural Inspection Failed'
                  : isAr
                    ? 'نشر الملف المرفوع موقوف لحين استيفاء المتطلبات'
                    : 'Binary Release Held'}
            </span>
          </div>
          {(holdCode || avExecutionState) && (
            <div
              data-testid="published-binary-release-hold-code"
              className="font-mono text-[11px] font-bold"
              dir="ltr"
            >
              {holdCode ?? avExecutionState}
            </div>
          )}
          {holdGuidance && (
            <p
              data-testid="published-binary-release-hold-guidance"
              className="text-[11px] font-semibold leading-relaxed"
            >
              {holdGuidance}
            </p>
          )}
          {holdMessage && (
            <p className="text-[11px] leading-relaxed">{holdMessage}</p>
          )}
        </div>
      )}

      {uncertainState && (
        <div
          data-testid="published-binary-release-uncertain-banner"
          role="alert"
          className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border-2 border-amber-400 text-amber-950 dark:text-amber-100 space-y-2"
        >
          <div className="font-extrabold flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <span>
              {isAr
                ? 'نتيجة نشر الملف غير مؤكدة — تم إيقاف إعادة الإرسال التلقائي'
                : 'Binary Publish Commit Uncertain — Automatic Retry Stopped'}
            </span>
          </div>
          <p className="text-[11px]">{uncertainState.errorMessage}</p>
          <button
            type="button"
            data-testid="verify-published-binary-release-btn"
            disabled={loading || publishing}
            onClick={() => {
              void controller.verifyUncertainPublish();
            }}
            className="px-3.5 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-extrabold text-xs cursor-pointer inline-flex items-center gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>
              {isAr ? 'تحقق من حالة النشر' : 'Verify binary release status'}
            </span>
          </button>
        </div>
      )}

      {conflictState && (
        <div
          data-testid="published-binary-release-conflict-banner"
          role="alert"
          className="p-3.5 rounded-xl bg-orange-50 dark:bg-orange-950/40 border border-orange-300 dark:border-orange-800 text-orange-950 dark:text-orange-100 space-y-2"
        >
          <div className="font-extrabold">
            {isAr
              ? `تعارض في البيانات (${conflictState.errorCode})`
              : `Release Precondition Conflict (${conflictState.errorCode})`}
          </div>
          <p className="text-[11px]">{conflictState.errorMessage}</p>
          <button
            type="button"
            data-testid="reload-published-binary-release-conflict-btn"
            onClick={() => {
              void controller.reloadStatus();
            }}
            className="px-3 py-1.5 rounded-lg bg-orange-700 text-white font-bold text-xs cursor-pointer"
          >
            {isAr ? 'تحديث الحالة الحالية' : 'Refresh Current State'}
          </button>
        </div>
      )}

      {!loading &&
        !loadError &&
        readinessStatus &&
        isPublished &&
        readinessStatus.publicDocument &&
        readinessStatus.releaseRecord && (
          <div
            data-testid="published-binary-release-published-summary"
            className="p-3.5 rounded-xl bg-emerald-100/70 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800 space-y-2 text-emerald-950 dark:text-emerald-100"
          >
            <div className="font-extrabold flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
              <span>
                {lastOutcome === 'ALREADY_PUBLISHED'
                  ? isAr
                    ? 'الملف المرفوع منشور مسبقاً في المكتبة العامة'
                    : 'Uploaded File Already Published in Public Library'
                  : isAr
                    ? 'تم نشر الملف المرفوع للتحميل المباشر في المكتبة العامة'
                    : 'Uploaded File Published for Direct Public Download'}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="font-bold">
                  {isAr ? 'معرّف السجل العام: ' : 'Public Document ID: '}
                </span>
                <span
                  data-testid="published-binary-release-public-doc-id"
                  className="font-mono font-bold"
                  dir="ltr"
                >
                  {readinessStatus.publicDocument.id}
                </span>
              </div>
              <div>
                <span className="font-bold">
                  {isAr ? 'صيغة وحجم الملف: ' : 'Format & Size: '}
                </span>
                <span className="font-mono font-bold" dir="ltr">
                  {readinessStatus.releaseRecord.format} ·{' '}
                  {readinessStatus.releaseRecord.byteSize} bytes
                </span>
              </div>
              <div>
                <span className="font-bold">
                  {isAr ? 'مسودة الحجر الداخلية: ' : 'Quarantine Draft: '}
                </span>
                <span className="font-mono" dir="ltr">
                  {readinessStatus.quarantineCatalogDocumentId} (
                  {readinessStatus.quarantineDraftWorkflowState})
                </span>
              </div>
              <div>
                <span className="font-bold">
                  {isAr ? 'إخلاء السلامة الثنائية: ' : 'Assurance Flags: '}
                </span>
                <span className="font-mono" dir="ltr">
                  isSanitized=false, isVerifiedSafe=false
                </span>
              </div>
            </div>
            <div className="pt-1">
              <a
                href={readinessStatus.publicDocument.downloadGatewayUrl}
                download
                data-testid="published-binary-release-gateway-link"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-gray-900 border border-indigo-400 text-indigo-900 dark:text-indigo-200 font-bold hover:underline break-all"
                dir="ltr"
              >
                <Download className="h-3.5 w-3.5 shrink-0" />
                <span>{readinessStatus.releaseRecord.downloadFilename}</span>
              </a>
            </div>
          </div>
        )}

      {!loading && !loadError && readinessStatus && !isPublished && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 rounded-xl bg-white dark:bg-gray-900/70 border border-gray-200 dark:border-gray-800 text-[11px]">
            <div>
              <span className="font-bold">
                {isAr ? 'نوع الملف والحجم: ' : 'Uploaded Format & Size: '}
              </span>
              <span className="font-mono" dir="ltr">
                {readinessStatus.format} ({readinessStatus.byteSize} B)
              </span>
            </div>
            <div>
              <span className="font-bold">
                {isAr ? 'حالة الفحص الفعلي (ClamAV): ' : 'ClamAV Execution: '}
              </span>
              <span className="font-mono" dir="ltr">
                {readinessStatus.avExecutionState}
              </span>
            </div>
            <div>
              <span className="font-bold">
                {isAr ? 'مواءمة الفهرس والحالة: ' : 'Catalog Alignment: '}
              </span>
              <span className="font-mono" dir="ltr">
                {readinessStatus.catalogAligned ? 'ALIGNED' : 'NOT_ALIGNED'} (v
                {readinessStatus.effectiveAlignedCaseRevision})
              </span>
            </div>
            <div>
              <span className="font-bold">
                {isAr ? 'معرّف النشر المتوقع: ' : 'Target Public ID: '}
              </span>
              <span className="font-mono" dir="ltr">
                {readinessStatus.publicDocumentId}
              </span>
            </div>
          </div>

          {isEligible && !hasUnsavedCaseEdits ? (
            <div
              data-testid="published-binary-release-form"
              className="space-y-3"
            >
              {readinessStatus.requiresContradictionResolution && (
                <div
                  data-testid="binary-release-contradiction-box"
                  className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 space-y-2 text-amber-950 dark:text-amber-100"
                >
                  <div className="font-extrabold flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-amber-700 shrink-0" />
                    <span>
                      {isAr
                        ? `تنبيه حقوق مسبقة (${readinessStatus.currentPriorRightsDecision ?? 'RESTRICTED'})`
                        : `Prior Rights Decision Notice (${readinessStatus.currentPriorRightsDecision ?? 'RESTRICTED'})`}
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    {isAr
                      ? 'يوجد قرار حقوق سابق يخص مسودة الفهرسة ولن يتم المساس بسجله التاريخي. لإتاحة تحميل الملف نفسه للزوار، يجب تأكيد حل التعارض وتوثيق التفويض الصريح لتوزيع الملف.'
                      : 'A prior rights decision record exists and will remain preserved immutably. To authorize direct binary download, explicitly acknowledge and summarize why binary redistribution is authorized.'}
                  </p>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      data-testid="binary-release-ack-restricted-checkbox"
                      disabled={publishing}
                      checked={form.acknowledgePriorRestrictedDecision}
                      onChange={(e) =>
                        controller.updateFormField(
                          'acknowledgePriorRestrictedDecision',
                          e.target.checked
                        )
                      }
                      className="mt-0.5"
                    />
                    <span className="font-bold text-[11px]">
                      {isAr
                        ? 'أؤكد مراجعة قرار الحقوق السابق وأقرّ بأهلية نشر الملف المرفوع للتحميل المباشر'
                        : 'I acknowledge the prior rights decision and confirm explicit authorization to redistribute the binary file'}
                    </span>
                  </label>
                  <textarea
                    data-testid="binary-release-contradiction-summary-input"
                    rows={2}
                    disabled={publishing}
                    value={form.contradictionResolutionSummary}
                    onChange={(e) =>
                      controller.updateFormField(
                        'contradictionResolutionSummary',
                        e.target.value
                      )
                    }
                    placeholder={
                      isAr
                        ? 'اشرح سبب جواز توزيع الملف رغم القرار المسبق (مثلاً: أنا المالك وأصرّح بتحميل الوثيقة)...'
                        : 'Explain resolution for prior RESTRICTED record (e.g., Owner explicitly authorizes public PDF download)...'
                    }
                    className="w-full px-3 py-2 rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label
                    htmlFor="binary-release-public-rights-status"
                    className="block font-bold text-gray-700 dark:text-gray-300"
                  >
                    {isAr
                      ? 'تصنيف الحقوق للتحميل العام'
                      : 'Public Binary Download Rights Status'}
                  </label>
                  <select
                    id="binary-release-public-rights-status"
                    data-testid="binary-release-public-rights-status-select"
                    disabled={publishing}
                    value={form.publicRightsStatus}
                    onChange={(e) =>
                      controller.updateFormField(
                        'publicRightsStatus',
                        e.target.value as PublishedBinaryPublicLibraryRightsStatus
                      )
                    }
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-bold"
                  >
                    {PUBLISHED_BINARY_PUBLIC_RIGHTS_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="binary-release-rights-basis"
                    className="block font-bold text-gray-700 dark:text-gray-300"
                  >
                    {isAr
                      ? 'أساس التفويض لتوزيع الملف المرفوع'
                      : 'Binary Redistribution Authorization Basis'}
                  </label>
                  <select
                    id="binary-release-rights-basis"
                    data-testid="binary-release-rights-basis-select"
                    disabled={publishing}
                    value={form.binaryRightsBasis}
                    onChange={(e) =>
                      controller.updateFormField(
                        'binaryRightsBasis',
                        e.target.value as PublishedBinaryRightsBasis
                      )
                    }
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-bold"
                  >
                    {PUBLISHED_BINARY_RIGHTS_BASES.map((basis) => (
                      <option key={basis} value={basis}>
                        {getBinaryRightsBasisLabel(basis, isAr)} ({basis})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label
                    htmlFor="binary-release-evidence-reference"
                    className="block font-bold text-gray-700 dark:text-gray-300"
                  >
                    {isAr
                      ? 'مرجع سند توزيع الملف'
                      : 'Binary Rights Evidence Reference'}
                  </label>
                  <input
                    id="binary-release-evidence-reference"
                    data-testid="binary-release-evidence-reference-input"
                    type="text"
                    disabled={publishing}
                    value={form.rightsEvidenceReference}
                    onChange={(e) =>
                      controller.updateFormField(
                        'rightsEvidenceReference',
                        e.target.value
                      )
                    }
                    placeholder={
                      isAr
                        ? 'مثال: إقرار المالك / خطاب الموافقة...'
                        : 'e.g., Owner Authorization / Written Release...'
                    }
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="binary-release-filename"
                    className="block font-bold text-gray-700 dark:text-gray-300"
                  >
                    {isAr
                      ? `اسم ملف التحميل للزوار (.${readinessStatus.format.toLowerCase()})`
                      : `Visitor Download Filename (.${readinessStatus.format.toLowerCase()})`}
                  </label>
                  <input
                    id="binary-release-filename"
                    data-testid="binary-release-filename-input"
                    type="text"
                    dir="ltr"
                    disabled={publishing}
                    value={form.downloadFilename}
                    onChange={(e) =>
                      controller.updateFormField(
                        'downloadFilename',
                        e.target.value
                      )
                    }
                    placeholder={`document.${readinessStatus.format.toLowerCase()}`}
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label
                    htmlFor="binary-release-evidence-summary"
                    className="block font-bold text-gray-700 dark:text-gray-300"
                  >
                    {isAr
                      ? 'ملخص تفويض التحميل المباشر للملف'
                      : 'Human Binary Distribution Verification Summary'}
                  </label>
                  <textarea
                    id="binary-release-evidence-summary"
                    data-testid="binary-release-evidence-summary-input"
                    rows={2}
                    disabled={publishing}
                    value={form.rightsEvidenceSummary}
                    onChange={(e) =>
                      controller.updateFormField(
                        'rightsEvidenceSummary',
                        e.target.value
                      )
                    }
                    placeholder={
                      isAr
                        ? 'توثيق بشري صريح بأهلية إتاحة الملف الثنائي للتحميل...'
                        : 'Explicit human verification authorizing public binary download...'
                    }
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="binary-release-notes"
                    className="block font-bold text-gray-700 dark:text-gray-300"
                  >
                    {isAr
                      ? 'ملاحظات الاعتماد للنشر (اختياري)'
                      : 'Release Approval Notes (Optional)'}
                  </label>
                  <textarea
                    id="binary-release-notes"
                    data-testid="binary-release-notes-input"
                    rows={2}
                    disabled={publishing}
                    value={form.releaseNotes}
                    onChange={(e) =>
                      controller.updateFormField('releaseNotes', e.target.value)
                    }
                    placeholder={
                      isAr
                        ? 'ملاحظات تحريرية أو تدقيقية مرافقة...'
                        : 'Optional editorial/audit approval notes...'
                    }
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                </div>
              </div>

              {publishError && (
                <div
                  data-testid="published-binary-release-publish-error"
                  role="alert"
                  className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200 font-mono text-[11px]"
                >
                  {publishError}
                </div>
              )}

              <label className="flex items-start gap-2 p-2.5 rounded-xl bg-white dark:bg-gray-900/60 border border-indigo-200 dark:border-indigo-900 cursor-pointer">
                <input
                  type="checkbox"
                  data-testid="binary-release-confirmation-checkbox"
                  disabled={publishing}
                  checked={confirmed}
                  onChange={(e) => controller.setConfirmed(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-[11px] font-bold text-gray-800 dark:text-gray-200">
                  {isAr
                    ? `أؤكد نشر الملف المرفوع النظيف (${readinessStatus.format}) للتحميل المباشر في المكتبة العامة كمرفق آمن (${LIBRARY_PUBLISHED_BINARY_RELEASE_CONFIRMATION_LITERAL}).`
                    : `I confirm publishing this cleanly AV-scanned (${readinessStatus.format}) file to the public library for direct attachment download (${LIBRARY_PUBLISHED_BINARY_RELEASE_CONFIRMATION_LITERAL}).`}
                </span>
              </label>

              <button
                type="button"
                data-testid="publish-quarantined-binary-release-btn"
                disabled={publishing || !confirmed || uncertainState !== null}
                onClick={() => {
                  void controller.publish();
                }}
                className="px-4 py-2.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-extrabold text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2 shadow-xs"
              >
                {publishing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                <span>
                  {publishing
                    ? isAr
                      ? 'جاري نشر الملف للتحميل المباشر...'
                      : 'Publishing File for Direct Download...'
                    : isAr
                      ? 'نشر الملف المرفوع للتحميل'
                      : 'Publish Uploaded File for Download'}
                </span>
              </button>
            </div>
          ) : (
            <div className="pt-1">
              <button
                type="button"
                data-testid="publish-quarantined-binary-release-btn"
                disabled={true}
                aria-disabled="true"
                className="px-4 py-2.5 rounded-xl bg-gray-300 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-extrabold text-xs cursor-not-allowed inline-flex items-center gap-2"
              >
                <Lock className="h-3.5 w-3.5" />
                <span>
                  {waitingForScan
                    ? isAr
                      ? 'نشر الملف المرفوع للتحميل (بانتظار فحص ClamAV)'
                      : 'Publish Uploaded File (WAITING FOR ACTUAL SCAN)'
                    : isAr
                      ? 'نشر الملف المرفوع للتحميل (موقوف)'
                      : 'Publish Uploaded File for Download (Disabled)'}
                </span>
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
