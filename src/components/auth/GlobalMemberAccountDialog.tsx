import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  X,
  UserCheck,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Loader2,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import { AccountAuthWidget } from './AccountAuthWidget';
import {
  AdminInvitationAcceptancePanel,
  type AdminInvitationAcceptancePanelProps,
} from './AdminInvitationAcceptancePanel';
import {
  GLOBAL_MEMBER_ACCOUNT_LABELS,
  HeaderAuthSessionController,
  isAuthenticatedFirebaseSessionUser,
  type ObserveHeaderAuthStateFn,
} from '../layout/Header';
import { AccountService } from '../../services/accountService';
import {
  AdminIdentityService,
  AdminReadError,
  validateAdminUserData,
} from '../../services/adminIdentityService';
import { acceptAdminInvitation } from '../../services/adminIdentityManagementClient';
import type { AdminUser } from '../../types/admin';
import { getRoleLabel } from '../users/userFormatters';

export const GLOBAL_MEMBER_ADMIN_DASHBOARD_ACTION_LABELS = {
  ar: 'الانتقال إلى لوحة الإدارة',
  en: 'Open Admin Dashboard',
} as const;

export const GLOBAL_MEMBER_ADMIN_READ_ERROR_MESSAGES = {
  ar: 'تعذر التحقق من الصلاحيات الإدارية حالياً. يمكنك متابعة استخدام حسابك أو إعادة المحاولة.',
  en: 'Unable to verify administrative access right now. You can continue using your member account or retry.',
} as const;

export const GLOBAL_MEMBER_ADMIN_RETRY_LABELS = {
  ar: 'إعادة المحاولة',
  en: 'Retry',
} as const;

export type DialogAuthSessionState =
  | 'loading'
  | 'unauthenticated'
  | 'authenticated';

export type DialogAdminClassificationStatus =
  | 'idle'
  | 'resolving'
  | 'authorized'
  | 'non_admin'
  | 'error';

export type ResolveAdminForUidFn = (uid: string) => Promise<AdminUser | null>;

export interface DialogAdminClassificationSnapshot {
  readonly authState: DialogAuthSessionState;
  readonly firebaseUser: FirebaseUser | null;
  readonly adminStatus: DialogAdminClassificationStatus;
  readonly adminUser: AdminUser | null;
  readonly errorCode: 'ADMIN_READ_FAILURE' | null;
  readonly generation: number;
  readonly subscriptionCount: number;
}

export interface DialogAdminClassificationControllerOptions {
  readonly observeAuthState?: ObserveHeaderAuthStateFn;
  readonly resolveAdminForUid?: ResolveAdminForUidFn;
  readonly initialUser?: FirebaseUser | null;
  readonly initialIsAuthLoading?: boolean;
  readonly initialAdminStatus?: DialogAdminClassificationStatus;
  readonly initialAdminUser?: AdminUser | null;
  readonly initialErrorCode?: 'ADMIN_READ_FAILURE' | null;
}

export function getGlobalMemberDialogTitle(
  isAr: boolean,
  authState: DialogAuthSessionState
): string {
  if (authState === 'loading') {
    return isAr
      ? GLOBAL_MEMBER_ACCOUNT_LABELS.loading.ar
      : GLOBAL_MEMBER_ACCOUNT_LABELS.loading.en;
  }
  if (authState === 'authenticated') {
    return isAr
      ? GLOBAL_MEMBER_ACCOUNT_LABELS.signedIn.ar
      : GLOBAL_MEMBER_ACCOUNT_LABELS.signedIn.en;
  }
  return isAr
    ? GLOBAL_MEMBER_ACCOUNT_LABELS.signedOut.ar
    : GLOBAL_MEMBER_ACCOUNT_LABELS.signedOut.en;
}

export class DialogAdminClassificationController {
  private static sharedController: DialogAdminClassificationController | null =
    null;

  public static setSharedController(
    controller: DialogAdminClassificationController | null
  ): void {
    DialogAdminClassificationController.sharedController = controller;
  }

  public static getSharedController(): DialogAdminClassificationController | null {
    return DialogAdminClassificationController.sharedController;
  }

