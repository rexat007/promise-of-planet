"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Container = Container;
const react_1 = require("react");
function Container({ children, className = '' }) {
    return (<div className={`w-full max-w-7xl mx-auto px-3.5 sm:px-6 lg:px-8 min-w-0 ${className}`}>
      {children}
    </div>);
}
//# sourceMappingURL=Container.js.map