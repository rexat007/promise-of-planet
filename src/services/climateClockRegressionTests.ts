import * as fs from 'fs';
import * as path from 'path';

export interface TestResult {
  id: string;
  name: string;
  classification: 'STATIC_SOURCE_ASSERTION';
  passed: boolean;
  message?: string;
}

export function runClimateClockRegressionTests(): TestResult[] {
  const results: TestResult[] = [];

  const climateClockSlotPath = path.join(process.cwd(), 'src/components/layout/ClimateClockSlot.tsx');
  const appShellPath = path.join(process.cwd(), 'src/components/layout/AppShell.tsx');

  const clockCode = fs.readFileSync(climateClockSlotPath, 'utf8');
  const appShellCode = fs.readFileSync(appShellPath, 'utf8');

  // A. ClimateClockSlot does NOT monkeypatch document.getElementById
  const noMonkeypatch = !clockCode.includes('document.getElementById =') && !clockCode.includes('originalGetElementById');
  results.push({
    id: 'A',
    name: 'ClimateClockSlot does NOT monkeypatch document.getElementById',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: noMonkeypatch,
    message: noMonkeypatch ? undefined : 'Monkeypatch for document.getElementById found in ClimateClockSlot.tsx'
  });

  // B. official widget-v2.js URL remains
  const hasOfficialUrl = clockCode.includes('https://climateclock.world/widget-v2.js');
  results.push({
    id: 'B',
    name: 'Official widget-v2.js URL remains',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: hasOfficialUrl,
    message: hasOfficialUrl ? undefined : 'Official widget-v2.js URL missing'
  });

  // C. <climate-clock> remains
  const hasCustomElement = clockCode.includes('<climate-clock');
  results.push({
    id: 'C',
    name: '<climate-clock> custom element remains',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: hasCustomElement,
    message: hasCustomElement ? undefined : '<climate-clock> tag missing'
  });

  // D. climateClockEnabled conditional remains
  const hasEnabledConditional = clockCode.includes('climateClockEnabled') && clockCode.includes('isEnabled');
  results.push({
    id: 'D',
    name: 'climateClockEnabled conditional rendering remains',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: hasEnabledConditional,
    message: hasEnabledConditional ? undefined : 'climateClockEnabled conditional logic missing'
  });

  // E. AppShell still renders ClimateClockSlot before Header
  const clockIndex = appShellCode.indexOf('<ClimateClockSlot');
  const headerIndex = appShellCode.indexOf('<Header');
  const rendersBefore = clockIndex !== -1 && headerIndex !== -1 && clockIndex < headerIndex;
  results.push({
    id: 'E',
    name: 'AppShell still renders ClimateClockSlot before Header',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: rendersBefore,
    message: rendersBefore ? undefined : 'ClimateClockSlot is not rendered before Header in AppShell'
  });

  // F. no global overflow masking introduced
  const noGlobalOverflow = !clockCode.includes('overflow-x:hidden') && !appShellCode.includes('overflow-x:hidden');
  results.push({
    id: 'F',
    name: 'No global overflow-x hidden masking introduced',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: noGlobalOverflow,
    message: noGlobalOverflow ? undefined : 'Global overflow-x hidden masking found'
  });

  // G. AppShell is NOT re-keyed on public page changes (stable layout mounting)
  const appPath = path.join(process.cwd(), 'src/App.tsx');
  const appCode = fs.readFileSync(appPath, 'utf8');
  const appShellStable = !appCode.includes('<ViewTransition viewKey={isAdminOpen ? \'admin-workspace\' : activePage}>') &&
    appCode.includes('viewKey={isAdminOpen ? \'admin-workspace\' : \'public-app\'}');
  results.push({
    id: 'G',
    name: 'AppShell remains stably mounted across public tab navigation',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: appShellStable,
    message: appShellStable ? undefined : 'AppShell is still keyed to activePage causing remount on navigation'
  });

  // H. ViewTransition animates page content inside AppShell with viewKey=activePage
  const viewTransitionInsideAppShell = appCode.includes('<AppShell') &&
    appCode.includes('<ViewTransition viewKey={activePage}>');
  results.push({
    id: 'H',
    name: 'ViewTransition animates page content inside AppShell with activePage',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: viewTransitionInsideAppShell,
    message: viewTransitionInsideAppShell ? undefined : 'ViewTransition with viewKey={activePage} not found inside AppShell'
  });

  return results;
}