  private snapshot: DialogAdminClassificationSnapshot;
  private generation = 0;
  private expectedUid: string | null = null;
  private isDisposed = false;
  private activeUnsubscribe: (() => void) | null = null;
  private readonly observeAuthStateFn: ObserveHeaderAuthStateFn;
  private readonly resolveAdminFn: ResolveAdminForUidFn;
  private readonly listeners = new Set<
    (snapshot: DialogAdminClassificationSnapshot) => void
  >();

  constructor(options?: DialogAdminClassificationControllerOptions) {
    this.observeAuthStateFn =
      options?.observeAuthState ??
      ((callback) => AccountService.observeAuthState(callback));
    this.resolveAdminFn =
      options?.resolveAdminForUid ??
      ((uid) => AdminIdentityService.resolveAdminForAuthenticatedUid(uid));

    const hasExplicitLoading =
      options !== undefined && options.initialIsAuthLoading !== undefined;
    const hasExplicitUser =
      options !== undefined && options.initialUser !== undefined;

    const initialIsAuthLoading = hasExplicitLoading
      ? Boolean(options.initialIsAuthLoading)
      : !hasExplicitUser;

    const candidateUser = hasExplicitUser ? (options.initialUser ?? null) : null;
    const validatedUser =
      !initialIsAuthLoading && isAuthenticatedFirebaseSessionUser(candidateUser)
        ? candidateUser
        : null;

    const authState: DialogAuthSessionState = initialIsAuthLoading
      ? 'loading'
      : validatedUser
        ? 'authenticated'
        : 'unauthenticated';

    this.expectedUid = validatedUser ? validatedUser.uid.trim() : null;

    const validatedInitialAdmin =
      validatedUser &&
      options?.initialAdminUser &&
      options.initialAdminUser.id === validatedUser.uid.trim()
        ? validateAdminUserData(
            options.initialAdminUser,
            validatedUser.uid.trim()
          )
        : null;

    const activeInitialAdmin =
      validatedInitialAdmin && validatedInitialAdmin.isActive === true
        ? Object.freeze(validatedInitialAdmin)
        : null;

    let adminStatus: DialogAdminClassificationStatus = 'idle';
    if (authState === 'authenticated') {
      if (options?.initialAdminStatus) {
        adminStatus =
          options.initialAdminStatus === 'authorized' && !activeInitialAdmin
            ? 'non_admin'
            : options.initialAdminStatus;
      } else if (activeInitialAdmin) {
        adminStatus = 'authorized';
      } else {
        adminStatus = 'resolving';
      }
    }

    const errorCode: 'ADMIN_READ_FAILURE' | null =
      adminStatus === 'error'
        ? (options?.initialErrorCode ?? 'ADMIN_READ_FAILURE')
        : null;

    this.snapshot = Object.freeze({
      authState,
      firebaseUser: validatedUser,
      adminStatus,
      adminUser: adminStatus === 'authorized' ? activeInitialAdmin : null,
      errorCode,
      generation: 0,
      subscriptionCount: 0,
    });
  }

  public getSnapshot(): DialogAdminClassificationSnapshot {
    return this.snapshot;
  }

