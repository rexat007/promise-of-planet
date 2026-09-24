import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export type AdminModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full' | 'confirm' | 'standard' | 'editor' | 'wide';

export interface AdminModalViewportProps {
  isOpen: boolean;
  onClose: () => void;
  onEscape?: () => void;
  titleId?: string;
  descriptionId?: string;
  size?: AdminModalSize;
  children: React.ReactNode;
  className?: string;
  backdropClassName?: string;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  closeOnBackdropClick?: boolean;
  closeOnEscape?: boolean;
  dir?: 'rtl' | 'ltr';
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  role?: string;
  'aria-modal'?: boolean | 'true' | 'false';
}

// Module-level tracking for active modals to handle nested/stacked modals gracefully
let activeModalCount = 0;
let preservedBodyOverflow = '';

function acquireBodyScrollLock(): void {
  if (typeof document === 'undefined') return;
  if (activeModalCount === 0) {
    preservedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  activeModalCount++;
}

function releaseBodyScrollLock(): void {
  if (typeof document === 'undefined') return;
  activeModalCount = Math.max(0, activeModalCount - 1);
  if (activeModalCount === 0) {
    document.body.style.overflow = preservedBodyOverflow;
  }
}

const SIZE_CLASSES: Record<AdminModalSize, string> = {
  sm: 'max-w-md',
  confirm: 'max-w-md',
  md: 'max-w-xl',
  standard: 'max-w-xl',
  lg: 'max-w-4xl',
  editor: 'max-w-4xl',
  xl: 'max-w-6xl',
  wide: 'max-w-6xl',
  full: 'max-w-7xl w-[calc(100vw-1.5rem)] sm:w-[calc(100vw-2rem)] md:w-[calc(100vw-3rem)]',
};

export const AdminModalViewport: React.FC<AdminModalViewportProps> = ({
  isOpen,
  onClose,
  onEscape,
  titleId,
  descriptionId,
  size = 'editor',
  children,
  className = '',
  backdropClassName = '',
  containerRef: externalContainerRef,
  closeOnBackdropClick = false,
  closeOnEscape = true,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  role = 'dialog',
  'aria-modal': ariaModal = 'true',
  dir,
}) => {
  const internalRef = useRef<HTMLDivElement>(null);
  const containerRef = externalContainerRef || internalRef;
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // Scoped body scroll lock
  useEffect(() => {
    if (!isOpen) return;

    acquireBodyScrollLock();
    return () => {
      releaseBodyScrollLock();
    };
  }, [isOpen]);

  // Initial focus and focus restoration
  useEffect(() => {
    if (!isOpen) return;

    if (typeof document !== 'undefined' && document.activeElement) {
      previousActiveElement.current = document.activeElement as HTMLElement;
    }

    const timer = setTimeout(() => {
      const container = containerRef.current;
      if (container) {
        const focusables = container.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'
        );
        if (focusables.length > 0) {
          focusables[0].focus();
        } else {
          container.focus();
        }
      }
    }, 30);

    return () => {
      clearTimeout(timer);
      if (previousActiveElement.current && typeof previousActiveElement.current.focus === 'function') {
        previousActiveElement.current.focus();
        previousActiveElement.current = null;
      }
    };
  }, [isOpen, containerRef]);

  // Focus trap and Escape key routing
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEscape) {
        e.preventDefault();
        if (onEscape) {
          onEscape();
        } else {
          onClose();
        }
        return;
      }

      if (e.key === 'Tab') {
        const container = containerRef.current;
        if (!container) return;

        const focusables = Array.from(
          container.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => {
          if ((el as HTMLButtonElement | HTMLInputElement).disabled) return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });

        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement;

        if (e.shiftKey) {
          if (active === first || !focusables.includes(active)) {
            last.focus();
            e.preventDefault();
          }
        } else {
          if (active === last || !focusables.includes(active)) {
            first.focus();
            e.preventDefault();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen, closeOnEscape, onEscape, onClose, containerRef]);

  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;

  const resolvedSizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.editor;
  const computedLabelledBy = ariaLabelledBy || titleId;
  const computedDescribedBy = ariaDescribedBy || descriptionId;

  const modalNode = (
    <div
      ref={containerRef}
      dir={dir}
      className={`fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 md:p-6 bg-black/60 backdrop-blur-xs overflow-y-auto ${backdropClassName}`}
      role={role}
      aria-modal={ariaModal}
      aria-labelledby={computedLabelledBy}
      aria-describedby={computedDescribedBy}
      aria-label={ariaLabel}
      tabIndex={-1}
      onClick={(e) => {
        if (closeOnBackdropClick && e.target === e.currentTarget) {
          if (onEscape) onEscape();
          else onClose();
        }
      }}
    >
      <div
        className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-2xl w-full ${resolvedSizeClass} max-h-[calc(100vh-1.5rem)] max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100vh-2rem)] sm:max-h-[calc(100dvh-2rem)] md:max-h-[calc(100vh-3rem)] md:max-h-[calc(100dvh-3rem)] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );

  return createPortal(modalNode, document.body);
};
