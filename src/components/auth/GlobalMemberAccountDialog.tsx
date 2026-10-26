import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, UserCheck } from 'lucide-react';
import { AccountAuthWidget } from './AccountAuthWidget';
import {
  AdminInvitationAcceptancePanel,
  type AdminInvitationAcceptancePanelProps,
} from './AdminInvitationAcceptancePanel';

export interface GlobalMemberAccountDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onEnterAdmin?: () => void;
  isAr?: boolean;
  triggerId?: string;
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

export const GlobalMemberAccountDialog: React.FC<GlobalMemberAccountDialogProps> = ({
  isOpen,
  onClose,
  onEnterAdmin,
  isAr = false,
  triggerId = 'header-member-account-btn',
  invitationAcceptanceProps,
}) => {
  const dialogPanelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusedElementRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

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

  const dialogNode = (
    <div
      id="global-member-account-dialog"
      data-testid="global-member-account-dialog"
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
                className="text-sm sm:text-base font-extrabold leading-snug truncate"
              >
                {isAr ? 'حسابي / تسجيل الدخول' : 'My Account / Sign In'}
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

        {/* Dialog Body wrapping canonical AccountAuthWidget and Administrative Invitation Acceptance Panel */}
        <div className="p-4 sm:p-5 text-start">
          <AccountAuthWidget isAr={isAr} />
          <AdminInvitationAcceptancePanel
            isAr={isAr}
            onEnterAdmin={onEnterAdmin}
            {...invitationAcceptanceProps}
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