  public subscribe(
    listener: (snapshot: DialogAdminClassificationSnapshot) => void
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(next: DialogAdminClassificationSnapshot): void {
    if (this.isDisposed) {
      return;
    }
    this.snapshot = Object.freeze(next);
    this.listeners.forEach((listener) => listener(this.snapshot));
  }

  public async handleAuthEvent(
    user: FirebaseUser | null | undefined,
    customResolver?: ResolveAdminForUidFn
  ): Promise<DialogAdminClassificationSnapshot> {
    const currentGen = ++this.generation;

    if (this.isDisposed) {
      return this.snapshot;
    }

    const validUser = isAuthenticatedFirebaseSessionUser(user) ? user : null;

    if (!validUser) {
      this.expectedUid = null;
      this.emit({
        authState: 'unauthenticated',
        firebaseUser: null,
        adminStatus: 'idle',
        adminUser: null,
        errorCode: null,
        generation: currentGen,
        subscriptionCount: this.snapshot.subscriptionCount,
      });
      return this.snapshot;
    }

    const uid = validUser.uid.trim();
    this.expectedUid = uid;

    // Immediately clear any prior adminUser and start unresolved for this generation
    this.emit({
      authState: 'authenticated',
      firebaseUser: validUser,
      adminStatus: 'resolving',
      adminUser: null,
      errorCode: null,
      generation: currentGen,
      subscriptionCount: this.snapshot.subscriptionCount,
    });

    const resolver = customResolver ?? this.resolveAdminFn;

    try {
      const resolved = await resolver(uid);

      if (this.isDisposed) return this.snapshot;
      if (this.generation !== currentGen) return this.snapshot;
      if (this.expectedUid !== uid) return this.snapshot;

      const validatedAdmin =
        resolved && typeof resolved === 'object' && resolved.id === uid
          ? validateAdminUserData(resolved, uid)
          : null;

      if (
        validatedAdmin &&
        validatedAdmin.id === uid &&
        validatedAdmin.isActive === true
      ) {
        this.emit({
          authState: 'authenticated',
          firebaseUser: validUser,
          adminStatus: 'authorized',
          adminUser: Object.freeze(validatedAdmin),
          errorCode: null,
          generation: currentGen,
          subscriptionCount: this.snapshot.subscriptionCount,
        });
      } else {
        this.emit({
          authState: 'authenticated',
          firebaseUser: validUser,
          adminStatus: 'non_admin',
          adminUser: null,
          errorCode: null,
          generation: currentGen,
          subscriptionCount: this.snapshot.subscriptionCount,
        });
      }
    } catch (error: unknown) {
      if (this.isDisposed) return this.snapshot;
      if (this.generation !== currentGen) return this.snapshot;
      if (this.expectedUid !== uid) return this.snapshot;

      const isReadFailure =
        error instanceof AdminReadError ||
        Boolean(
          error &&
            typeof error === 'object' &&
            ((error as { name?: unknown }).name === 'AdminReadError' ||
              (error as { message?: unknown }).message === 'ADMIN_READ_FAILURE')
        );

      this.emit({
        authState: 'authenticated',
        firebaseUser: validUser,
        adminStatus: 'error',
        adminUser: null,
        errorCode: isReadFailure ? 'ADMIN_READ_FAILURE' : 'ADMIN_READ_FAILURE',
        generation: currentGen,
        subscriptionCount: this.snapshot.subscriptionCount,
      });
    }

    return this.snapshot;
  }

  public async recheckAdminEligibility(
    customResolver?: ResolveAdminForUidFn
  ): Promise<DialogAdminClassificationSnapshot> {
    if (this.isDisposed) {
      return this.snapshot;
    }
    const currentUser = this.snapshot.firebaseUser;
    if (
      this.snapshot.authState !== 'authenticated' ||
      !isAuthenticatedFirebaseSessionUser(currentUser)
    ) {
      return this.snapshot;
    }
    return await this.handleAuthEvent(currentUser, customResolver);
  }

  public mount(): () => void {
    if (!this.isDisposed && this.activeUnsubscribe !== null) {
      return () => {
        this.unmount();
      };
    }

    this.isDisposed = false;
    const nextSubscriptionCount = this.snapshot.subscriptionCount + 1;
    this.snapshot = Object.freeze({
      ...this.snapshot,
      subscriptionCount: nextSubscriptionCount,
    });

    const unsubscribe = this.observeAuthStateFn((user) => {
      if (this.isDisposed) {
        return;
      }
      void this.handleAuthEvent(user);
    });

    this.activeUnsubscribe =
      typeof unsubscribe === 'function' ? unsubscribe : () => {};

    return () => {
      this.unmount();
    };
  }

  public unmount(): void {
    this.isDisposed = true;
    this.generation += 1;
    if (this.activeUnsubscribe) {
      const unsub = this.activeUnsubscribe;
      this.activeUnsubscribe = null;
      unsub();
    }
  }
}

export function bindDialogAdminClassificationEffect(
  controller: DialogAdminClassificationController,
  onSnapshotChange: (snapshot: DialogAdminClassificationSnapshot) => void
): () => void {
  const unsubscribeState = controller.subscribe(onSnapshotChange);
  controller.mount();
  onSnapshotChange(controller.getSnapshot());
  return () => {
    unsubscribeState();
    controller.unmount();
  };
}

export function invokeAuthorizedDialogAdminNavigation(
  snapshot: DialogAdminClassificationSnapshot,
  onEnterAdmin?: () => void
): boolean {
  if (
    !snapshot ||
    snapshot.authState !== 'authenticated' ||
    snapshot.adminStatus !== 'authorized' ||
    !isAuthenticatedFirebaseSessionUser(snapshot.firebaseUser) ||
    !snapshot.adminUser ||
    snapshot.adminUser.id !== snapshot.firebaseUser.uid.trim() ||
    snapshot.adminUser.isActive !== true ||
    !validateAdminUserData(snapshot.adminUser, snapshot.firebaseUser.uid.trim()) ||
    typeof onEnterAdmin !== 'function'
  ) {
    return false;
  }

  onEnterAdmin();
  return true;
}

export interface GlobalMemberAccountDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onEnterAdmin?: () => void;
  isAr?: boolean;
  triggerId?: string;
  adminClassificationController?: DialogAdminClassificationController;
  invitationAcceptanceProps?: Omit<
    AdminInvitationAcceptancePanelProps,
    'isAr' | 'onEnterAdmin'
  >;
}

