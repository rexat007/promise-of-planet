"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.smoothScrollToSection = smoothScrollToSection;
function smoothScrollToSection(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
        });
    }
}
//# sourceMappingURL=interaction.js.map