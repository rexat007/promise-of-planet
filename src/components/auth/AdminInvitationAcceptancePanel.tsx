import React, { useState, useEffect, useRef } from 'react';
import {
  ShieldCheck,
  KeyRound,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  WifiOff,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Info,
  Lock,
} from 'lucide-react';
import {
  AccountService,
  type EmailVerificationStatusResult,
  type RefreshEmailVerificationResult,
} from '../../services/accountService';
import {
  AdminIdentityClientError,
  AdminInvitationStatus,
  acceptAdminInvitation,
  type AcceptAdminInvitationClientInput,
  type AcceptAdminInvitationClientResponse,
  type AdminIdentityClientDependencies,
} from '../../services/adminIdentityManagementClient';
import { AdminRole, isValidAdminRole } from '../../types/admin';
import { getRoleLabel } from '../users/userFormatters';

export const ACCEPT_ADMIN_INVITATION_HEADING_AR = 'قبول دعوة إدارية';
export const ACCEPT_ADMIN_INVITATION_HEADING_EN =
  'Accept Administrative Invitation';

export const SERVER_ROLE_ACTIVATED_NOTICE_AR =
  'تم تفعيل الدور الإداري من الخادم بنجاح بعد التحقق الذري من الهوية والبريد الإلكتروني المؤكد.';

export const SERVER_ROLE_ACTIVATED_NOTICE_EN =
  'The administrative role has been activated by the server following atomic identity and verified-email validation.';

export type AdminInvitationAcceptanceErrorCategory =
  | 'unauthenticated'
  | 'unverified-email'
  | 'identity-mismatch'
  | 'expired-invitation'
  | 'revoked-invitation'
  | 'already-accepted'
  | 'existing-admin-conflict'
  | 'invalid-invitation-id'
  | 'unavailable'
  | 'transaction-failure';

export type AdminInvitationAcceptanceStatus =
  | 'idle'
  | 'submitting'
  | 'succeeded'
  | 'error';

export interface AdminInvitationAcceptanceError {
  readonly category: AdminInvitationAcceptanceErrorCategory;
  readonly messageAr: string;
  readonly messageEn: string;
}

export interface AdminInvitationAcceptanceSnapshot {
  readonly status: AdminInvitationAcceptanceStatus;
  readonly result: AcceptAdminInvitationClientResponse | null;
  readonly error: AdminInvitationAcceptanceError | null;
  readonly submissionCount: number;
}

const INVITATION_LOCATOR_ID_REGEX = /^[A-Za-z0-9_-]{8,128}$/;

