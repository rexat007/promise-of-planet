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
  const adminUsersManagementPath = path.join(process.cwd(), 'src/components/users/AdminUsersManagement.tsx');

  const createUserContent = fs.readFileSync(createUserModalPath, 'utf8');
  const userEditorContent = fs.readFileSync(userEditorModalPath, 'utf8');
  const adminUsersManagementContent = fs.readFileSync(adminUsersManagementPath, 'utf8');

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
  const hasGlobalOverflowHidden =
    createUserContent.includes('overflow-x:hidden') ||
    userEditorContent.includes('overflow-x:hidden') ||
    adminUsersManagementContent.includes('overflow-x:hidden');
  results.push({
    id: 'I',
    name: 'No global overflow-x hidden masking introduced',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: !hasGlobalOverflowHidden,
    message: !hasGlobalOverflowHidden ? undefined : 'Global overflow masking found'
  });

  // Proof J: Administrative Account Lifecycle modal renders via createPortal(..., document.body)
  const lifecycleUsesPortal =
    adminUsersManagementContent.includes("import { createPortal } from 'react-dom'") &&
    adminUsersManagementContent.includes('createPortal(lifecycleModalNode, document.body)');
  results.push({
    id: 'J',
    name: 'Administrative Account Lifecycle modal portals to document.body outside transformed ancestors',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: lifecycleUsesPortal,
    message: lifecycleUsesPortal ? undefined : 'createPortal(lifecycleModalNode, document.body) missing'
  });

  // Proof K: Lifecycle modal dialog shell uses viewport-bounded sizing (max-h-[90vh] max-h-[90dvh] flex flex-col overflow-hidden) with pinned header and footer
  const lifecycleHasViewportShell =
    adminUsersManagementContent.includes('max-h-[90vh] max-h-[90dvh]') &&
    adminUsersManagementContent.includes('data-testid="admin-lifecycle-modal-dialog"') &&
    adminUsersManagementContent.includes('data-testid="admin-lifecycle-modal-header"') &&
    adminUsersManagementContent.includes('data-testid="admin-lifecycle-modal-footer"');
  results.push({
    id: 'K',
    name: 'Lifecycle modal uses viewport-bounded flex-col shell (90vh/90dvh) with pinned header and footer',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: lifecycleHasViewportShell,
    message: lifecycleHasViewportShell ? undefined : 'Lifecycle modal viewport shell or pinned header/footer missing'
  });

  // Proof L: Lifecycle modal body supports internal vertical scrolling without nested scrollbars
  const lifecycleHasScrollBody =
    adminUsersManagementContent.includes('data-testid="admin-lifecycle-modal-body"') &&
    adminUsersManagementContent.includes('flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain');
  results.push({
    id: 'L',
    name: 'Lifecycle modal body is a single deliberate vertical scroll container',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: lifecycleHasScrollBody,
    message: lifecycleHasScrollBody ? undefined : 'Lifecycle modal scrollable body missing'
  });

  // Proof M: Portaled lifecycle modal preserves explicit RTL/LTR binding and dialog accessibility attributes
  const lifecycleHasA11yAndDir =
    adminUsersManagementContent.includes("dir={isAr ? 'rtl' : 'ltr'}") &&
    adminUsersManagementContent.includes('role="dialog"') &&
    adminUsersManagementContent.includes('aria-modal="true"') &&
    adminUsersManagementContent.includes('aria-labelledby="lifecycle-modal-title"');
  results.push({
    id: 'M',
    name: 'Portaled lifecycle modal preserves RTL/LTR direction and ARIA dialog attributes',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: lifecycleHasA11yAndDir,
    message: lifecycleHasA11yAndDir ? undefined : 'RTL/LTR dir or ARIA dialog attributes missing on portaled lifecycle modal'
  });

  // Proof N: Lifecycle modal locks background body scroll while open and restores on close/unmount
  const lifecycleLocksBodyScroll =
    adminUsersManagementContent.includes('const previousBodyOverflow = document.body.style.overflow;') &&
    adminUsersManagementContent.includes("document.body.style.overflow = 'hidden';") &&
    adminUsersManagementContent.includes('document.body.style.overflow = previousBodyOverflow;');
  results.push({
    id: 'N',
    name: 'Lifecycle modal locks background document.body scroll and restores previous overflow on close/unmount',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: lifecycleLocksBodyScroll,
    message: lifecycleLocksBodyScroll ? undefined : 'Scoped body scroll lock/restore missing in AdminUsersManagement'
  });

  // Proof O: Lifecycle modal Escape-to-close respects active submission lock and preserves all 4 operations
  const lifecyclePreservesLocksAndOps =
    adminUsersManagementContent.includes("if (event.key === 'Escape')") &&
    adminUsersManagementContent.includes("initControllerRef.current?.getSnapshot().status === 'submitting'") &&
    adminUsersManagementContent.includes('InitializeRevision') &&
    adminUsersManagementContent.includes('ChangeRole') &&
    adminUsersManagementContent.includes('Deactivate') &&
    adminUsersManagementContent.includes('Reactivate');
  results.push({
    id: 'O',
    name: 'Lifecycle modal Escape handler respects active submission lock and preserves all 4 lifecycle operations',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: lifecyclePreservesLocksAndOps,
    message: lifecyclePreservesLocksAndOps ? undefined : 'Escape submission lock or lifecycle operations missing'
  });

  return results;
}
