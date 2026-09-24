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

  return results;
}
