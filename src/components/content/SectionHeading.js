"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SectionHeading = void 0;
const react_1 = require("react");
const SectionHeading = ({ title, subtitle, action, className = '', }) => {
    return (<div className={`flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-8 border-b border-gray-200/80 dark:border-gray-800/80 pb-4 ${className}`}>
      <div>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
          {title}
        </h2>
        {subtitle && (<p className="mt-1.5 text-sm sm:text-base text-gray-600 dark:text-gray-400">
            {subtitle}
          </p>)}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>);
};
exports.SectionHeading = SectionHeading;
//# sourceMappingURL=SectionHeading.js.map