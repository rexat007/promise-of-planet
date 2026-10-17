"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppShell = AppShell;
const react_1 = require("react");
const ClimateClockSlot_1 = require("./ClimateClockSlot");
const Header_1 = require("./Header");
const Footer_1 = require("./Footer");
function AppShell({ children, onEnterAdmin, activePage, onNavigate }) {
    return (<div data-responsive-guard className="min-h-screen flex flex-col w-full max-w-full min-w-0 bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 transition-colors">
      {/* 1. Climate Clock in independent space before Header */}
      <ClimateClockSlot_1.ClimateClockSlot />

      {/* 2. Header */}
      <Header_1.Header onEnterAdmin={onEnterAdmin} activePage={activePage} onNavigate={onNavigate}/>

      {/* 3. Main Content with full-width structural safety */}
      <main className="flex-grow pop-page-fade w-full max-w-full min-w-0">
        {children}
      </main>

      {/* 4. Footer */}
      <Footer_1.Footer onNavigate={onNavigate}/>
    </div>);
}
//# sourceMappingURL=AppShell.js.map