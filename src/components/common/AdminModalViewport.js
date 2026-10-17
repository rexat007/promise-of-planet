"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminModalViewport = void 0;
const react_1 = require("react");
const react_dom_1 = require("react-dom");
// Module-level tracking for active modals to handle nested/stacked modals gracefully
let activeModalCount = 0;
let preservedBodyOverflow = '';
let preservedDocumentElementOverflow = '';
function acquireBodyScrollLock() {
    if (typeof document === 'undefined')
        return;
    if (activeModalCount === 0) {
        preservedBodyOverflow = document.body.style.overflow;
        preservedDocumentElementOverflow = document.documentElement.style.overflow;
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
    }
    activeModalCount++;
}
function releaseBodyScrollLock() {
    if (typeof document === 'undefined')
        return;
    activeModalCount = Math.max(0, activeModalCount - 1);
    if (activeModalCount === 0) {
        document.body.style.overflow = preservedBodyOverflow;
        document.documentElement.style.overflow = preservedDocumentElementOverflow;
    }
}
const SIZE_CLASSES = {
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
const AdminModalViewport = ({ isOpen, onClose, onEscape, titleId, descriptionId, size = 'editor', children, className = '', backdropClassName = '', containerRef: externalContainerRef, closeOnBackdropClick = false, closeOnEscape = true, 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledBy, 'aria-describedby': ariaDescribedBy, role = 'dialog', 'aria-modal': ariaModal = 'true', dir, }) => {
    const internalRef = (0, react_1.useRef)(null);
    const containerRef = externalContainerRef || internalRef;
    const previousActiveElement = (0, react_1.useRef)(null);
    // Scoped body scroll lock
    (0, react_1.useEffect)(() => {
        if (!isOpen)
            return;
        acquireBodyScrollLock();
        return () => {
            releaseBodyScrollLock();
        };
    }, [isOpen]);
    // Initial focus and focus restoration
    (0, react_1.useEffect)(() => {
        if (!isOpen)
            return;
        if (typeof document !== 'undefined' && document.activeElement) {
            previousActiveElement.current = document.activeElement;
        }
        const timer = setTimeout(() => {
            const container = containerRef.current;
            if (container) {
                const focusables = container.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])');
                if (focusables.length > 0) {
                    focusables[0].focus();
                }
                else {
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
    (0, react_1.useEffect)(() => {
        if (!isOpen)
            return;
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && closeOnEscape) {
                e.preventDefault();
                if (onEscape) {
                    onEscape();
                }
                else {
                    onClose();
                }
                return;
            }
            if (e.key === 'Tab') {
                const container = containerRef.current;
                if (!container)
                    return;
                const focusables = Array.from(container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((el) => {
                    if (el.disabled)
                        return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                });
                if (focusables.length === 0) {
                    e.preventDefault();
                    return;
                }
                const first = focusables[0];
                const last = focusables[focusables.length - 1];
                const active = document.activeElement;
                if (e.shiftKey) {
                    if (active === first || !focusables.includes(active)) {
                        last.focus();
                        e.preventDefault();
                    }
                }
                else {
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
    if (!isOpen)
        return null;
    if (typeof document === 'undefined')
        return null;
    const resolvedSizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.editor;
    const computedLabelledBy = ariaLabelledBy || titleId;
    const computedDescribedBy = ariaDescribedBy || descriptionId;
    const modalNode = (<div ref={containerRef} dir={dir} className={`fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 md:p-6 bg-black/60 backdrop-blur-xs overflow-y-auto ${backdropClassName}`} role={role} aria-modal={ariaModal} aria-labelledby={computedLabelledBy} aria-describedby={computedDescribedBy} aria-label={ariaLabel} tabIndex={-1} onClick={(e) => {
            if (closeOnBackdropClick && e.target === e.currentTarget) {
                if (onEscape)
                    onEscape();
                else
                    onClose();
            }
        }}>
      <div className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-2xl w-full ${resolvedSizeClass} max-h-[calc(100vh-1.5rem)] max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100vh-2rem)] sm:max-h-[calc(100dvh-2rem)] md:max-h-[calc(100vh-3rem)] md:max-h-[calc(100dvh-3rem)] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 ${className}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>);
    return (0, react_dom_1.createPortal)(modalNode, document.body);
};
exports.AdminModalViewport = AdminModalViewport;
//# sourceMappingURL=AdminModalViewport.js.map