import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MailPlus,
  Shield,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  X,
  Lock,
  WifiOff,
  ShieldAlert,
  Ban,
  Copy,
} from 'lucide-react';
import {
  AdminRole,
  AdminPermission,
  AdminDomain,
  isTabAuthorized,
  isValidAdminRole,
  type AdminUser,
} from '../../types/admin';
import { AdminAccessService } from '../../services/adminAccess';
import {
  AdminIdentityClientError,
  AdminInvitationStatus,
  DEFAULT_ADMIN_INVITATION_TTL_MS,
  MIN_ADMIN_INVITATION_TTL_MS,
  MAX_ADMIN_INVITATION_TTL_MS,
  createAdminInvitation,
  revokeAdminInvitation,
  type AdminIdentityClientDependencies,
  type CreateAdminInvitationClientInput,
  type CreateAdminInvitationClientResponse,
  type RevokeAdminInvitationClientInput,
  type RevokeAdminInvitationClientResponse,
} from '../../services/adminIdentityManagementClient';
import { getRoleLabel, getRoleDescription, getPermissionLabel } from './userFormatters';

export type InvitableAdminRole = Exclude<AdminRole, typeof AdminRole.Owner>;

export const INVITABLE_ADMIN_ROLES: ReadonlyArray<InvitableAdminRole> = Object.freeze([
  AdminRole.ContentEditor,
  AdminRole.LibraryCurator,
  AdminRole.RightsReviewer,
  AdminRole.TrainingManager,
  AdminRole.Trainer,
  AdminRole.CitizenModerator,
  AdminRole.AIAssistant,
  AdminRole.Viewer,
]);

export const INVITATION_TTL_PRESETS_MS: ReadonlyArray<{
  readonly ttlMs: number;
  readonly labelAr: string;
  readonly labelEn: string;
}> = Object.freeze([
  {
    ttlMs: 24 * 60 * 60 * 1000,
    labelAr: '24 ساعة (يوم واحد)',
    labelEn: '24 Hours (1 Day)',
  },
  {
    ttlMs: 3 * 24 * 60 * 60 * 1000,
    labelAr: '3 أيام',
    labelEn: '3 Days',
  },
  {
    ttlMs: DEFAULT_ADMIN_INVITATION_TTL_MS,
    labelAr: '7 أيام (الافتراضي)',
    labelEn: '7 Days (Default)',
  },
  {
    ttlMs: MAX_ADMIN_INVITATION_TTL_MS,
    labelAr: '14 يوماً (الحد الأقصى)',
    labelEn: '14 Days (Maximum)',
  },
]);

export const INVITATION_NO_EMAIL_SENT_NOTICE_AR =
  'تنبيه شفافية: إنشاء هذه الدعوة لم يُرسل أي بريد إلكتروني تلقائياً، ولم يُفعّل الدور الإداري أو يُنشئ حساب مشرف نشط بعد.';

export const INVITATION_NO_EMAIL_SENT_NOTICE_EN =
  'Transparency Notice: Creating this invitation has NOT sent an email, has NOT activated the administrative role, and has NOT added an active administrator.';

export const INVITATION_LOCATOR_NOTICE_AR =
  'معرّف الدعوة (invitationId) هو معرّف مرجعي للسجل الخادمي فقط وليس رمزاً سرياً للمصادقة ولا رابط تفعيل تلقائي.';

export const INVITATION_LOCATOR_NOTICE_EN =
  'The invitationId is a server record locator only, not an authentication secret or automatic activation URL.';

export const REVOKE_INVITATION_ACTION_AR = 'إلغاء الدعوة';
export const REVOKE_INVITATION_ACTION_EN = 'Revoke Invitation';

export const CONFIRM_REVOKE_INVITATION_ACTION_AR = 'تأكيد إلغاء الدعوة';
export const CONFIRM_REVOKE_INVITATION_ACTION_EN = 'Confirm Revocation';

export const CANCEL_REVOKE_INVITATION_ACTION_AR = 'تراجع';
export const CANCEL_REVOKE_INVITATION_ACTION_EN = 'Cancel';

export const INVITATION_REVOKED_NO_EMAIL_NOTICE_AR =
  'تأكيد الإلغاء الخادمي: تم إلغاء هذه الدعوة نهائياً في الخادم، ولم يُرسل أي بريد إلكتروني أو إشعار خارجي، ولم يتم تفعيل أي حساب إداري.';

export const INVITATION_REVOKED_NO_EMAIL_NOTICE_EN =
  'Server Revocation Confirmation: This invitation has been permanently revoked on the server. No email or external notification was sent, and no administrative account was activated.';

export const REVOKED_INVITATION_CANNOT_BE_ACCEPTED_AR =
  'لا يمكن قبول الدعوة الملغاة أو استخدام معرفها لتفعيل أي صلاحيات إدارية.';

export const REVOKED_INVITATION_CANNOT_BE_ACCEPTED_EN =
  'A revoked invitation cannot be accepted or used to activate any administrative privileges.';

export const COPY_INVITATION_ID_ACTION_AR = 'نسخ معرف الدعوة';
export const COPY_INVITATION_ID_ACTION_EN = 'Copy Invitation ID';

export const MANUAL_HANDOFF_TRANSPARENCY_NOTICE_AR =
  'لم تُرسل هذه الدعوة تلقائيًا. نسخ المعرف لا يعني تسليمه أو قبوله. شارك المعرف مع صاحب البريد المستهدف عبر قناة موثوقة، واطلب منه تسجيل الدخول بحسابه المؤكد البريد ثم إدخال المعرف في قسم قبول الدعوة الإدارية.';

export const MANUAL_HANDOFF_TRANSPARENCY_NOTICE_EN =
  'This invitation has not been sent automatically. Copying the ID does not deliver or accept it. Share the ID with the intended email account holder through a trusted channel. They must sign in with their verified account and enter it in the Administrative Invitation Acceptance section.';

export const COPY_INVITATION_ID_SUCCESS_AR =
  'تم نسخ معرف الدعوة إلى الحافظة. تنبيه: النسخ لا يعني إرسال الدعوة أو تسليمها أو قبولها.';

export const COPY_INVITATION_ID_SUCCESS_EN =
  'Invitation ID copied to clipboard. Note: Copying does not send, deliver, or accept the invitation.';

export const COPY_INVITATION_ID_FAILURE_AR =
  'تعذر النسخ التلقائي إلى الحافظة. معرف الدعوة ظاهر أعلاه ويمكنك تحديده ونسخه يدويًا.';

export const COPY_INVITATION_ID_FAILURE_EN =
  'Automatic clipboard copy failed. The invitation ID remains visible above for manual selection and copying.';

export type AdminInvitationErrorCategory =
  | 'unauthorized'
  | 'existing-admin-conflict'
  | 'invalid-email'
  | 'invalid-role'
  | 'invalid-input'
  | 'unavailable'
  | 'server-failure';

export type AdminInvitationRevocationErrorCategory =
  | 'unauthorized'
  | 'confirmation-required'
  | 'non-pending-receipt'
  | 'already-accepted'
  | 'expired-invitation'
  | 'already-revoked'
  | 'concurrency-conflict'
  | 'unavailable'
  | 'server-failure';

export type AdminInvitationSubmissionStatus =
  | 'idle'
  | 'submitting'
  | 'succeeded'
  | 'error';

export type AdminInvitationRevocationStatus =
  | 'idle'
  | 'revoking'
  | 'revoked'
  | 'error';

export type AdminInvitationCopyStatus = 'idle' | 'copied' | 'copy-failed';

export interface AdminInvitationSubmissionError {
  readonly category: AdminInvitationErrorCategory;
  readonly messageAr: string;
  readonly messageEn: string;
}

export interface AdminInvitationRevocationError {
  readonly category: AdminInvitationRevocationErrorCategory;
  readonly messageAr: string;
  readonly messageEn: string;
}

export interface AdminInvitationSubmissionSnapshot {
  readonly status: AdminInvitationSubmissionStatus;
  readonly receipt:
    | CreateAdminInvitationClientResponse
    | RevokeAdminInvitationClientResponse
    | null;
  readonly error: AdminInvitationSubmissionError | null;
  readonly submissionCount: number;
  readonly revocationStatus?: AdminInvitationRevocationStatus;
  readonly revocationError?: AdminInvitationRevocationError | null;
  readonly revocationCount?: number;
  readonly copyStatus?: AdminInvitationCopyStatus;
  readonly lastCopiedInvitationId?: string | null;
}

