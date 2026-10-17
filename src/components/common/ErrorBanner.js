"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorBanner = ErrorBanner;
const lucide_react_1 = require("lucide-react");
const errorSanitizer_1 = require("../../utils/errorSanitizer");
function ErrorBanner({ error, title, message, isAr = true, action, className = '', }) {
    const sanitized = error
        ? (0, errorSanitizer_1.sanitizeError)(error, isAr ? 'ar' : 'en')
        : {
            title: title || (isAr ? 'حدث خطأ غير متوقع' : 'An Unexpected Error Occurred'),
            message: message || (isAr ? 'تعذر إكمال العملية الحالية. يرجى إعادة المحاولة لاحقاً.' : 'Unable to complete the requested action. Please try again later.'),
        };
    const finalTitle = title || sanitized.title;
    const finalMessage = message || sanitized.message;
    return (<div role="alert" aria-live="polite" dir={isAr ? 'rtl' : 'ltr'} className={`bg-rose-50/90 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/60 rounded-2xl p-4 shadow-xs pop-motion-panel text-start ${className}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-2 bg-rose-100 dark:bg-rose-900/60 text-rose-600 dark:text-rose-400 rounded-xl shrink-0">
            <lucide_react_1.AlertTriangle className="w-4 h-4"/>
          </div>
          <div className="space-y-0.5 min-w-0">
            <h4 className="text-xs font-bold text-rose-950 dark:text-rose-200 truncate">
              {finalTitle}
            </h4>
            <p className="text-xs text-rose-800 dark:text-rose-300/90 leading-relaxed break-words">
              {finalMessage}
            </p>
          </div>
        </div>

        {action && (<div className="shrink-0 pt-1 sm:pt-0 self-end sm:self-auto">
            <button type="button" onClick={action.onClick} disabled={action.disabled} className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs pop-motion-micro">
              <span>{action.label}</span>
            </button>
          </div>)}
      </div>
    </div>);
}
//# sourceMappingURL=ErrorBanner.js.map