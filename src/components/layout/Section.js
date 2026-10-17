"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Section = Section;
const react_1 = require("react");
function Section({ children, className = '', id }) {
    return (<section id={id} className={`py-6 sm:py-10 lg:py-12 w-full min-w-0 ${className}`}>
      {children}
    </section>);
}
//# sourceMappingURL=Section.js.map