const EMAIL_VALIDATION_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CANONICAL_INVITATION_ID_REGEX = /^[A-Za-z0-9_-]{8,128}$/;

export function isAuthorizedToCreateAdminInvitation(
  user: AdminUser | null | undefined,
  activeTabId: string = 'users'
): boolean {
  if (!user || typeof user !== 'object' || user.isActive !== true) {
    return false;
  }
  if (typeof user.id !== 'string' || !user.id.trim()) {
    return false;
  }
  if (user.role !== AdminRole.Owner) {
    return false;
  }
  if (activeTabId !== 'users') {
    return false;
  }
  if (!isTabAuthorized(user, AdminDomain.Users, AdminPermission.ManageUsers)) {
    return false;
  }
  if (!AdminAccessService.hasPermission(user, AdminPermission.ManageUsers)) {
    return false;
  }
  return true;
}

export function isAuthorizedToRevokeAdminInvitation(
  user: AdminUser | null | undefined,
  activeTabId: string = 'users'
): boolean {
  return isAuthorizedToCreateAdminInvitation(user, activeTabId);
}

export function isAuthorizedToHandoffAdminInvitation(
  user: AdminUser | null | undefined,
  activeTabId: string = 'users'
): boolean {
  return isAuthorizedToCreateAdminInvitation(user, activeTabId);
}

export function isDeliverablePendingInvitationReceipt(
  receipt:
    | CreateAdminInvitationClientResponse
    | RevokeAdminInvitationClientResponse
    | null
    | undefined
): receipt is CreateAdminInvitationClientResponse {
  if (!receipt || typeof receipt !== 'object' || !receipt.invitation) {
    return false;
  }
  if (
    typeof receipt.auditEventId !== 'string' ||
    !receipt.auditEventId.trim()
  ) {
    return false;
  }
  const inv = receipt.invitation;
  if (inv.status !== AdminInvitationStatus.Pending) {
    return false;
  }
  if (
    typeof inv.invitationId !== 'string' ||
    inv.invitationId.trim() !== inv.invitationId ||
    !CANONICAL_INVITATION_ID_REGEX.test(inv.invitationId)
  ) {
    return false;
  }
  const normalizedEmail = normalizeAndValidateInviteEmail(
    inv.normalizedTargetEmail
  );
  if (!normalizedEmail || inv.normalizedTargetEmail !== normalizedEmail) {
    return false;
  }
  if (!isInvitableAdminRole(inv.intendedRole)) {
    return false;
  }
  if (
    inv.revokedAtIso !== null ||
    inv.revokedByOwnerUid !== null ||
    inv.acceptedAtIso !== null ||
    inv.acceptedByUid !== null ||
    inv.expiredAtIso !== null
  ) {
    return false;
  }
  return true;
}

export function isInvitableAdminRole(
  role: unknown
): role is InvitableAdminRole {
  return (
    isValidAdminRole(role) &&
    role !== AdminRole.Owner &&
    (INVITABLE_ADMIN_ROLES as ReadonlyArray<string>).includes(role)
  );
}

export function normalizeAndValidateInviteEmail(rawEmail: unknown): string | null {
  if (typeof rawEmail !== 'string') {
    return null;
  }
  const normalized = rawEmail.trim().toLowerCase();
  if (
    !normalized ||
    normalized.length > 254 ||
    !EMAIL_VALIDATION_REGEX.test(normalized) ||
    normalized.includes('..')
  ) {
    return null;
  }
  return normalized;
}