export const GLOBAL_MEMBER_DIALOG_FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogKeyboardTrapOptions {
  key: string;
  shiftKey?: boolean;
  focusableElements: Array<{ focus: () => void }>;
  activeElement: { focus: () => void } | null;
  onClose: () => void;
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

/**
 * Pure keyboard handler for GlobalMemberAccountDialog:
 * - Closes dialog on Escape without signing out.
 * - Traps Tab / Shift+Tab focus within the dialog's focusable controls.
 */
export function handleGlobalMemberDialogKeyDown(options: DialogKeyboardTrapOptions): boolean {
  const {
    key,
    shiftKey = false,
    focusableElements,
    activeElement,
    onClose,
    preventDefault,
    stopPropagation,
  } = options;

  if (key === 'Escape') {
    preventDefault?.();
    stopPropagation?.();
    onClose();
    return true;
  }

  if (key === 'Tab' && focusableElements.length > 0) {
    const firstEl = focusableElements[0];
    const lastEl = focusableElements[focusableElements.length - 1];
    const isInside = activeElement ? focusableElements.includes(activeElement) : false;

    if (shiftKey) {
      if (!activeElement || activeElement === firstEl || !isInside) {
        preventDefault?.();
        lastEl.focus();
        return true;
      }
    } else {
      if (!activeElement || activeElement === lastEl || !isInside) {
        preventDefault?.();
        firstEl.focus();
        return true;
      }
    }
  }

  return false;
}

/**
 * Resolves and focuses the return target when the dialog closes.
 */
export function restoreGlobalMemberDialogFocus(
  triggerElement: { focus: () => void } | null,
  previousFocusedElement: { focus: () => void } | null
): { focus: () => void } | null {
  const target = triggerElement || previousFocusedElement || null;
  if (target && typeof target.focus === 'function') {
    target.focus();
  }
  return target;
}

function deriveInitialDialogControllerOptions(
  invitationAcceptanceProps?: Omit<
    AdminInvitationAcceptancePanelProps,
    'isAr' | 'onEnterAdmin'
  >
): DialogAdminClassificationControllerOptions | undefined {
  const sharedHeaderController = HeaderAuthSessionController.getSharedController();
  if (sharedHeaderController) {
    const headerSnap = sharedHeaderController.getSnapshot();
    return {
      initialUser: headerSnap.firebaseUser,
      initialIsAuthLoading: headerSnap.isAuthLoading,
      initialAdminStatus: headerSnap.isSignedIn ? 'resolving' : 'idle',
    };
  }

  const initialAuthStatus = invitationAcceptanceProps?.initialAuthStatus;
  if (initialAuthStatus) {
    if (
      initialAuthStatus.authenticated &&
      typeof initialAuthStatus.uid === 'string' &&
      initialAuthStatus.uid.trim().length > 0
    ) {
      return {
        initialUser: {
          uid: initialAuthStatus.uid.trim(),
          email: initialAuthStatus.email ?? null,
          emailVerified: initialAuthStatus.emailVerified,
        } as unknown as FirebaseUser,
        initialIsAuthLoading: false,
        initialAdminStatus: 'non_admin',
      };
    }
    return {
      initialUser: null,
      initialIsAuthLoading: false,
      initialAdminStatus: 'idle',
    };
  }

  return undefined;
}

export const GlobalMemberAccountDialog: React.FC<GlobalMemberAccountDialogProps> = ({
  isOpen,
  onClose,
  onEnterAdmin,
  isAr = false,
  triggerId = 'header-member-account-btn',
  adminClassificationController,
  invitationAcceptanceProps,
}) => {
  const dialogPanelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusedElementRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  const controllerRef = useRef<DialogAdminClassificationController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current =
      adminClassificationController ??
      DialogAdminClassificationController.getSharedController() ??
      new DialogAdminClassificationController(
        deriveInitialDialogControllerOptions(invitationAcceptanceProps)
      );
  }

  const activeAdminController =
    adminClassificationController ??
    DialogAdminClassificationController.getSharedController() ??
    controllerRef.current;

  const [adminSnapshot, setAdminSnapshot] =
    useState<DialogAdminClassificationSnapshot>(() =>
      activeAdminController.getSnapshot()
    );

  const [hasAcceptedInvitationInSession, setHasAcceptedInvitationInSession] =
    useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) {
      setHasAcceptedInvitationInSession(false);
      return;
    }
    return bindDialogAdminClassificationEffect(
      activeAdminController,
      setAdminSnapshot
    );
  }, [isOpen, activeAdminController]);

  // Capture previously focused element when opening, focus close button, and restore focus on close
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      wasOpenRef.current = true;
      if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
        previousFocusedElementRef.current = document.activeElement;
      }
      const focusTimer = setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 0);
      return () => clearTimeout(focusTimer);
    }

    if (!isOpen && wasOpenRef.current) {
      wasOpenRef.current = false;
      const triggerEl =
        typeof document !== 'undefined' && triggerId
          ? document.getElementById(triggerId)
          : null;
      restoreGlobalMemberDialogFocus(
        triggerEl instanceof HTMLElement ? triggerEl : null,
        previousFocusedElementRef.current
      );
      previousFocusedElementRef.current = null;
    }
  }, [isOpen, triggerId]);

  // Keyboard navigation: Escape to close (without signing out) and Tab focus trap
  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const focusableNodes = dialogPanelRef.current
        ? Array.from(
            dialogPanelRef.current.querySelectorAll<HTMLElement>(
              GLOBAL_MEMBER_DIALOG_FOCUSABLE_SELECTOR
            )
          )
        : [];
      const activeEl =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;

      handleGlobalMemberDialogKeyDown({
        key: event.key,
        shiftKey: event.shiftKey,
        focusableElements: focusableNodes,
        activeElement: activeEl,
        onClose,
        preventDefault: () => event.preventDefault(),
        stopPropagation: () => event.stopPropagation(),
      });
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Lock document body scroll while dialog is open to avoid background scroll / nested scroll traps
  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;
    const originalBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalBodyOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  let currentSnapshot =
    adminClassificationController ||
    DialogAdminClassificationController.getSharedController()
      ? activeAdminController.getSnapshot()
      : adminSnapshot;

  // Synchronize auth state with shared HeaderAuthSessionController when present in SSR/shared tests
  const sharedHeaderController = HeaderAuthSessionController.getSharedController();
  if (
    !adminClassificationController &&
    !DialogAdminClassificationController.getSharedController() &&
    sharedHeaderController
  ) {
    const headerSnap = sharedHeaderController.getSnapshot();
    const derivedAuthState: DialogAuthSessionState = headerSnap.isAuthLoading
      ? 'loading'
      : headerSnap.isSignedIn
        ? 'authenticated'
        : 'unauthenticated';
    if (currentSnapshot.authState !== derivedAuthState) {
      currentSnapshot = Object.freeze({
        ...currentSnapshot,
        authState: derivedAuthState,
        firebaseUser: headerSnap.firebaseUser,
        adminStatus:
          derivedAuthState === 'authenticated'
            ? currentSnapshot.adminStatus === 'idle'
              ? 'resolving'
              : currentSnapshot.adminStatus
            : 'idle',
        adminUser:
          derivedAuthState === 'authenticated' ? currentSnapshot.adminUser : null,
      });
    }
  }

  const dialogTitle = getGlobalMemberDialogTitle(
    isAr,
    currentSnapshot.authState
  );

  const isInvitationPostAcceptanceState =
    hasAcceptedInvitationInSession ||
    invitationAcceptanceProps?.initialAcceptanceState?.status === 'succeeded';

  const isAuthorizedActiveAdmin =
    currentSnapshot.authState === 'authenticated' &&
    currentSnapshot.adminStatus === 'authorized' &&
    currentSnapshot.adminUser !== null &&
    currentSnapshot.adminUser.isActive === true &&
    isAuthenticatedFirebaseSessionUser(currentSnapshot.firebaseUser) &&
    currentSnapshot.adminUser.id === currentSnapshot.firebaseUser.uid.trim();

  const coordinatedInvitationAcceptanceProps: Omit<
    AdminInvitationAcceptancePanelProps,
    'isAr' | 'onEnterAdmin'
  > = {
    ...invitationAcceptanceProps,
    invokeAcceptInvitation: async (input) => {
      const invoker =
        invitationAcceptanceProps?.invokeAcceptInvitation ??
        ((req) =>
          acceptAdminInvitation(req, invitationAcceptanceProps?.clientDeps));
      const response = await invoker(input);
      setHasAcceptedInvitationInSession(true);
      await activeAdminController.recheckAdminEligibility();
      return response;
    },
  };

  const handleOpenAdminDashboardClick = () => {
    invokeAuthorizedDialogAdminNavigation(currentSnapshot, onEnterAdmin);
  };

  const handleRetryAdminLookupClick = () => {
    void activeAdminController.recheckAdminEligibility();
  };

  const dialogNode = (
    <div
      id="global-member-account-dialog"
      data-testid="global-member-account-dialog"
      data-auth-state={currentSnapshot.authState}
      data-admin-status={currentSnapshot.adminStatus}
      role="dialog"
      aria-modal="true"
      aria-labelledby="global-member-account-dialog-title"
      dir={isAr ? 'rtl' : 'ltr'}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-gray-950/70 backdrop-blur-xs pop-motion-panel"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogPanelRef}
        className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col min-w-0"
      >
        {/* Dialog Header */}
        <div className="px-5 py-4 bg-emerald-950 text-white border-b border-emerald-900 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-emerald-900/80 text-emerald-300 border border-emerald-800 shrink-0">
              <UserCheck className="w-4 h-4" />
            </div>
            <div className="min-w-0 text-start">
              <h2
                id="global-member-account-dialog-title"
                data-testid="global-member-account-dialog-title"
                className="text-sm sm:text-base font-extrabold leading-snug truncate"
              >
                {dialogTitle}
              </h2>
              <p className="text-[11px] text-emerald-300/90 truncate">
                {isAr
                  ? 'حساب العضو الموحد للتدريب وصحافة المواطن'
                  : 'Unified member account for Training & Citizen Journalism'}
              </p>
            </div>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            id="global-member-account-close-btn"
            data-testid="global-member-account-close-btn"
            aria-label={isAr ? 'إغلاق نافذة الحساب' : 'Close account dialog'}
            className="p-2 text-emerald-300 hover:text-white bg-emerald-900/60 hover:bg-emerald-800/80 rounded-full transition-colors shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Dialog Body wrapping canonical AccountAuthWidget, Server-Backed Admin Classification, and Administrative Invitation Acceptance Panel */}
        <div className="p-4 sm:p-5 text-start">
          <AccountAuthWidget isAr={isAr} />

          {/* 1. Admin Eligibility Resolving Indicator */}
          {currentSnapshot.authState === 'authenticated' &&
            currentSnapshot.adminStatus === 'resolving' && (
              <div
                className="mt-4 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/70 border border-gray-200 dark:border-gray-700 flex items-center gap-2.5 text-xs text-gray-600 dark:text-gray-300"
                data-testid="global-member-admin-resolving"
                aria-busy="true"
              >
                <Loader2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 animate-spin shrink-0" />
                <span>
                  {isAr
                    ? 'جاري التحقق من الصلاحيات الإدارية...'
                    : 'Checking administrative access...'}
                </span>
              </div>
            )}

          {/* 2. Server-Authorized Active Administrator Action */}
          {isAuthorizedActiveAdmin && currentSnapshot.adminUser && (
            <section
              className="mt-4 p-4 rounded-2xl bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/70 space-y-3 min-w-0"
              data-testid="global-member-admin-authorized-panel"
              aria-label={
                isAr
                  ? GLOBAL_MEMBER_ADMIN_DASHBOARD_ACTION_LABELS.ar
                  : GLOBAL_MEMBER_ADMIN_DASHBOARD_ACTION_LABELS.en
              }
            >
              <div className="flex items-start justify-between gap-2 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/70 text-emerald-700 dark:text-emerald-300 shrink-0">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p
                      className="text-xs font-extrabold text-emerald-950 dark:text-emerald-100 truncate"
                      data-testid="global-member-admin-role-badge"
                    >
                      {getRoleLabel(currentSnapshot.adminUser.role, isAr)} (
                      {currentSnapshot.adminUser.role})
                    </p>
                    <p className="text-[11px] text-emerald-800 dark:text-emerald-300/90 truncate">
                      {currentSnapshot.adminUser.email}
                    </p>
                  </div>
                </div>
              </div>

              {typeof onEnterAdmin === 'function' &&
                !isInvitationPostAcceptanceState && (
                  <button
                    type="button"
                    id="global-member-enter-admin-btn"
                    data-testid="global-member-enter-admin-btn"
                    onClick={handleOpenAdminDashboardClick}
                    className="w-full sm:w-auto px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl inline-flex items-center justify-center gap-2 cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-emerald-600"
                  >
                    <span>
                      {isAr
                        ? GLOBAL_MEMBER_ADMIN_DASHBOARD_ACTION_LABELS.ar
                        : GLOBAL_MEMBER_ADMIN_DASHBOARD_ACTION_LABELS.en}
                    </span>
                    {isAr ? (
                      <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
                    ) : (
                      <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                    )}
                  </button>
                )}
            </section>
          )}

          {/* 3. Admin Lookup Failure Notice (Distinguished from Confirmed Non-Admin, Fail-Closed) */}
          {currentSnapshot.authState === 'authenticated' &&
            currentSnapshot.adminStatus === 'error' && (
              <div
                className="mt-4 p-3.5 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 space-y-2.5 text-xs text-amber-900 dark:text-amber-200"
                role="status"
                data-testid="global-member-admin-error-banner"
                data-error-code={
                  currentSnapshot.errorCode ?? 'ADMIN_READ_FAILURE'
                }
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="font-semibold leading-relaxed">
                    {isAr
                      ? GLOBAL_MEMBER_ADMIN_READ_ERROR_MESSAGES.ar
                      : GLOBAL_MEMBER_ADMIN_READ_ERROR_MESSAGES.en}
                  </p>
                </div>
                <button
                  type="button"
                  id="global-member-admin-retry-btn"
                  data-testid="global-member-admin-retry-btn"
                  onClick={handleRetryAdminLookupClick}
                  className="w-full sm:w-auto px-3 py-1.5 bg-white dark:bg-gray-800 hover:bg-amber-100/60 dark:hover:bg-gray-700 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700 rounded-xl text-[11px] font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {isAr
                      ? GLOBAL_MEMBER_ADMIN_RETRY_LABELS.ar
                      : GLOBAL_MEMBER_ADMIN_RETRY_LABELS.en}
                  </span>
                </button>
              </div>
            )}

          <AdminInvitationAcceptancePanel
            isAr={isAr}
            onEnterAdmin={onEnterAdmin}
            {...coordinatedInvitationAcceptanceProps}
          />
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(dialogNode, document.body);
  }

  return dialogNode;
};