export function validateClientInvitationLocatorId(rawId: unknown): string | null {
  if (typeof rawId !== 'string') {
    return null;
  }
  const trimmed = rawId.trim();
  if (!trimmed || !INVITATION_LOCATOR_ID_REGEX.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function buildBilingualAcceptanceError(
  category: AdminInvitationAcceptanceErrorCategory
): AdminInvitationAcceptanceError {
  switch (category) {
    case 'unauthenticated':
      return Object.freeze({
        category,
        messageAr:
          'يرجى تسجيل الدخول إلى حساب العضو الخاص بك أولاً قبل تقديم معرّف الدعوة الإدارية.',
        messageEn:
          'Please sign in to your member account before submitting an administrative invitation ID.',
      });
    case 'unverified-email':
      return Object.freeze({
        category,
        messageAr:
          'يتطلب قبول الدعوة الإدارية تأكيد البريد الإلكتروني لحسابك أولاً. يرجى تأكيد بريدك ثم تحديث حالة التحقق.',
        messageEn:
          'Accepting an administrative invitation requires a verified email address. Please verify your email and refresh your verification status.',
      });
    case 'identity-mismatch':
      return Object.freeze({
        category,
        messageAr:
          'رفض الخادم قبول الدعوة: الحساب المسجل حالياً أو البريد الإلكتروني لا يطابق الهوية المستهدفة في هذه الدعوة.',
        messageEn:
          'Invitation acceptance denied: The currently signed-in UID or email does not match the target identity of this invitation.',
      });
    case 'expired-invitation':
      return Object.freeze({
        category,
        messageAr:
          'انتهت صلاحية هذه الدعوة الإدارية ولم يعد بالإمكان قبولها. يرجى التواصل مع مالك المنصة لإصدار دعوة جديدة.',
        messageEn:
          'This administrative invitation has expired and can no longer be accepted. Please request a new invitation from the platform Owner.',
      });
    case 'revoked-invitation':
      return Object.freeze({
        category,
        messageAr:
          'تم إلغاء هذه الدعوة الإدارية من قِبل المالك ولم تعد صالحة للقبول.',
        messageEn:
          'This administrative invitation was revoked by the Owner and is no longer valid.',
      });
    case 'already-accepted':
      return Object.freeze({
        category,
        messageAr:
          'تم قبول هذه الدعوة الإدارية مسبقاً ولا يمكن إعادة استخدامها.',
        messageEn:
          'This administrative invitation has already been accepted and cannot be reused.',
      });
    case 'existing-admin-conflict':
      return Object.freeze({
        category,
        messageAr:
          'تعذر قبول الدعوة: توجد هوية إدارية مرتبطة بهذا الحساب بالفعل أو لم تتحقق شروط الدعوة في الخادم.',
        messageEn:
          'Cannot accept invitation: An administrative identity already exists for this account or server preconditions were not met.',
      });
    case 'invalid-invitation-id':
      return Object.freeze({
        category,
        messageAr:
          'معرّف الدعوة الإدارية غير صالح. يجب أن يتكون من 8 إلى 128 محرفاً (أحرف إنجليزية أو أرقام أو - أو _).',
        messageEn:
          'Invalid invitation ID. Must be 8–128 characters containing letters, digits, hyphens, or underscores.',
      });
    case 'unavailable':
      return Object.freeze({
        category,
        messageAr:
          'خدمة قبول الدعوات الإدارية غير متاحة حالياً. لم يتم تفعيل أي دور إداري.',
        messageEn:
          'The administrative invitation service is currently unavailable. No administrative role was activated.',
      });
    case 'transaction-failure':
    default:
      return Object.freeze({
        category: 'transaction-failure',
        messageAr:
          'تعذر إتمام عملية قبول الدعوة في الخادم. لم يتم منح أي صلاحيات إدارية.',
        messageEn:
          'The server transaction to accept the invitation did not complete. No administrative privileges were granted.',
      });
  }
}

export function classifyInvitationAcceptanceFailure(
  error: unknown
): AdminInvitationAcceptanceError {
  if (error && typeof error === 'object') {
    const rawRecord = error as Record<string, unknown>;
    const rawCode = String(rawRecord.code ?? '')
      .trim()
      .replace(/^functions\//i, '');
    const upperCode = rawCode.toUpperCase();
    const lowerCode = rawCode.toLowerCase();
    const rawReason = String(rawRecord.reason ?? '').trim().toUpperCase();
    const rawMsg = String(rawRecord.message ?? '').toUpperCase();

    if (
      upperCode === 'UNVERIFIED_TARGET_EMAIL' ||
      rawReason === 'UNVERIFIED_TARGET_EMAIL' ||
      rawMsg.includes('UNVERIFIED_TARGET_EMAIL')
    ) {
      return buildBilingualAcceptanceError('unverified-email');
    }

    if (
      upperCode === 'INVITATION_EXPIRED' ||
      rawReason === 'INVITATION_EXPIRED' ||
      rawMsg.includes('INVITATION_EXPIRED') ||
      rawMsg.includes('EXPIRED')
    ) {
      return buildBilingualAcceptanceError('expired-invitation');
    }

    if (
      upperCode === 'INVITATION_REVOKED' ||
      rawReason === 'INVITATION_REVOKED' ||
      rawMsg.includes('INVITATION_REVOKED') ||
      rawMsg.includes('REVOKED')
    ) {
      return buildBilingualAcceptanceError('revoked-invitation');
    }

    if (
      upperCode === 'INVITATION_ALREADY_ACCEPTED' ||
      rawReason === 'INVITATION_ALREADY_ACCEPTED' ||
      rawMsg.includes('INVITATION_ALREADY_ACCEPTED') ||
      rawMsg.includes('ALREADY_ACCEPTED')
    ) {
      return buildBilingualAcceptanceError('already-accepted');
    }

    if (
      upperCode === 'EXISTING_ADMIN_CONFLICT' ||
      rawReason === 'EXISTING_ADMIN_CONFLICT' ||
      rawMsg.includes('EXISTING_ADMIN_CONFLICT')
    ) {
      return buildBilingualAcceptanceError('existing-admin-conflict');
    }

    if (
      upperCode === 'IDENTITY_MISMATCH' ||
      upperCode === 'EMAIL_MISMATCH' ||
      rawReason === 'IDENTITY_MISMATCH' ||
      rawReason === 'EMAIL_MISMATCH' ||
      rawReason === 'SPOOFED_AUTHORITY_REJECTED' ||
      rawReason === 'OWNER_ACTIVATION_FORBIDDEN'
    ) {
      return buildBilingualAcceptanceError('identity-mismatch');
    }

    if (
      upperCode === 'CONCURRENT_MODIFICATION_CONFLICT' ||
      upperCode === 'TRANSACTION_ABORTED'
    ) {
      return buildBilingualAcceptanceError('transaction-failure');
    }

    if (error instanceof AdminIdentityClientError) {
      if (error.code === 'unauthenticated') {
        return buildBilingualAcceptanceError('unauthenticated');
      }
      if (error.code === 'permission-denied') {
        return buildBilingualAcceptanceError('identity-mismatch');
      }
      if (error.code === 'invalid-argument') {
        return buildBilingualAcceptanceError('invalid-invitation-id');
      }
      if (error.code === 'failed-precondition') {
        return buildBilingualAcceptanceError('existing-admin-conflict');
      }
      if (error.code === 'unavailable') {
        return buildBilingualAcceptanceError('unavailable');
      }
      return buildBilingualAcceptanceError('transaction-failure');
    }

    if (lowerCode === 'unauthenticated') {
      return buildBilingualAcceptanceError('unauthenticated');
    }
    if (lowerCode === 'permission-denied') {
      return buildBilingualAcceptanceError('identity-mismatch');
    }
    if (lowerCode === 'invalid-argument') {
      return buildBilingualAcceptanceError('invalid-invitation-id');
    }
    if (lowerCode === 'failed-precondition') {
      return buildBilingualAcceptanceError('existing-admin-conflict');
    }
    if (lowerCode === 'unavailable' || lowerCode === 'deadline-exceeded') {
      return buildBilingualAcceptanceError('unavailable');
    }
  }

  return buildBilingualAcceptanceError('transaction-failure');
}

export interface SubmitAdminInvitationAcceptanceOptions {
  readonly authStatus: EmailVerificationStatusResult;
  readonly invitationId: unknown;
  readonly expectedRevision?: number;
  readonly invokeAcceptInvitation?: (
    input: AcceptAdminInvitationClientInput
  ) => Promise<AcceptAdminInvitationClientResponse>;
  readonly clientDeps?: AdminIdentityClientDependencies;
}

export class AdminInvitationAcceptanceController {
  private snapshot: AdminInvitationAcceptanceSnapshot;
  private isMounted = true;
  private readonly listeners = new Set<
    (snapshot: AdminInvitationAcceptanceSnapshot) => void
  >();

  constructor(initial?: Partial<AdminInvitationAcceptanceSnapshot>) {
    this.snapshot = Object.freeze({
      status: initial?.status ?? 'idle',
      result: initial?.result ?? null,
      error: initial?.error ?? null,
      submissionCount: initial?.submissionCount ?? 0,
    });
  }

  public mount(): void {
    this.isMounted = true;
  }

  public unmount(): void {
    this.isMounted = false;
  }

  public getSnapshot(): AdminInvitationAcceptanceSnapshot {
    return this.snapshot;
  }

  public subscribe(
    listener: (snapshot: AdminInvitationAcceptanceSnapshot) => void
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(next: AdminInvitationAcceptanceSnapshot): void {
    this.snapshot = Object.freeze(next);
    if (!this.isMounted) {
      return;
    }
    this.listeners.forEach((listener) => listener(this.snapshot));
  }

  public reset(): void {
    if (this.snapshot.status === 'submitting') {
      return;
    }
    this.emit({
      status: 'idle',
      result: null,
      error: null,
      submissionCount: this.snapshot.submissionCount,
    });
  }

  public async submit(
    options: SubmitAdminInvitationAcceptanceOptions
  ): Promise<AdminInvitationAcceptanceSnapshot> {
    // Reject repeated submissions while a request is already pending
    if (this.snapshot.status === 'submitting') {
      return this.snapshot;
    }

    const { authStatus } = options;

    // 1. Require a signed-in Firebase Auth user
    if (
      !authStatus ||
      authStatus.authenticated !== true ||
      typeof authStatus.uid !== 'string' ||
      !authStatus.uid.trim()
    ) {
      this.emit({
        status: 'error',
        result: null,
        error: buildBilingualAcceptanceError('unauthenticated'),
        submissionCount: this.snapshot.submissionCount,
      });
      return this.snapshot;
    }

    // 2. Check local email verification status for immediate guidance
    if (authStatus.emailVerified !== true) {
      this.emit({
        status: 'error',
        result: null,
        error: buildBilingualAcceptanceError('unverified-email'),
        submissionCount: this.snapshot.submissionCount,
      });
      return this.snapshot;
    }

    // 3. Validate invitationId locator format
    const validatedInvitationId = validateClientInvitationLocatorId(
      options.invitationId
    );
    if (!validatedInvitationId) {
      this.emit({
        status: 'error',
        result: null,
        error: buildBilingualAcceptanceError('invalid-invitation-id'),
        submissionCount: this.snapshot.submissionCount,
      });
      return this.snapshot;
    }

    // 4. Validate optional expectedRevision if supplied
    let validatedExpectedRevision: number | undefined;
    if (options.expectedRevision !== undefined) {
      if (
        typeof options.expectedRevision !== 'number' ||
        !Number.isInteger(options.expectedRevision) ||
        options.expectedRevision < 1
      ) {
        this.emit({
          status: 'error',
          result: null,
          error: buildBilingualAcceptanceError('invalid-invitation-id'),
          submissionCount: this.snapshot.submissionCount,
        });
        return this.snapshot;
      }
      validatedExpectedRevision = options.expectedRevision;
    }

    const nextSubmissionCount = this.snapshot.submissionCount + 1;
    this.emit({
      status: 'submitting',
      result: null,
      error: null,
      submissionCount: nextSubmissionCount,
    });

    // Strict request payload: ONLY invitationId (and optional expectedRevision if provided)
    const requestInput: AcceptAdminInvitationClientInput = Object.freeze({
      invitationId: validatedInvitationId,
      ...(validatedExpectedRevision !== undefined
        ? { expectedRevision: validatedExpectedRevision }
        : {}),
    });

    try {
      const invoker =
        options.invokeAcceptInvitation ??
        ((input: AcceptAdminInvitationClientInput) =>
          acceptAdminInvitation(input, options.clientDeps));

      const response = await invoker(requestInput);

      // Fail-closed validation of server acceptance response
      if (
        !response ||
        typeof response !== 'object' ||
        !response.invitation ||
        !response.admin ||
        response.invitation.invitationId !== validatedInvitationId ||
        response.invitation.status !== AdminInvitationStatus.Accepted ||
        !isValidAdminRole(response.invitation.intendedRole) ||
        response.invitation.intendedRole === AdminRole.Owner ||
        !isValidAdminRole(response.admin.role) ||
        response.admin.role === AdminRole.Owner ||
        response.admin.role !== response.invitation.intendedRole ||
        response.admin.isActive !== true ||
        response.admin.id !== authStatus.uid.trim() ||
        response.invitation.acceptedByUid !== authStatus.uid.trim() ||
        typeof response.invitation.acceptedAtIso !== 'string' ||
        !response.invitation.acceptedAtIso.trim() ||
        typeof response.auditEventId !== 'string' ||
        !response.auditEventId.trim()
      ) {
        this.emit({
          status: 'error',
          result: null,
          error: buildBilingualAcceptanceError('transaction-failure'),
          submissionCount: nextSubmissionCount,
        });
        return this.snapshot;
      }

      this.emit({
        status: 'succeeded',
        result: response,
        error: null,
        submissionCount: nextSubmissionCount,
      });
      return this.snapshot;
    } catch (error: unknown) {
      const classified = classifyInvitationAcceptanceFailure(error);
      this.emit({
        status: 'error',
        result: null,
        error: classified,
        submissionCount: nextSubmissionCount,
      });
      return this.snapshot;
    }
  }
}

export const OPEN_ADMIN_PORTAL_ACTION_AR = 'الانتقال إلى بوابة الإدارة';
export const OPEN_ADMIN_PORTAL_ACTION_EN = 'Open Admin Portal';

export const OPEN_ADMIN_PORTAL_FALLBACK_INSTRUCTION_AR =
  'يمكنك الآن إغلاق هذه النافذة والدخول إلى بوابة الإدارة من شريط التنقل العلوي.';
export const OPEN_ADMIN_PORTAL_FALLBACK_INSTRUCTION_EN =
  'You may now close this dialog and open the Admin Portal from the top navigation header.';

export function invokePostAcceptanceAdminNavigation(
  snapshot: AdminInvitationAcceptanceSnapshot,
  onEnterAdmin?: () => void
): boolean {
  if (
    !snapshot ||
    snapshot.status !== 'succeeded' ||
    !snapshot.result ||
    snapshot.result.invitation.status !== AdminInvitationStatus.Accepted ||
    snapshot.result.admin.isActive !== true ||
    snapshot.result.admin.role === AdminRole.Owner ||
    typeof onEnterAdmin !== 'function'
  ) {
    return false;
  }

  onEnterAdmin();
  return true;
}

export interface AdminInvitationAcceptancePanelProps {
  readonly isAr?: boolean;
  readonly onEnterAdmin?: () => void;
  readonly clientDeps?: AdminIdentityClientDependencies;
  readonly invokeAcceptInvitation?: (
    input: AcceptAdminInvitationClientInput
  ) => Promise<AcceptAdminInvitationClientResponse>;
  readonly getAuthVerificationStatus?: () => EmailVerificationStatusResult;
  readonly refreshEmailVerificationStatus?: () => Promise<RefreshEmailVerificationResult>;
  readonly initialAuthStatus?: EmailVerificationStatusResult;
  readonly initialAcceptanceState?: Partial<AdminInvitationAcceptanceSnapshot>;
}

export const AdminInvitationAcceptancePanel: React.FC<
  AdminInvitationAcceptancePanelProps
> = ({
  isAr = false,
  onEnterAdmin,
  clientDeps,
  invokeAcceptInvitation,
  getAuthVerificationStatus,
  refreshEmailVerificationStatus,
  initialAuthStatus,
  initialAcceptanceState,
}) => {
  const resolveCurrentAuthStatus = (): EmailVerificationStatusResult => {
    if (getAuthVerificationStatus) {
      return getAuthVerificationStatus();
    }
    if (initialAuthStatus) {
      return initialAuthStatus;
    }
    return AccountService.getEmailVerificationStatus();
  };

  const [authStatus, setAuthStatus] = useState<EmailVerificationStatusResult>(
    () => resolveCurrentAuthStatus()
  );
  const [invitationIdInput, setInvitationIdInput] = useState<string>('');
  const [refreshingVerification, setRefreshingVerification] =
    useState<boolean>(false);
  const [verificationFeedback, setVerificationFeedback] = useState<
    string | null
  >(null);

  const controllerRef = useRef<AdminInvitationAcceptanceController | null>(
    null
  );
  if (!controllerRef.current) {
    controllerRef.current = new AdminInvitationAcceptanceController(
      initialAcceptanceState
    );
  }

  const [acceptanceSnapshot, setAcceptanceSnapshot] =
    useState<AdminInvitationAcceptanceSnapshot>(() =>
      controllerRef.current!.getSnapshot()
    );

  useEffect(() => {
    const controller = controllerRef.current!;
    controller.mount();
    const unsubscribeController = controller.subscribe((next) => {
      setAcceptanceSnapshot(next);
    });

    let unsubscribeAuth = () => {};
    if (!getAuthVerificationStatus && !initialAuthStatus) {
      unsubscribeAuth = AccountService.observeAuthState((user) => {
        const nextStatus = AccountService.getEmailVerificationStatus();
        setAuthStatus(nextStatus);
        if (!user) {
          controller.reset();
        }
      });
    }

    return () => {
      unsubscribeController();
      unsubscribeAuth();
      controller.unmount();
    };
  }, [getAuthVerificationStatus, initialAuthStatus]);

  const isSubmitting = acceptanceSnapshot.status === 'submitting';
  const acceptedResult = acceptanceSnapshot.result;
  const acceptanceError = acceptanceSnapshot.error;

  const handleRefreshVerification = async () => {
    if (refreshingVerification || isSubmitting) return;
    setRefreshingVerification(true);
    setVerificationFeedback(null);
    try {
      const refresher =
        refreshEmailVerificationStatus ??
        (() => AccountService.refreshEmailVerificationStatus());
      const res = await refresher();
      setAuthStatus({
        authenticated: true,
        uid: res.uid,
        email: res.email,
        emailVerified: res.emailVerified,
      });
      setVerificationFeedback(isAr ? res.messageAr : res.messageEn);
      if (
        res.emailVerified &&
        acceptanceSnapshot.error?.category === 'unverified-email'
      ) {
        controllerRef.current?.reset();
      }
    } catch {
      setVerificationFeedback(
        isAr
          ? 'تعذر تحديث حالة التحقق من البريد الإلكتروني حالياً. يرجى المحاولة مرة أخرى.'
          : 'Unable to refresh email verification status right now. Please try again.'
      );
    } finally {
      setRefreshingVerification(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    const latestAuth = getAuthVerificationStatus
      ? getAuthVerificationStatus()
      : initialAuthStatus ?? AccountService.getEmailVerificationStatus();
    setAuthStatus(latestAuth);

    await controllerRef.current!.submit({
      authStatus: latestAuth,
      invitationId: invitationIdInput,
      invokeAcceptInvitation,
      clientDeps,
    });
  };

  const handleOpenAdminPortalClick = () => {
    invokePostAcceptanceAdminNavigation(acceptanceSnapshot, onEnterAdmin);
  };

  return (
    <section
      className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-800 space-y-3 min-w-0"
      dir={isAr ? 'rtl' : 'ltr'}
      data-testid="admin-invitation-acceptance-panel"
      aria-labelledby="admin-invitation-acceptance-heading"
    >
      {/* Section Header */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200/70 dark:border-emerald-900/60 shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3
              id="admin-invitation-acceptance-heading"
              className="text-xs sm:text-sm font-extrabold text-gray-900 dark:text-gray-100 truncate"
            >
              {isAr
                ? ACCEPT_ADMIN_INVITATION_HEADING_AR
                : ACCEPT_ADMIN_INVITATION_HEADING_EN}
            </h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {isAr
                ? 'تفعيل دور إداري معياري عبر معرّف الدعوة الخادمي لحسابك المؤكد'
                : 'Activate a server-assigned administrative role using an invitation ID'}
            </p>
          </div>
        </div>
      </div>

      {/* 1. Signed-Out Guard */}
      {!authStatus.authenticated && (
        <div
          className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/70 border border-gray-200 dark:border-gray-700 flex items-start gap-2.5 text-xs text-gray-600 dark:text-gray-300"
          data-testid="invitation-acceptance-signed-out-state"
        >
          <Lock className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            {isAr
              ? 'يرجى تسجيل الدخول إلى حساب العضو أعلاه أولاً لتتمكن من تقديم معرّف الدعوة الإدارية.'
              : 'Please sign in to your member account above before submitting an administrative invitation ID.'}
          </p>
        </div>
      )}

      {/* 2. Signed-In But Unverified Email Guidance */}
      {authStatus.authenticated && !authStatus.emailVerified && (
        <div
          className="p-3.5 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 space-y-2.5 text-xs text-amber-900 dark:text-amber-200"
          data-testid="invitation-acceptance-unverified-guidance"
        >
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1 min-w-0">
              <p className="font-bold">
                {isAr
                  ? 'يتطلب قبول الدعوة الإدارية تأكيد البريد الإلكتروني لحسابك أولاً.'
                  : 'Accepting an administrative invitation requires a verified email address first.'}
              </p>
              <p className="text-[11px] text-amber-800 dark:text-amber-300/90 leading-relaxed">
                {isAr
                  ? 'يرجى تأكيد بريدك الإلكتروني عبر رابط التحقق المرسل إليك، ثم تحديث حالة التحقق للمتابعة.'
                  : 'Please verify your email address using the verification link sent to your inbox, then refresh your verification status to continue.'}
              </p>
            </div>
          </div>

          {verificationFeedback && (
            <p
              className="text-[11px] font-semibold text-amber-900 dark:text-amber-200"
              data-testid="invitation-acceptance-verification-feedback"
            >
              {verificationFeedback}
            </p>
          )}

          <button
            type="button"
            disabled={refreshingVerification || isSubmitting}
            onClick={() => void handleRefreshVerification()}
            className="w-full sm:w-auto px-3 py-1.5 bg-white dark:bg-gray-800 hover:bg-amber-100/60 dark:hover:bg-gray-700 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700 rounded-xl text-[11px] font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
            data-testid="invitation-acceptance-refresh-verification-btn"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 shrink-0 ${
                refreshingVerification ? 'animate-spin' : ''
              }`}
            />
            <span>
              {refreshingVerification
                ? isAr
                  ? 'جاري تحديث حالة التحقق...'
                  : 'Refreshing verification status...'
                : isAr
                  ? 'تحديث حالة التحقق من البريد الإلكتروني'
                  : 'Refresh Email Verification Status'}
            </span>
          </button>
        </div>
      )}

      {/* 3. Error Feedback Banner */}
      {acceptanceError && (
        <div
          className="p-3.5 rounded-xl bg-rose-50/80 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 flex items-start gap-2.5 text-xs text-rose-900 dark:text-rose-200"
          role="alert"
          data-testid="invitation-acceptance-error-banner"
          data-error-category={acceptanceError.category}
        >
          {acceptanceError.category === 'unavailable' ? (
            <WifiOff className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          ) : acceptanceError.category === 'identity-mismatch' ||
            acceptanceError.category === 'unauthenticated' ? (
            <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          )}
          <div className="space-y-1 min-w-0 flex-1">
            <p className="font-bold leading-relaxed">
              {isAr ? acceptanceError.messageAr : acceptanceError.messageEn}
            </p>
          </div>
        </div>
      )}

      {/* 4. Confirmed Server Acceptance Success Receipt */}
      {acceptanceSnapshot.status === 'succeeded' && acceptedResult && (
        <div
          className="p-4 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 space-y-3.5 text-xs min-w-0"
          data-testid="invitation-acceptance-success-state"
        >
          <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-emerald-200/60 dark:border-emerald-800/60">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <h4 className="font-extrabold text-emerald-950 dark:text-emerald-100">
                {isAr
                  ? 'تم قبول الدعوة الإدارية وتفعيل الدور من الخادم'
                  : 'Invitation Accepted & Role Activated by Server'}
              </h4>
            </div>
            <span
              className="text-[11px] font-extrabold text-emerald-700 dark:text-emerald-300 shrink-0"
              data-testid="accepted-invitation-status"
            >
              {isAr
                ? `الحالة: مقبولة (${acceptedResult.invitation.status})`
                : `Status: ${acceptedResult.invitation.status}`}
            </span>
          </div>

          <p
            className="text-[11px] font-semibold text-emerald-900 dark:text-emerald-200 leading-relaxed"
            data-testid="server-role-activated-notice"
          >
            {isAr
              ? SERVER_ROLE_ACTIVATED_NOTICE_AR
              : SERVER_ROLE_ACTIVATED_NOTICE_EN}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 tabular-nums min-w-0">
            <div className="bg-white/90 dark:bg-gray-900/80 p-2.5 rounded-xl border border-emerald-200/50 dark:border-emerald-900/50 min-w-0">
              <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400">
                {isAr ? 'الدور الإداري المفعّل' : 'Assigned Administrative Role'}
              </p>
              <p
                className="font-bold text-gray-900 dark:text-gray-100 mt-0.5"
                data-testid="accepted-assigned-role"
              >
                {getRoleLabel(acceptedResult.admin.role, isAr)} (
                {acceptedResult.admin.role})
              </p>
            </div>

            <div className="bg-white/90 dark:bg-gray-900/80 p-2.5 rounded-xl border border-emerald-200/50 dark:border-emerald-900/50 min-w-0">
              <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400">
                {isAr ? 'معرّف الدعوة المقبولة' : 'Accepted Invitation ID'}
              </p>
              <p
                className="font-mono font-bold text-gray-900 dark:text-gray-100 mt-0.5 break-all"
                data-testid="accepted-invitation-id"
              >
                {acceptedResult.invitation.invitationId}
              </p>
            </div>

            <div className="bg-white/90 dark:bg-gray-900/80 p-2.5 rounded-xl border border-emerald-200/50 dark:border-emerald-900/50 min-w-0">
              <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400">
                {isAr ? 'البريد الإلكتروني المصادق' : 'Verified Admin Email'}
              </p>
              <p
                className="font-mono text-[11px] text-gray-800 dark:text-gray-200 mt-0.5 break-all"
                data-testid="accepted-admin-email"
              >
                {acceptedResult.admin.email}
              </p>
            </div>

            <div className="bg-white/90 dark:bg-gray-900/80 p-2.5 rounded-xl border border-emerald-200/50 dark:border-emerald-900/50 min-w-0">
              <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400">
                {isAr ? 'توقيت القبول وسجل التدقيق' : 'Accepted At & Audit ID'}
              </p>
              <p
                className="font-mono text-[10px] text-gray-700 dark:text-gray-300 mt-0.5 break-all"
                data-testid="accepted-audit-meta"
              >
                {acceptedResult.invitation.acceptedAtIso} ·{' '}
                {acceptedResult.auditEventId}
              </p>
            </div>
          </div>

          <div className="pt-1 flex items-center justify-end">
            {typeof onEnterAdmin === 'function' ? (
              <button
                type="button"
                onClick={handleOpenAdminPortalClick}
                className="w-full sm:w-auto px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
                data-testid="open-admin-portal-after-acceptance-btn"
              >
                <span>
                  {isAr ? OPEN_ADMIN_PORTAL_ACTION_AR : OPEN_ADMIN_PORTAL_ACTION_EN}
                </span>
                {isAr ? (
                  <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                )}
              </button>
            ) : (
              <p
                className="w-full text-[11px] font-medium text-emerald-900 dark:text-emerald-200 leading-relaxed"
                data-testid="open-admin-portal-fallback-instruction"
              >
                {isAr
                  ? OPEN_ADMIN_PORTAL_FALLBACK_INSTRUCTION_AR
                  : OPEN_ADMIN_PORTAL_FALLBACK_INSTRUCTION_EN}
              </p>
            )}
          </div>
        </div>
      )}

      {/* 5. Invitation ID Submission Form (Shown for Signed-In Verified Member Before Acceptance) */}
      {authStatus.authenticated &&
        authStatus.emailVerified &&
        acceptanceSnapshot.status !== 'succeeded' && (
          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="space-y-3 min-w-0"
            data-testid="admin-invitation-acceptance-form"
            noValidate
          >
            <div className="space-y-1.5 min-w-0">
              <label
                htmlFor="invitation-acceptance-id-input"
                className="block text-xs font-bold text-gray-800 dark:text-gray-200"
              >
                {isAr
                  ? 'معرّف الدعوة الإدارية (Invitation ID)'
                  : 'Administrative Invitation ID'}
              </label>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 min-w-0">
                <div className="relative flex-1 min-w-0">
                  <div className="absolute inset-y-0 start-0 flex items-center ps-3 pointer-events-none text-gray-400">
                    <KeyRound className="w-3.5 h-3.5" />
                  </div>
                  <input
                    id="invitation-acceptance-id-input"
                    type="text"
                    required
                    disabled={isSubmitting}
                    value={invitationIdInput}
                    onChange={(e) => setInvitationIdInput(e.target.value)}
                    placeholder="inv_..."
                    autoComplete="off"
                    className="w-full min-w-0 ps-9 pe-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-mono text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-hidden focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-60"
                    data-testid="invitation-acceptance-id-input"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full sm:w-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50 shrink-0 whitespace-nowrap"
                  data-testid="submit-accept-invitation-btn"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                      <span>
                        {isAr ? 'جاري التحقق والقبول...' : 'Verifying & Accepting...'}
                      </span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {isAr
                          ? ACCEPT_ADMIN_INVITATION_HEADING_AR
                          : ACCEPT_ADMIN_INVITATION_HEADING_EN}
                      </span>
                    </>
                  )}
                </button>
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                {isAr
                  ? 'يتحقق الخادم ذرياً من هوية حسابك الحالي وبريدك المؤكد قبل تفعيل الدور الإداري.'
                  : 'The server atomically verifies your signed-in UID and verified email before activating the administrative role.'}
              </p>
            </div>
          </form>
        )}
    </section>
  );
};