export function normalizeAndValidateInvitationId(rawId: unknown): string | null {
  if (typeof rawId !== 'string') {
    return null;
  }
  const trimmed = rawId.trim();
  if (!trimmed || !CANONICAL_INVITATION_ID_REGEX.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function buildBilingualInvitationError(
  category: AdminInvitationErrorCategory
): AdminInvitationSubmissionError {
  switch (category) {
    case 'unauthorized':
      return Object.freeze({
        category,
        messageAr:
          'غير مصرح بإنشاء دعوة إدارية. يتطلب هذا الإجراء حساب مالك نشط (Owner) بصلاحية إدارة المستخدمين مصادق عليه من الخادم.',
        messageEn:
          'Unauthorized to create an administrative invitation. An active server-verified Owner account with ManageUsers permission is required.',
      });
    case 'existing-admin-conflict':
      return Object.freeze({
        category,
        messageAr:
          'لا يمكن إنشاء الدعوة: البريد الإلكتروني المستهدف مرتبط بالفعل بهوية إدارية قائمة أو يتعارض مع شروط الدعوة الخادمية.',
        messageEn:
          'Cannot create invitation: The target email already belongs to an existing administrator or conflicts with server invitation preconditions.',
      });
    case 'invalid-email':
      return Object.freeze({
        category,
        messageAr:
          'يرجى إدخال عنوان بريد إلكتروني صحيح ومعتمد للمرشح المستهدف.',
        messageEn:
          'Please enter a valid target email address for the invitee.',
      });
    case 'invalid-role':
      return Object.freeze({
        category,
        messageAr:
          'الدور الإداري المحدد غير مسموح به. يُستثنى دور المالك (Owner) وتُقبل الأدوار الإدارية المعتمدة فقط.',
        messageEn:
          'The selected administrative role is not allowed. The Owner role is excluded and only canonical non-Owner roles are permitted.',
      });
    case 'invalid-input':
      return Object.freeze({
        category,
        messageAr:
          'مدخلات طلب الدعوة غير صالحة. يرجى التحقق من البريد الإلكتروني والدور ومدة الصلاحية.',
        messageEn:
          'Invalid invitation request parameters. Please verify the target email, intended role, and expiration duration.',
      });
    case 'unavailable':
      return Object.freeze({
        category,
        messageAr:
          'خدمة الدعوات الإدارية الخادمية غير متاحة حالياً. لم يتم إنشاء أي دعوة.',
        messageEn:
          'The administrative invitation server service is currently unavailable. No invitation was created.',
      });
    case 'server-failure':
    default:
      return Object.freeze({
        category: 'server-failure',
        messageAr:
          'تعذر إتمام إنشاء الدعوة بسبب خطأ خادمي أو استجابة غير متوافقة. لم يتم تفعيل أي صلاحيات.',
        messageEn:
          'Failed to create the invitation due to a server error or non-compliant response. No permissions were granted.',
      });
  }
}

export function buildBilingualRevocationError(
  category: AdminInvitationRevocationErrorCategory
): AdminInvitationRevocationError {
  switch (category) {
    case 'unauthorized':
      return Object.freeze({
        category,
        messageAr:
          'غير مصرح بإلغاء الدعوة الإدارية. يتطلب هذا الإجراء حساب مالك نشط (Owner) بصلاحية إدارة المستخدمين مصادق عليه من الخادم.',
        messageEn:
          'Unauthorized to revoke an administrative invitation. An active server-verified Owner account with ManageUsers permission is required.',
      });
    case 'confirmation-required':
      return Object.freeze({
        category,
        messageAr:
          'يلزم التأكيد الصريح من المالك قبل إرسال طلب إلغاء الدعوة الإدارية إلى الخادم.',
        messageEn:
          'Explicit Owner confirmation is required before submitting the invitation revocation request to the server.',
      });
    case 'non-pending-receipt':
      return Object.freeze({
        category,
        messageAr:
          'لا يمكن إلغاء هذه الدعوة لأنها ليست في حالة معلقة (Pending).',
        messageEn:
          'Cannot revoke this invitation because it is not in Pending state.',
      });
    case 'already-accepted':
      return Object.freeze({
        category,
        messageAr:
          'رفض الخادم إلغاء الدعوة: تم قبول هذه الدعوة مسبقاً ولا يمكن إلغاؤها.',
        messageEn:
          'Server rejected revocation: This invitation has already been accepted and cannot be revoked.',
      });
    case 'expired-invitation':
      return Object.freeze({
        category,
        messageAr:
          'تعذر إلغاء الدعوة: انتهت صلاحية هذه الدعوة الإدارية بالفعل في الخادم.',
        messageEn:
          'Cannot revoke invitation: This administrative invitation has already expired on the server.',
      });
    case 'already-revoked':
      return Object.freeze({
        category,
        messageAr:
          'تم إلغاء هذه الدعوة الإدارية مسبقاً ولا يمكن إعادة إلغائها.',
        messageEn:
          'This administrative invitation has already been revoked.',
      });
    case 'concurrency-conflict':
      return Object.freeze({
        category,
        messageAr:
          'تعذر إلغاء الدعوة بسبب تعارض في رقم المراجعة (Revision) أو تغير حالتها في الخادم. تم الاحتفاظ بالإيصال السابق دون تغيير محلي.',
        messageEn:
          'Could not revoke invitation due to a revision conflict or server state change. The previous receipt was preserved without local fabrication.',
      });
    case 'unavailable':
      return Object.freeze({
        category,
        messageAr:
          'خدمة إلغاء الدعوات الإدارية الخادمية غير متاحة حالياً. لم يتم تغيير حالة الدعوة.',
        messageEn:
          'The administrative invitation revocation service is currently unavailable. Invitation status was not changed.',
      });
    case 'server-failure':
    default:
      return Object.freeze({
        category: 'server-failure',
        messageAr:
          'تعذر إتمام إلغاء الدعوة في الخادم. تم الاحتفاظ بالحالة الخادمية السابقة دون افتراض نجاح الإلغاء.',
        messageEn:
          'Failed to complete invitation revocation on the server. Previous server state was preserved without fabricating revocation.',
      });
  }
}

export function classifyInvitationCreationFailure(
  error: unknown
): AdminInvitationSubmissionError {
  if (error instanceof AdminIdentityClientError) {
    if (
      error.code === 'unauthenticated' ||
      error.code === 'permission-denied'
    ) {
      return buildBilingualInvitationError('unauthorized');
    }
    if (error.code === 'failed-precondition') {
      return buildBilingualInvitationError('existing-admin-conflict');
    }
    if (error.code === 'invalid-argument') {
      if (error.reason === 'INVALID_ADMIN_ROLE') {
        return buildBilingualInvitationError('invalid-role');
      }
      return buildBilingualInvitationError('invalid-input');
    }
    if (error.code === 'unavailable') {
      return buildBilingualInvitationError('unavailable');
    }
    return buildBilingualInvitationError('server-failure');
  }

  if (error && typeof error === 'object') {
    const rawCode = String((error as Record<string, unknown>).code ?? '')
      .trim()
      .toLowerCase()
      .replace(/^functions\//, '');

    if (rawCode === 'unauthenticated' || rawCode === 'permission-denied') {
      return buildBilingualInvitationError('unauthorized');
    }
    if (rawCode === 'failed-precondition' || rawCode === 'already-exists') {
      return buildBilingualInvitationError('existing-admin-conflict');
    }
    if (rawCode === 'invalid-argument') {
      return buildBilingualInvitationError('invalid-input');
    }
    if (rawCode === 'unavailable' || rawCode === 'deadline-exceeded') {
      return buildBilingualInvitationError('unavailable');
    }
  }

  return buildBilingualInvitationError('server-failure');
}

export function classifyInvitationRevocationFailure(
  error: unknown
): AdminInvitationRevocationError {
  if (error && typeof error === 'object') {
    const rawRecord = error as Record<string, unknown>;
    const rawCode = String(rawRecord.code ?? '')
      .trim()
      .replace(/^functions\//i, '');
    const upperCode = rawCode.toUpperCase();
    const lowerCode = rawCode.toLowerCase();
    const rawReason = String(rawRecord.reason ?? '').trim().toUpperCase();
    const rawMessage = String(rawRecord.message ?? '').toUpperCase();

    if (
      upperCode === 'INVITATION_ALREADY_ACCEPTED' ||
      rawReason === 'INVITATION_ALREADY_ACCEPTED' ||
      rawMessage.includes('INVITATION_ALREADY_ACCEPTED') ||
      rawMessage.includes('ALREADY_ACCEPTED')
    ) {
      return buildBilingualRevocationError('already-accepted');
    }

    if (
      upperCode === 'INVITATION_EXPIRED' ||
      rawReason === 'INVITATION_EXPIRED' ||
      rawMessage.includes('INVITATION_EXPIRED') ||
      rawMessage.includes('EXPIRED')
    ) {
      return buildBilingualRevocationError('expired-invitation');
    }

    if (
      upperCode === 'INVITATION_REVOKED' ||
      rawReason === 'INVITATION_REVOKED' ||
      rawMessage.includes('INVITATION_REVOKED') ||
      rawMessage.includes('ALREADY_REVOKED')
    ) {
      return buildBilingualRevocationError('already-revoked');
    }

    if (
      upperCode === 'CONCURRENT_MODIFICATION_CONFLICT' ||
      rawReason === 'CONCURRENT_MODIFICATION_CONFLICT' ||
      rawMessage.includes('CONCURRENT_MODIFICATION_CONFLICT') ||
      rawMessage.includes('REVISION')
    ) {
      return buildBilingualRevocationError('concurrency-conflict');
    }

    if (error instanceof AdminIdentityClientError) {
      if (
        error.code === 'unauthenticated' ||
        error.code === 'permission-denied'
      ) {
        return buildBilingualRevocationError('unauthorized');
      }
      if (error.code === 'failed-precondition') {
        return buildBilingualRevocationError('concurrency-conflict');
      }
      if (error.code === 'unavailable') {
        return buildBilingualRevocationError('unavailable');
      }
      return buildBilingualRevocationError('server-failure');
    }

    if (lowerCode === 'unauthenticated' || lowerCode === 'permission-denied') {
      return buildBilingualRevocationError('unauthorized');
    }
    if (lowerCode === 'failed-precondition' || lowerCode === 'aborted') {
      return buildBilingualRevocationError('concurrency-conflict');
    }
    if (lowerCode === 'unavailable' || lowerCode === 'deadline-exceeded') {
      return buildBilingualRevocationError('unavailable');
    }
  }

  return buildBilingualRevocationError('server-failure');
}

export interface SubmitAdminInvitationOptions {
  readonly currentUser: AdminUser | null | undefined;
  readonly activeTabId?: string;
  readonly targetEmail: unknown;
  readonly intendedRole: unknown;
  readonly ttlMs?: unknown;
  readonly existingDirectoryUsers?: ReadonlyArray<AdminUser>;
  readonly invokeCreateInvitation?: (
    input: CreateAdminInvitationClientInput
  ) => Promise<CreateAdminInvitationClientResponse>;
  readonly clientDeps?: AdminIdentityClientDependencies;
}

export interface RevokePendingAdminInvitationOptions {
  readonly currentUser: AdminUser | null | undefined;
  readonly activeTabId?: string;
  readonly confirmed: boolean;
  readonly invokeRevokeInvitation?: (
    input: RevokeAdminInvitationClientInput
  ) => Promise<RevokeAdminInvitationClientResponse>;
  readonly clientDeps?: AdminIdentityClientDependencies;
}

export interface CopyPendingAdminInvitationIdOptions {
  readonly currentUser: AdminUser | null | undefined;
  readonly activeTabId?: string;
  readonly writeClipboardText?: (text: string) => Promise<void>;
}

export class AdminInvitationCreationController {
  private snapshot: AdminInvitationSubmissionSnapshot;
  private isMounted = true;
  private readonly listeners = new Set<
    (snapshot: AdminInvitationSubmissionSnapshot) => void
  >();

  constructor(initial?: Partial<AdminInvitationSubmissionSnapshot>) {
    this.snapshot = Object.freeze({
      status: initial?.status ?? 'idle',
      receipt: initial?.receipt ?? null,
      error: initial?.error ?? null,
      submissionCount: initial?.submissionCount ?? 0,
      revocationStatus: initial?.revocationStatus ?? 'idle',
      revocationError: initial?.revocationError ?? null,
      revocationCount: initial?.revocationCount ?? 0,
      copyStatus: initial?.copyStatus ?? 'idle',
      lastCopiedInvitationId: initial?.lastCopiedInvitationId ?? null,
    });
  }

  public mount(): void {
    this.isMounted = true;
  }

  public unmount(): void {
    this.isMounted = false;
  }

  public getSnapshot(): AdminInvitationSubmissionSnapshot {
    return this.snapshot;
  }

  public subscribe(
    listener: (snapshot: AdminInvitationSubmissionSnapshot) => void
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(next: AdminInvitationSubmissionSnapshot): void {
    this.snapshot = Object.freeze(next);
    if (!this.isMounted) {
      return;
    }
    this.listeners.forEach((listener) => listener(this.snapshot));
  }

  public reset(): void {
    if (
      this.snapshot.status === 'submitting' ||
      this.snapshot.revocationStatus === 'revoking'
    ) {
      return;
    }
    this.emit({
      status: 'idle',
      receipt: null,
      error: null,
      submissionCount: this.snapshot.submissionCount,
      revocationStatus: 'idle',
      revocationError: null,
      revocationCount: this.snapshot.revocationCount ?? 0,
      copyStatus: 'idle',
      lastCopiedInvitationId: null,
    });
  }

  public async copyInvitationId(
    options: CopyPendingAdminInvitationIdOptions
  ): Promise<AdminInvitationSubmissionSnapshot> {
    if (
      this.snapshot.status === 'submitting' ||
      this.snapshot.revocationStatus === 'revoking'
    ) {
      return this.snapshot;
    }

    const activeTabId = options.activeTabId ?? 'users';

    // 1. Verify active Owner + ManageUsers authorization
    if (!isAuthorizedToHandoffAdminInvitation(options.currentUser, activeTabId)) {
      this.emit({
        ...this.snapshot,
        copyStatus: 'copy-failed',
        lastCopiedInvitationId: null,
      });
      return this.snapshot;
    }

    // 2. Verify authoritative deliverable Pending receipt
    const currentReceipt = this.snapshot.receipt;
    if (
      this.snapshot.status !== 'succeeded' ||
      !isDeliverablePendingInvitationReceipt(currentReceipt)
    ) {
      this.emit({
        ...this.snapshot,
        copyStatus: 'copy-failed',
        lastCopiedInvitationId: null,
      });
      return this.snapshot;
    }

    const rawInvitationId = currentReceipt.invitation.invitationId;

    try {
      const clipboardWriter =
        options.writeClipboardText ??
        (typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function'
          ? (text: string) => navigator.clipboard.writeText(text)
          : null);

      if (!clipboardWriter) {
        this.emit({
          ...this.snapshot,
          copyStatus: 'copy-failed',
          lastCopiedInvitationId: null,
        });
        return this.snapshot;
      }

      await clipboardWriter(rawInvitationId);

      this.emit({
        ...this.snapshot,
        copyStatus: 'copied',
        lastCopiedInvitationId: rawInvitationId,
      });
      return this.snapshot;
    } catch {
      this.emit({
        ...this.snapshot,
        copyStatus: 'copy-failed',
        lastCopiedInvitationId: null,
      });
      return this.snapshot;
    }
  }

  public async submit(
    options: SubmitAdminInvitationOptions
  ): Promise<AdminInvitationSubmissionSnapshot> {
    // Reject duplicate submissions while a request is already in-flight
    if (
      this.snapshot.status === 'submitting' ||
      this.snapshot.revocationStatus === 'revoking'
    ) {
      return this.snapshot;
    }

    const activeTabId = options.activeTabId ?? 'users';

    // 1. Verify active Owner + ManageUsers authorization
    if (!isAuthorizedToCreateAdminInvitation(options.currentUser, activeTabId)) {
      this.emit({
        status: 'error',
        receipt: null,
        error: buildBilingualInvitationError('unauthorized'),
        submissionCount: this.snapshot.submissionCount,
        revocationStatus: 'idle',
        revocationError: null,
        revocationCount: this.snapshot.revocationCount ?? 0,
        copyStatus: 'idle',
        lastCopiedInvitationId: null,
      });
      return this.snapshot;
    }

    // 2. Validate target email
    const normalizedEmail = normalizeAndValidateInviteEmail(options.targetEmail);
    if (!normalizedEmail) {
      this.emit({
        status: 'error',
        receipt: null,
        error: buildBilingualInvitationError('invalid-email'),
        submissionCount: this.snapshot.submissionCount,
        revocationStatus: 'idle',
        revocationError: null,
        revocationCount: this.snapshot.revocationCount ?? 0,
        copyStatus: 'idle',
        lastCopiedInvitationId: null,
      });
      return this.snapshot;
    }

    // 3. Validate canonical non-Owner intendedRole
    if (!isInvitableAdminRole(options.intendedRole)) {
      this.emit({
        status: 'error',
        receipt: null,
        error: buildBilingualInvitationError('invalid-role'),
        submissionCount: this.snapshot.submissionCount,
        revocationStatus: 'idle',
        revocationError: null,
        revocationCount: this.snapshot.revocationCount ?? 0,
        copyStatus: 'idle',
        lastCopiedInvitationId: null,
      });
      return this.snapshot;
    }

    // 4. Validate optional ttlMs if supplied
    let validatedTtlMs: number | undefined;
    if (options.ttlMs !== undefined) {
      if (
        typeof options.ttlMs !== 'number' ||
        !Number.isInteger(options.ttlMs) ||
        options.ttlMs < MIN_ADMIN_INVITATION_TTL_MS ||
        options.ttlMs > MAX_ADMIN_INVITATION_TTL_MS
      ) {
        this.emit({
          status: 'error',
          receipt: null,
          error: buildBilingualInvitationError('invalid-input'),
          submissionCount: this.snapshot.submissionCount,
          revocationStatus: 'idle',
          revocationError: null,
          revocationCount: this.snapshot.revocationCount ?? 0,
          copyStatus: 'idle',
          lastCopiedInvitationId: null,
        });
        return this.snapshot;
      }
      validatedTtlMs = options.ttlMs;
    }

    // 5. Check loaded directory for existing administrator conflict
    if (
      options.existingDirectoryUsers &&
      options.existingDirectoryUsers.some(
        (existing) =>
          existing.email.trim().toLowerCase() === normalizedEmail
      )
    ) {
      this.emit({
        status: 'error',
        receipt: null,
        error: buildBilingualInvitationError('existing-admin-conflict'),
        submissionCount: this.snapshot.submissionCount,
        revocationStatus: 'idle',
        revocationError: null,
        revocationCount: this.snapshot.revocationCount ?? 0,
        copyStatus: 'idle',
        lastCopiedInvitationId: null,
      });
      return this.snapshot;
    }

    const nextSubmissionCount = this.snapshot.submissionCount + 1;
    this.emit({
      status: 'submitting',
      receipt: null,
      error: null,
      submissionCount: nextSubmissionCount,
      revocationStatus: 'idle',
      revocationError: null,
      revocationCount: this.snapshot.revocationCount ?? 0,
      copyStatus: 'idle',
      lastCopiedInvitationId: null,
    });

    const requestInput: CreateAdminInvitationClientInput = Object.freeze({
      targetEmail: normalizedEmail,
      intendedRole: options.intendedRole,
      ...(validatedTtlMs !== undefined ? { ttlMs: validatedTtlMs } : {}),
    });

    try {
      const invoker =
        options.invokeCreateInvitation ??
        ((input: CreateAdminInvitationClientInput) =>
          createAdminInvitation(input, options.clientDeps));

      const response = await invoker(requestInput);

      // Fail-closed verification of Pending receipt
      if (
        !response ||
        typeof response !== 'object' ||
        !response.invitation ||
        response.invitation.status !== AdminInvitationStatus.Pending ||
        response.invitation.intendedRole === AdminRole.Owner ||
        response.invitation.intendedRole !== options.intendedRole ||
        response.invitation.normalizedTargetEmail !== normalizedEmail ||
        typeof response.invitation.invitationId !== 'string' ||
        !response.invitation.invitationId.trim() ||
        typeof response.auditEventId !== 'string' ||
        !response.auditEventId.trim()
      ) {
        this.emit({
          status: 'error',
          receipt: null,
          error: buildBilingualInvitationError('server-failure'),
          submissionCount: nextSubmissionCount,
          revocationStatus: 'idle',
          revocationError: null,
          revocationCount: this.snapshot.revocationCount ?? 0,
          copyStatus: 'idle',
          lastCopiedInvitationId: null,
        });
        return this.snapshot;
      }

      this.emit({
        status: 'succeeded',
        receipt: response,
        error: null,
        submissionCount: nextSubmissionCount,
        revocationStatus: 'idle',
        revocationError: null,
        revocationCount: this.snapshot.revocationCount ?? 0,
        copyStatus: 'idle',
        lastCopiedInvitationId: null,
      });
      return this.snapshot;
    } catch (error: unknown) {
      const classified = classifyInvitationCreationFailure(error);
      this.emit({
        status: 'error',
        receipt: null,
        error: classified,
        submissionCount: nextSubmissionCount,
        revocationStatus: 'idle',
        revocationError: null,
        revocationCount: this.snapshot.revocationCount ?? 0,
        copyStatus: 'idle',
        lastCopiedInvitationId: null,
      });
      return this.snapshot;
    }
  }

  public async revoke(
    options: RevokePendingAdminInvitationOptions
  ): Promise<AdminInvitationSubmissionSnapshot> {
    // Prevent duplicate requests while creation or revocation is in-flight
    if (
      this.snapshot.status === 'submitting' ||
      this.snapshot.revocationStatus === 'revoking'
    ) {
      return this.snapshot;
    }

    const currentRevocationCount = this.snapshot.revocationCount ?? 0;
    const activeTabId = options.activeTabId ?? 'users';

    // 1. Verify active Owner + ManageUsers authorization
    if (!isAuthorizedToRevokeAdminInvitation(options.currentUser, activeTabId)) {
      this.emit({
        ...this.snapshot,
        revocationStatus: 'error',
        revocationError: buildBilingualRevocationError('unauthorized'),
        revocationCount: currentRevocationCount,
      });
      return this.snapshot;
    }

    // 2. Require an existing authoritative Pending receipt
    const currentReceipt = this.snapshot.receipt;
    if (
      this.snapshot.status !== 'succeeded' ||
      !currentReceipt ||
      !currentReceipt.invitation
    ) {
      this.emit({
        ...this.snapshot,
        revocationStatus: 'error',
        revocationError: buildBilingualRevocationError('non-pending-receipt'),
        revocationCount: currentRevocationCount,
      });
      return this.snapshot;
    }

    if (currentReceipt.invitation.status === AdminInvitationStatus.Revoked) {
      this.emit({
        ...this.snapshot,
        revocationStatus: 'error',
        revocationError: buildBilingualRevocationError('already-revoked'),
        revocationCount: currentRevocationCount,
      });
      return this.snapshot;
    }

    if (currentReceipt.invitation.status !== AdminInvitationStatus.Pending) {
      this.emit({
        ...this.snapshot,
        revocationStatus: 'error',
        revocationError: buildBilingualRevocationError('non-pending-receipt'),
        revocationCount: currentRevocationCount,
      });
      return this.snapshot;
    }

    // 3. Require explicit confirmation before sending the server request
    if (options.confirmed !== true) {
      this.emit({
        ...this.snapshot,
        revocationStatus: 'error',
        revocationError: buildBilingualRevocationError('confirmation-required'),
        revocationCount: currentRevocationCount,
      });
      return this.snapshot;
    }

    const invitationId =
      typeof currentReceipt.invitation.invitationId === 'string'
        ? currentReceipt.invitation.invitationId.trim()
        : '';
    const expectedRevision =
      typeof currentReceipt.invitation.revision === 'number' &&
      Number.isInteger(currentReceipt.invitation.revision) &&
      currentReceipt.invitation.revision >= 1
        ? currentReceipt.invitation.revision
        : undefined;

    if (!invitationId) {
      this.emit({
        ...this.snapshot,
        revocationStatus: 'error',
        revocationError: buildBilingualRevocationError('server-failure'),
        revocationCount: currentRevocationCount,
      });
      return this.snapshot;
    }

    const nextRevocationCount = currentRevocationCount + 1;
    this.emit({
      ...this.snapshot,
      revocationStatus: 'revoking',
      revocationError: null,
      revocationCount: nextRevocationCount,
      copyStatus: 'idle',
      lastCopiedInvitationId: null,
    });

    const requestInput: RevokeAdminInvitationClientInput = Object.freeze({
      invitationId,
      ...(expectedRevision !== undefined ? { expectedRevision } : {}),
    });

    try {
      const invoker =
        options.invokeRevokeInvitation ??
        ((input: RevokeAdminInvitationClientInput) =>
          revokeAdminInvitation(input, options.clientDeps));

      const response = await invoker(requestInput);

      // Fail-closed validation of server Revoked response
      if (
        !response ||
        typeof response !== 'object' ||
        !response.invitation ||
        response.invitation.invitationId !== invitationId ||
        response.invitation.normalizedTargetEmail !==
          currentReceipt.invitation.normalizedTargetEmail ||
        response.invitation.intendedRole !==
          currentReceipt.invitation.intendedRole ||
        response.invitation.intendedRole === AdminRole.Owner ||
        response.invitation.status !== AdminInvitationStatus.Revoked ||
        typeof response.invitation.revokedAtIso !== 'string' ||
        !response.invitation.revokedAtIso.trim() ||
        typeof response.invitation.revokedByOwnerUid !== 'string' ||
        !response.invitation.revokedByOwnerUid.trim() ||
        response.invitation.acceptedAtIso !== null ||
        response.invitation.acceptedByUid !== null ||
        typeof response.invitation.revision !== 'number' ||
        !Number.isInteger(response.invitation.revision) ||
        (expectedRevision !== undefined
          ? response.invitation.revision !== expectedRevision + 1
          : response.invitation.revision < 2) ||
        typeof response.auditEventId !== 'string' ||
        !response.auditEventId.trim()
      ) {
        this.emit({
          ...this.snapshot,
          receipt: currentReceipt,
          revocationStatus: 'error',
          revocationError: buildBilingualRevocationError('server-failure'),
          revocationCount: nextRevocationCount,
          copyStatus: 'idle',
          lastCopiedInvitationId: null,
        });
        return this.snapshot;
      }

      this.emit({
        ...this.snapshot,
        status: 'succeeded',
        receipt: response,
        error: null,
        revocationStatus: 'revoked',
        revocationError: null,
        revocationCount: nextRevocationCount,
        copyStatus: 'idle',
        lastCopiedInvitationId: null,
      });
      return this.snapshot;
    } catch (error: unknown) {
      const classified = classifyInvitationRevocationFailure(error);
      this.emit({
        ...this.snapshot,
        receipt: currentReceipt,
        revocationStatus: 'error',
        revocationError: classified,
        revocationCount: nextRevocationCount,
      });
      return this.snapshot;
    }
  }
}

export interface AdminInvitationCreationPanelProps {
  readonly currentUser: AdminUser;
  readonly activeTabId?: string;
  readonly existingDirectoryUsers?: ReadonlyArray<AdminUser>;
  readonly clientDeps?: AdminIdentityClientDependencies;
  readonly invokeCreateInvitation?: (
    input: CreateAdminInvitationClientInput
  ) => Promise<CreateAdminInvitationClientResponse>;
  readonly invokeRevokeInvitation?: (
    input: RevokeAdminInvitationClientInput
  ) => Promise<RevokeAdminInvitationClientResponse>;
  readonly writeClipboardText?: (text: string) => Promise<void>;
  readonly initialSubmissionState?: Partial<AdminInvitationSubmissionSnapshot>;
  readonly initialConfirmingRevocation?: boolean;
  readonly onClose?: () => void;
}

export const AdminInvitationCreationPanel: React.FC<
  AdminInvitationCreationPanelProps
> = ({
  currentUser,
  activeTabId = 'users',
  existingDirectoryUsers = [],
  clientDeps,
  invokeCreateInvitation,
  invokeRevokeInvitation,
  writeClipboardText,
  initialSubmissionState,
  initialConfirmingRevocation = false,
  onClose,
}) => {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  const isAuthorizedOwner = isAuthorizedToCreateAdminInvitation(
    currentUser,
    activeTabId
  );

  const controllerRef = useRef<AdminInvitationCreationController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new AdminInvitationCreationController(
      initialSubmissionState
    );
  }

  const [submissionSnapshot, setSubmissionSnapshot] =
    useState<AdminInvitationSubmissionSnapshot>(() =>
      controllerRef.current!.getSnapshot()
    );

  const [targetEmail, setTargetEmail] = useState<string>('');
  const [intendedRole, setIntendedRole] = useState<InvitableAdminRole>(
    AdminRole.ContentEditor
  );
  const [selectedTtlMs, setSelectedTtlMs] = useState<number>(
    DEFAULT_ADMIN_INVITATION_TTL_MS
  );
  const [isConfirmingRevocation, setIsConfirmingRevocation] = useState<boolean>(
    initialConfirmingRevocation
  );

  useEffect(() => {
    const controller = controllerRef.current!;
    controller.mount();
    const unsubscribe = controller.subscribe((next) => {
      setSubmissionSnapshot(next);
      if (next.receipt?.invitation.status === AdminInvitationStatus.Revoked) {
        setIsConfirmingRevocation(false);
      }
    });
    return () => {
      unsubscribe();
      controller.unmount();
    };
  }, []);

  if (!isAuthorizedOwner) {
    return null;
  }

  const isSubmitting = submissionSnapshot.status === 'submitting';
  const isRevoking = submissionSnapshot.revocationStatus === 'revoking';
  const receipt = submissionSnapshot.receipt;
  const submissionError = submissionSnapshot.error;
  const revocationError = submissionSnapshot.revocationError ?? null;
  const copyStatus = submissionSnapshot.copyStatus ?? 'idle';

  const isDeliverableReceipt = isDeliverablePendingInvitationReceipt(receipt);
  const isReceiptPending = isDeliverableReceipt;
  const canHandoffPendingReceipt =
    isDeliverableReceipt && !isSubmitting && !isRevoking;
  const isReceiptRevoked =
    receipt?.invitation.status === AdminInvitationStatus.Revoked;

  const selectedRolePermissions = Array.from(
    AdminAccessService.getPermissionsForRole(intendedRole)
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || isRevoking) {
      return;
    }
    setIsConfirmingRevocation(false);
    await controllerRef.current!.submit({
      currentUser,
      activeTabId,
      targetEmail,
      intendedRole,
      ttlMs: selectedTtlMs,
      existingDirectoryUsers,
      invokeCreateInvitation,
      clientDeps,
    });
  };

  const handleCopyInvitationId = async () => {
    if (!canHandoffPendingReceipt) {
      return;
    }
    await controllerRef.current!.copyInvitationId({
      currentUser,
      activeTabId,
      writeClipboardText,
    });
  };

  const handleRequestRevocation = () => {
    if (isSubmitting || isRevoking || !isReceiptPending) {
      return;
    }
    setIsConfirmingRevocation(true);
  };

  const handleCancelRevocation = () => {
    if (isRevoking) {
      return;
    }
    setIsConfirmingRevocation(false);
  };

  const handleConfirmRevocation = async () => {
    if (isSubmitting || isRevoking || !isReceiptPending) {
      return;
    }
    await controllerRef.current!.revoke({
      currentUser,
      activeTabId,
      confirmed: true,
      invokeRevokeInvitation,
      clientDeps,
    });
  };

  const handlePrepareAnother = () => {
    if (isSubmitting || isRevoking) return;
    setTargetEmail('');
    setIntendedRole(AdminRole.ContentEditor);
    setSelectedTtlMs(DEFAULT_ADMIN_INVITATION_TTL_MS);
    setIsConfirmingRevocation(false);
    controllerRef.current!.reset();
  };

  return (
    <div
      className="bg-white dark:bg-gray-900 rounded-2xl border border-emerald-200/90 dark:border-emerald-900/60 p-4 sm:p-6 shadow-xs space-y-5 min-w-0 max-w-full"
      dir={isAr ? 'rtl' : 'ltr'}
      data-testid="admin-invitation-creation-panel"
    >
      {/* Panel Header */}
      <div className="flex items-start justify-between gap-3 pb-4 border-b border-gray-100 dark:border-gray-800 min-w-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
            <MailPlus className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <h3 className="text-sm sm:text-base font-extrabold text-gray-900 dark:text-gray-100 break-words">
                {isAr
                  ? 'إنشاء دعوة إدارية معلقة (Pending Invitation)'
                  : 'Create Pending Administrative Invitation'}
              </h3>
              <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 shrink-0">
                {isAr ? '· للمالك فقط (Owner)' : '· Owner Only'}
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {isAr
                ? 'تسجيل دعوة إدارية معلقة عبر الخدمة الخادمية الآمنة دون تفعيل فوري أو إرسال بريد تلقائي.'
                : 'Register a server-authoritative Pending administrative invitation without immediate activation or automatic email dispatch.'}
            </p>
          </div>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting || isRevoking}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer disabled:opacity-50 shrink-0"
            aria-label={isAr ? 'إغلاق نافذة الدعوة' : 'Close invitation panel'}
            data-testid="close-admin-invitation-panel-btn"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Transparency Guard Banner */}
      <div
        className="p-3.5 rounded-xl bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200/80 dark:border-sky-900/50 flex items-start gap-2.5 text-xs text-sky-900 dark:text-sky-200"
        data-testid="admin-invitation-transparency-notice"
      >
        <Info className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
        <div className="space-y-1 min-w-0">
          <p className="font-semibold leading-relaxed">
            {isAr
              ? INVITATION_NO_EMAIL_SENT_NOTICE_AR
              : INVITATION_NO_EMAIL_SENT_NOTICE_EN}
          </p>
          <p className="text-[11px] text-sky-800/90 dark:text-sky-300/90 leading-relaxed">
            {isAr
              ? INVITATION_LOCATOR_NOTICE_AR
              : INVITATION_LOCATOR_NOTICE_EN}
          </p>
        </div>
      </div>

      {/* Creation Error Feedback Banner */}
      {submissionError && (
        <div
          className="p-4 rounded-xl bg-rose-50/80 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 flex items-start gap-3 text-xs text-rose-900 dark:text-rose-200"
          role="alert"
          data-testid="admin-invitation-error-banner"
          data-error-category={submissionError.category}
        >
          {submissionError.category === 'unavailable' ? (
            <WifiOff className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          ) : submissionError.category === 'unauthorized' ? (
            <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          )}
          <div className="space-y-1 min-w-0 flex-1">
            <p className="font-bold">
              {isAr ? submissionError.messageAr : submissionError.messageEn}
            </p>
            <p className="text-[11px] text-rose-700/90 dark:text-rose-300/90">
              {isAr
                ? submissionError.messageEn
                : submissionError.messageAr}
            </p>
          </div>
        </div>
      )}

      {/* Invitation Receipt (Pending or Server-Revoked) */}
      {submissionSnapshot.status === 'succeeded' && receipt && (
        <div
          className={`p-4 sm:p-5 rounded-2xl border space-y-4 min-w-0 ${
            isReceiptRevoked
              ? 'bg-gray-50/90 dark:bg-gray-900/60 border-gray-300 dark:border-gray-700'
              : 'bg-emerald-50/60 dark:bg-emerald-950/25 border-emerald-200 dark:border-emerald-800/70'
          }`}
          data-testid="admin-invitation-pending-receipt"
          data-invitation-status={receipt.invitation.status}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-emerald-200/60 dark:border-emerald-800/60">
            <div className="flex items-center gap-2">
              {isReceiptRevoked ? (
                <Ban className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              )}
              <h4 className="text-xs sm:text-sm font-extrabold text-emerald-950 dark:text-emerald-100">
                {isReceiptRevoked
                  ? isAr
                    ? 'تم إلغاء الدعوة الإدارية في الخادم (Revoked)'
                    : 'Administrative Invitation Revoked by Server'
                  : isAr
                    ? 'تم تسجيل الدعوة الإدارية في الخادم بحالة معلقة (Pending)'
                    : 'Server Invitation Recorded in Pending State'}
              </h4>
            </div>
            <span
              className={`text-xs font-extrabold shrink-0 ${
                isReceiptRevoked
                  ? 'text-rose-700 dark:text-rose-300'
                  : 'text-amber-800 dark:text-amber-300'
              }`}
              data-testid="receipt-invitation-status"
            >
              {isReceiptRevoked
                ? isAr
                  ? `الحالة: ملغاة (${receipt.invitation.status})`
                  : `Status: ${receipt.invitation.status}`
                : isAr
                  ? `الحالة: معلقة (${receipt.invitation.status})`
                  : `Status: ${receipt.invitation.status}`}
            </span>
          </div>

          {/* Revocation Error Banner (Preserving Authoritative Receipt) */}
          {revocationError && (
            <div
              className="p-3.5 rounded-xl bg-rose-50/90 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/70 flex items-start gap-2.5 text-xs text-rose-900 dark:text-rose-200"
              role="alert"
              data-testid="admin-invitation-revocation-error-banner"
              data-error-category={revocationError.category}
            >
              {revocationError.category === 'unavailable' ? (
                <WifiOff className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              ) : revocationError.category === 'unauthorized' ? (
                <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1 min-w-0 flex-1">
                <p className="font-bold leading-relaxed">
                  {isAr ? revocationError.messageAr : revocationError.messageEn}
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs tabular-nums min-w-0">
            <div className="bg-white/90 dark:bg-gray-900/80 p-3 rounded-xl border border-emerald-200/50 dark:border-emerald-900/50 min-w-0 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400">
                    {isAr
                      ? 'معرّف موقع الدعوة (Invitation Locator ID)'
                      : 'Invitation Locator ID (Not a Secret)'}
                  </p>
                  <p
                    className="font-mono font-bold text-gray-900 dark:text-gray-100 mt-0.5 break-all select-all"
                    data-testid="receipt-invitation-id"
                  >
                    {receipt.invitation.invitationId}
                  </p>
                </div>

                {canHandoffPendingReceipt && (
                  <button
                    type="button"
                    onClick={() => void handleCopyInvitationId()}
                    className="px-2.5 py-1.5 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/70 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800/80 text-[11px] font-bold rounded-lg inline-flex items-center gap-1.5 cursor-pointer transition-colors shrink-0"
                    data-testid="copy-invitation-id-btn"
                  >
                    <Copy className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {isAr
                        ? COPY_INVITATION_ID_ACTION_AR
                        : COPY_INVITATION_ID_ACTION_EN}
                    </span>
                  </button>
                )}
              </div>

              {canHandoffPendingReceipt && copyStatus !== 'idle' && (
                <div
                  className={`p-2 rounded-lg border text-[11px] font-semibold flex items-start gap-1.5 ${
                    copyStatus === 'copied'
                      ? 'bg-emerald-50/90 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/70 text-emerald-900 dark:text-emerald-200'
                      : 'bg-amber-50/90 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800/70 text-amber-900 dark:text-amber-200'
                  }`}
                  role="status"
                  data-testid="invitation-copy-feedback-banner"
                  data-copy-status={copyStatus}
                >
                  {copyStatus === 'copied' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  )}
                  <span>
                    {copyStatus === 'copied'
                      ? isAr
                        ? COPY_INVITATION_ID_SUCCESS_AR
                        : COPY_INVITATION_ID_SUCCESS_EN
                      : isAr
                        ? COPY_INVITATION_ID_FAILURE_AR
                        : COPY_INVITATION_ID_FAILURE_EN}
                  </span>
                </div>
              )}
            </div>

            <div className="bg-white/90 dark:bg-gray-900/80 p-3 rounded-xl border border-emerald-200/50 dark:border-emerald-900/50 min-w-0">
              <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400">
                {isAr ? 'البريد الإلكتروني المستهدف' : 'Normalized Target Email'}
              </p>
              <p
                className="font-mono font-bold text-gray-900 dark:text-gray-100 mt-0.5 break-all"
                data-testid="receipt-target-email"
              >
                {receipt.invitation.normalizedTargetEmail}
              </p>
            </div>

            <div className="bg-white/90 dark:bg-gray-900/80 p-3 rounded-xl border border-emerald-200/50 dark:border-emerald-900/50 min-w-0">
              <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400">
                {isAr ? 'الدور الإداري المقصود (غير مفعّل بعد)' : 'Intended Role (Not Yet Active)'}
              </p>
              <p
                className="font-bold text-gray-900 dark:text-gray-100 mt-0.5"
                data-testid="receipt-intended-role"
              >
                {getRoleLabel(receipt.invitation.intendedRole, isAr)} ({receipt.invitation.intendedRole})
              </p>
            </div>

            <div className="bg-white/90 dark:bg-gray-900/80 p-3 rounded-xl border border-emerald-200/50 dark:border-emerald-900/50 min-w-0">
              <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400">
                {isAr ? 'تاريخ انتهاء الصلاحية (UTC)' : 'Expires At (UTC)'}
              </p>
              <p
                className="font-mono font-semibold text-gray-800 dark:text-gray-200 mt-0.5 break-all"
                data-testid="receipt-expires-at"
              >
                {receipt.invitation.expiresAtIso}
              </p>
            </div>

            <div className="bg-white/90 dark:bg-gray-900/80 p-3 rounded-xl border border-emerald-200/50 dark:border-emerald-900/50 min-w-0">
              <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400">
                {isAr ? 'تاريخ الإنشاء والمالك المصدِر' : 'Created At & Inviting Owner'}
              </p>
              <p
                className="font-mono text-[11px] text-gray-700 dark:text-gray-300 mt-0.5 break-all"
                data-testid="receipt-created-meta"
              >
                {receipt.invitation.createdAtIso} · {receipt.invitation.invitingOwnerUid}
              </p>
            </div>

            <div className="bg-white/90 dark:bg-gray-900/80 p-3 rounded-xl border border-emerald-200/50 dark:border-emerald-900/50 min-w-0">
              <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400">
                {isAr ? 'معرّف سجل التدقيق والمراجعة' : 'Audit Event ID & Revision'}
              </p>
              <p
                className="font-mono text-[11px] text-gray-700 dark:text-gray-300 mt-0.5 break-all"
                data-testid="receipt-audit-event-id"
              >
                {receipt.auditEventId} (rev {receipt.invitation.revision})
              </p>
            </div>

            {isReceiptRevoked && receipt.invitation.revokedAtIso && (
              <div className="bg-white/90 dark:bg-gray-900/80 p-3 rounded-xl border border-rose-200/60 dark:border-rose-900/50 sm:col-span-2 min-w-0">
                <p className="text-[11px] font-bold text-rose-700 dark:text-rose-400">
                  {isAr
                    ? 'توقيت الإلغاء والمالك المنفّذ'
                    : 'Revoked At & Revoking Owner'}
                </p>
                <p
                  className="font-mono text-[11px] text-gray-800 dark:text-gray-200 mt-0.5 break-all"
                  data-testid="receipt-revoked-meta"
                >
                  {receipt.invitation.revokedAtIso} ·{' '}
                  {receipt.invitation.revokedByOwnerUid}
                </p>
              </div>
            )}
          </div>

          {isReceiptRevoked ? (
            <div
              className="p-3 rounded-xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-800/60 text-xs text-rose-900 dark:text-rose-200 space-y-1"
              data-testid="receipt-revoked-confirmation"
            >
              <p className="font-bold">
                {isAr
                  ? INVITATION_REVOKED_NO_EMAIL_NOTICE_AR
                  : INVITATION_REVOKED_NO_EMAIL_NOTICE_EN}
              </p>
              <p
                className="text-[11px] font-semibold"
                data-testid="receipt-revoked-cannot-accept-notice"
              >
                {isAr
                  ? REVOKED_INVITATION_CANNOT_BE_ACCEPTED_AR
                  : REVOKED_INVITATION_CANNOT_BE_ACCEPTED_EN}
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div
                className="p-3 rounded-xl bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 text-xs text-amber-900 dark:text-amber-200 space-y-1"
                data-testid="receipt-non-activation-confirmation"
              >
                <p className="font-bold">
                  {isAr
                    ? 'تأكيد الحالة: لم يتم إرسال أي بريد إلكتروني، ولم يتم تفعيل حساب المشرف أو إضافته إلى قائمة المشرفين النشطين.'
                    : 'Lifecycle Confirmation: No email has been sent, and the invitee has NOT been activated or added to the active administrators directory.'}
                </p>
                <p className="text-[11px]">
                  {isAr
                    ? 'تظل هذه الدعوة في حالة معلقة (Pending) إلى حين إتمام إجراءات القبول الخادمية المستقلة.'
                    : 'This invitation remains in Pending state and confers zero administrative privileges until server-verified acceptance.'}
                </p>
              </div>

              {canHandoffPendingReceipt && (
                <div
                  className="p-3 rounded-xl bg-sky-50/80 dark:bg-sky-950/40 border border-sky-200/80 dark:border-sky-800/60 text-xs text-sky-950 dark:text-sky-100 space-y-1"
                  data-testid="receipt-manual-handoff-notice"
                >
                  <p className="font-semibold leading-relaxed">
                    {isAr
                      ? MANUAL_HANDOFF_TRANSPARENCY_NOTICE_AR
                      : MANUAL_HANDOFF_TRANSPARENCY_NOTICE_EN}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Explicit Confirmation Step Before Revoking Pending Invitation */}
          {isReceiptPending && isConfirmingRevocation && (
            <div
              className="p-3.5 rounded-xl bg-rose-50/90 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 space-y-3 text-xs text-rose-950 dark:text-rose-100"
              data-testid="revoke-invitation-confirmation-box"
            >
              <div className="space-y-1">
                <p className="font-extrabold">
                  {isAr
                    ? 'هل أنت متأكد من إلغاء هذه الدعوة الإدارية المعلقة؟'
                    : 'Are you sure you want to revoke this Pending administrative invitation?'}
                </p>
                <p className="text-[11px] text-rose-800 dark:text-rose-300 leading-relaxed">
                  {isAr
                    ? `سيتم إبطال الدعوة (${receipt.invitation.invitationId}) عند المراجعة (rev ${receipt.invitation.revision}) في الخادم نهائياً دون إرسال أي بريد إلكتروني.`
                    : `Invitation (${receipt.invitation.invitationId}) at revision (rev ${receipt.invitation.revision}) will be permanently revoked on the server without sending any email.`}
                </p>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={isRevoking}
                  onClick={handleCancelRevocation}
                  className="w-full sm:w-auto px-3.5 py-2 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 border border-gray-300 dark:border-gray-700 text-xs font-bold rounded-xl cursor-pointer transition-colors disabled:opacity-50"
                  data-testid="cancel-revoke-invitation-btn"
                >
                  {isAr
                    ? CANCEL_REVOKE_INVITATION_ACTION_AR
                    : CANCEL_REVOKE_INVITATION_ACTION_EN}
                </button>
                <button
                  type="button"
                  disabled={isRevoking}
                  onClick={() => void handleConfirmRevocation()}
                  className="w-full sm:w-auto px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                  data-testid="confirm-revoke-invitation-btn"
                >
                  {isRevoking ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                      <span>
                        {isAr ? 'جاري إلغاء الدعوة...' : 'Revoking Invitation...'}
                      </span>
                    </>
                  ) : (
                    <>
                      <Ban className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {isAr
                          ? CONFIRM_REVOKE_INVITATION_ACTION_AR
                          : CONFIRM_REVOKE_INVITATION_ACTION_EN}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Receipt Action Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
            {isReceiptPending && !isConfirmingRevocation ? (
              <button
                type="button"
                disabled={isRevoking || isSubmitting}
                onClick={handleRequestRevocation}
                className="w-full sm:w-auto px-4 py-2 bg-rose-50 dark:bg-rose-950/60 hover:bg-rose-100 dark:hover:bg-rose-900/70 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/80 text-xs font-bold rounded-xl inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                data-testid="request-revoke-invitation-btn"
              >
                <Ban className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {isAr
                    ? REVOKE_INVITATION_ACTION_AR
                    : REVOKE_INVITATION_ACTION_EN}
                </span>
              </button>
            ) : (
              <div />
            )}

            <button
              type="button"
              disabled={isRevoking || isSubmitting}
              onClick={handlePrepareAnother}
              className="w-full sm:w-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl cursor-pointer transition-colors disabled:opacity-50"
              data-testid="prepare-another-invitation-btn"
            >
              {isAr ? 'إنشاء دعوة أخرى' : 'Create Another Invitation'}
            </button>
          </div>
        </div>
      )}

      {/* Invitation Creation Form */}
      {submissionSnapshot.status !== 'succeeded' && (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="space-y-4 min-w-0"
          data-testid="admin-invitation-creation-form"
          noValidate
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-w-0">
            {/* 1. Target Email Input */}
            <div className="space-y-1.5 min-w-0">
              <label
                htmlFor="invitation-target-email-input"
                className="block text-xs font-bold text-gray-800 dark:text-gray-200"
              >
                {isAr ? 'البريد الإلكتروني للمرشح المستهدف' : 'Target Invitee Email'}
              </label>
              <input
                id="invitation-target-email-input"
                type="email"
                required
                disabled={isSubmitting}
                value={targetEmail}
                onChange={(e) => setTargetEmail(e.target.value)}
                placeholder="name@promiseofplanet.org"
                autoComplete="off"
                className="w-full min-w-0 px-3.5 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-hidden focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 font-mono disabled:opacity-60"
                data-testid="invitation-target-email-input"
              />
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {isAr
                  ? 'سيتم تطبيع البريد والتحقق من عدم تعارضه مع المشرفين الحاليين.'
                  : 'Normalized and checked against existing administrators.'}
              </p>
            </div>

            {/* 2. Canonical Non-Owner Role Selector */}
            <div className="space-y-1.5 min-w-0">
              <label
                htmlFor="invitation-intended-role-select"
                className="block text-xs font-bold text-gray-800 dark:text-gray-200"
              >
                {isAr
                  ? 'الدور الإداري المقصود (باستثناء المالك)'
                  : 'Intended Canonical Role (Excludes Owner)'}
              </label>
              <select
                id="invitation-intended-role-select"
                disabled={isSubmitting}
                value={intendedRole}
                onChange={(e) =>
                  setIntendedRole(e.target.value as InvitableAdminRole)
                }
                className="w-full min-w-0 px-3.5 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-semibold text-gray-900 dark:text-gray-100 focus:outline-hidden focus:border-emerald-500 cursor-pointer disabled:opacity-60"
                data-testid="invitation-intended-role-select"
              >
                {INVITABLE_ADMIN_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {getRoleLabel(role, isAr)} ({role})
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {getRoleDescription(intendedRole, isAr)}
              </p>
            </div>

            {/* 3. Canonical Expiration Duration (ttlMs) */}
            <div className="space-y-1.5 min-w-0">
              <label
                htmlFor="invitation-ttl-select"
                className="block text-xs font-bold text-gray-800 dark:text-gray-200 flex items-center gap-1.5"
              >
                <Clock className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>
                  {isAr ? 'مدة صلاحية الدعوة المعلقة' : 'Pending Invitation Expiration'}
                </span>
              </label>
              <select
                id="invitation-ttl-select"
                disabled={isSubmitting}
                value={selectedTtlMs}
                onChange={(e) => setSelectedTtlMs(Number(e.target.value))}
                className="w-full min-w-0 px-3.5 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-semibold text-gray-900 dark:text-gray-100 focus:outline-hidden focus:border-emerald-500 cursor-pointer disabled:opacity-60"
                data-testid="invitation-ttl-select"
              >
                {INVITATION_TTL_PRESETS_MS.map((preset) => (
                  <option key={preset.ttlMs} value={preset.ttlMs}>
                    {isAr ? preset.labelAr : preset.labelEn}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {isAr
                  ? 'نطاق خادمي معتمد بين 5 دقائق و14 يوماً.'
                  : 'Server-validated range between 5 minutes and 14 days.'}
              </p>
            </div>
          </div>

          {/* Read-Only Canonical Role Permissions Preview (No Custom Permission Selection) */}
          <div
            className="p-3.5 rounded-xl bg-gray-50 dark:bg-gray-850/60 border border-gray-200/70 dark:border-gray-800 space-y-2 min-w-0"
            data-testid="invitation-role-permissions-preview"
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs font-bold text-gray-800 dark:text-gray-200 inline-flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>
                  {isAr
                    ? `الصلاحيات المعيارية المرتبطة بدور ${getRoleLabel(intendedRole, true)} (${selectedRolePermissions.length} صلاحيات — للقراءة فقط)`
                    : `Canonical permissions for ${getRoleLabel(intendedRole, false)} (${selectedRolePermissions.length} permissions — Read-Only)`}
                </span>
              </span>
              <span className="text-[11px] text-gray-500 dark:text-gray-400 inline-flex items-center gap-1">
                <Lock className="w-3 h-3" />
                <span>
                  {isAr
                    ? 'الأدوار المعيارية فقط (لا توجد صلاحيات مخصصة)'
                    : 'Canonical roles only (no custom permissions)'}
                </span>
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px] text-gray-600 dark:text-gray-300">
              {selectedRolePermissions.map((perm) => (
                <span
                  key={perm}
                  className="px-2 py-0.5 rounded-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 font-medium"
                >
                  {getPermissionLabel(perm, isAr)}
                </span>
              ))}
            </div>
          </div>

          {/* Submit Action Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {isAr
                ? 'لا يُطلب ولا يُخزن أي كلمة مرور. لن يتم إرسال بريد إلكتروني أو تفعيل الحساب عند الحفظ.'
                : 'No password is requested or stored. Submitting does not send email or activate the account.'}
            </p>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full sm:w-auto px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl inline-flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-50 shrink-0 whitespace-nowrap"
              data-testid="submit-admin-invitation-btn"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span>
                    {isAr
                      ? 'جاري تسجيل الدعوة المعلقة...'
                      : 'Recording Pending Invitation...'}
                  </span>
                </>
              ) : (
                <>
                  <MailPlus className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {isAr
                      ? 'تسجيل دعوة إدارية معلقة'
                      : 'Create Pending Invitation'}
                  </span>
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

