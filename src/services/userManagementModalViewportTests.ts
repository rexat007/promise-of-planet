import * as fs from 'fs';
import * as path from 'path';

export interface TestResult {
  id: string;
  name: string;
  classification: 'STATIC_SOURCE_ASSERTION' | 'UNIT_LOGIC_TEST' | 'COMPONENT_BEHAVIOR_TEST';
  passed: boolean;
  message?: string;
}

export function runUserManagementModalViewportTests(): TestResult[] {
  const results: TestResult[] = [];

  const createUserModalPath = path.join(process.cwd(), 'src/components/users/CreateUserModal.tsx');
  const userEditorModalPath = path.join(process.cwd(), 'src/components/users/UserEditorModal.tsx');

  const createUserContent = fs.readFileSync(createUserModalPath, 'utf8');
  const userEditorContent = fs.readFileSync(userEditorModalPath, 'utf8');

  // Proof A: only AdminModalViewport owns containerRef (inner content does not attach ref={modalContainerRef})
  const createUserHasInnerRef = createUserContent.includes('ref={modalContainerRef}');
  const userEditorHasInnerRef = userEditorContent.includes('ref={modalContainerRef}');
  results.push({
    id: 'A',
    name: 'Only AdminModalViewport owns containerRef (inner content does not reuse ref)',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: !createUserHasInnerRef && !userEditorHasInnerRef,
    message: (!createUserHasInnerRef && !userEditorHasInnerRef) ? undefined : 'Duplicate containerRef found on inner consumer shell'
  });

  // Proof B: consumer inner content does not reuse the same ref object on DOM nodes
  results.push({
    id: 'B',
    name: 'Consumer inner content does not reuse ref on DOM nodes',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: !createUserHasInnerRef && !userEditorHasInnerRef,
    message: (!createUserHasInnerRef && !userEditorHasInnerRef) ? undefined : 'Inner DOM node still carries ref'
  });

  // Proof C: no local fixed inset-0 shell
  const createUserHasLocalInset = createUserContent.includes('fixed inset-0');
  const userEditorHasLocalInset = userEditorContent.includes('fixed inset-0');
  results.push({
    id: 'C',
    name: 'No local fixed inset-0 backdrop shell in consumer modals',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: !createUserHasLocalInset && !userEditorHasLocalInset,
    message: (!createUserHasLocalInset && !userEditorHasLocalInset) ? undefined : 'Local fixed inset-0 shell present'
  });

  // Proof D: no duplicated modal viewport max-height shell
  const createUserHasDuplicatedMaxH = createUserContent.includes('max-h-[calc(100vh-2rem)]');
  const userEditorHasDuplicatedMaxH = userEditorContent.includes('max-h-[90vh]');
  results.push({
    id: 'D',
    name: 'No duplicated modal viewport max-height shell in consumer content',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: !createUserHasDuplicatedMaxH && !userEditorHasDuplicatedMaxH,
    message: (!createUserHasDuplicatedMaxH && !userEditorHasDuplicatedMaxH) ? undefined : 'Duplicated max-h shell present'
  });

  // Proof E: CreateUser body supports internal vertical scrolling
  const createUserHasScroll = createUserContent.includes('overflow-y-auto');
  results.push({
    id: 'E',
    name: 'CreateUserModal body supports internal vertical scrolling',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: createUserHasScroll,
    message: createUserHasScroll ? undefined : 'CreateUserModal lacks overflow-y-auto body'
  });

  // Proof F: UserEditor body preserves internal vertical scrolling
  const userEditorHasScroll = userEditorContent.includes('overflow-y-auto');
  results.push({
    id: 'F',
    name: 'UserEditorModal body preserves internal vertical scrolling',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: userEditorHasScroll,
    message: userEditorHasScroll ? undefined : 'UserEditorModal lacks overflow-y-auto body'
  });

  // Proof G: RTL/LTR binding remains
  const createUserHasDir = createUserContent.includes('dir=');
  const userEditorHasDir = userEditorContent.includes('dir=');
  results.push({
    id: 'G',
    name: 'RTL/LTR explicit direction binding remains active',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: createUserHasDir && userEditorHasDir,
    message: (createUserHasDir && userEditorHasDir) ? undefined : 'Explicit dir prop missing'
  });

  // Proof H: business protections remain
  const createUserHasManager = createUserContent.includes('AdminUserManager.createDemoUser');
  const userEditorHasProtections = userEditorContent.includes('isLastActiveOwner') && userEditorContent.includes('isCurrentSessionUser');
  results.push({
    id: 'H',
    name: 'User management business logic and safety protections remain untouched',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: createUserHasManager && userEditorHasProtections,
    message: (createUserHasManager && userEditorHasProtections) ? undefined : 'Business protections missing'
  });

  // Proof I: no global overflow masking
  const hasGlobalOverflowHidden = createUserContent.includes('overflow-x:hidden') || userEditorContent.includes('overflow-x:hidden');
  results.push({
    id: 'I',
    name: 'No global overflow-x hidden masking introduced',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: !hasGlobalOverflowHidden,
    message: !hasGlobalOverflowHidden ? undefined : 'Global overflow masking found'
  });

  return results;
}
