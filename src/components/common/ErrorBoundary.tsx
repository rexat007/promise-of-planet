import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ShieldAlert, RefreshCw } from 'lucide-react';
import { sanitizeError } from '../../utils/errorSanitizer';

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onRecover?: () => void;
  recoveryLabel?: string;
  isAr?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: unknown | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Development diagnostic logging only; raw stack is NEVER rendered to UI
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
  }

  private handleRecovery = (): void => {
    if (this.props.onRecover) {
      this.props.onRecover();
      this.setState({ hasError: false, error: null });
    } else {
      window.location.reload();
    }
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      const isAr = this.props.isAr ?? true;
      const sanitized = sanitizeError(this.state.error, isAr ? 'ar' : 'en');

      const title = this.props.fallbackTitle || sanitized.title;
      const message = this.props.fallbackMessage || sanitized.message;
      const defaultBtnLabel = isAr ? 'إعادة تحميل التطبيق' : 'Reload Application';
      const actionLabel = this.props.recoveryLabel || defaultBtnLabel;

      return (
        <div
          role="alert"
          dir={isAr ? 'rtl' : 'ltr'}
          className="min-h-[320px] w-full flex items-center justify-center p-4 sm:p-6 bg-gray-50/50 dark:bg-gray-950/50 pop-page-fade"
        >
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-xl space-y-6 text-center pop-motion-modal">
            <div className="h-16 w-16 rounded-3xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto border border-rose-200 dark:border-rose-900">
              <ShieldAlert className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h3 className="text-base sm:text-lg font-extrabold text-gray-900 dark:text-white">
                {title}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed break-words">
                {message}
              </p>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={this.handleRecovery}
                className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs pop-motion-micro"
              >
                <RefreshCw className="w-4 h-4" />
                <span>{actionLabel}</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
