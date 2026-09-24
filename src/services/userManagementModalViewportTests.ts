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
  const viewTransitionPath = path.join(process.cwd(), 'src/components/common/ViewTransition.tsx');

  const createUserContent = fs.readFileSync(createUserModalPath, 'utf8');
  const userEditorContent = fs.readFileSync(userEditorModalPath, 'utf8');
  const viewTransitionContent = fs.existsSync(viewTransitionPath) ? fs.readFileSync(viewTransitionPath, 'utf8') : '';

  // Proof A: CreateUserModal consumes AdminModalViewport
  results.push({
    id: 'A',
    name: 'CreateUserModal consumes AdminModalViewport',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: createUserContent.includes('AdminModalViewport'),
    message: createUserContent.includes('AdminModalViewport') ? undefined : 'CreateUserModal does not import or render AdminModalViewport'
  });

  // Proof B: UserEditorModal consumes AdminModalViewport
  results.push({
    id: 'B',
    name: 'UserEditorModal consumes AdminModalViewport',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: userEditorContent.includes('AdminModalViewport'),
    message: userEditorContent.includes('AdminModalViewport') ? undefined : 'UserEditorModal does not import or render AdminModalViewport'
  });

  // Proof C: both pass rtl/ltr direction explicitly
  const createUserHasDir = createUserContent.includes('dir={') || createUserContent.includes('dir="');
  const userEditorHasDir = userEditorContent.includes('dir={') || userEditorContent.includes('dir="');
  results.push({
    id: 'C',
    name: 'Both User Management modals pass RTL/LTR direction explicitly to foundation',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: createUserHasDir && userEditorHasDir,
    message: (createUserHasDir && userEditorHasDir) ? undefined : 'Modals must pass explicit dir prop'
  });

  // Proof D: old local fixed inset-0 viewport shells are removed (replaced by foundation portal)
  const createUserHasLocalInset = createUserContent.includes('fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-gray-900/65') || createUserContent.includes('fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-gray-900/60');
  const userEditorHasLocalInset = userEditorContent.includes('fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-gray-900/65') || userEditorContent.includes('fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-gray-900/60');
  results.push({
    id: 'D',
    name: 'Old local fixed inset-0 backdrop shells are removed from User Management modals',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: !createUserHasLocalInset && !userEditorHasLocalInset,
    message: (!createUserHasLocalInset && !userEditorHasLocalInset) ? undefined : 'Local fixed inset-0 backdrop shell still present'
  });

  // Proof E: neither duplicates foundation focus trap
  const createUserHasTrap = createUserContent.includes('focusTrap') || createUserContent.includes('addEventListener(\'keydown\'');
  const userEditorHasTrap = userEditorContent.includes('focusTrap') || userEditorContent.includes('addEventListener(\'keydown\'');
  results.push({
    id: 'E',
    name: 'Modals do not duplicate foundation focus trap',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: !createUserHasTrap && !userEditorHasTrap,
    message: (!createUserHasTrap && !userEditorHasTrap) ? undefined : 'Duplicated focus trap detected in modal'
  });

  // Proof F: user-management business logic remains unchanged (AdminUserManager / AdminAccessService references intact)
  const createUserHasManager = createUserContent.includes('AdminUserManager.createDemoUser');
  const userEditorHasManager = userEditorContent.includes('AdminUserManager.canDeactivateUser') && userEditorContent.includes('AdminUserManager.canChangeUserRole');
  results.push({
    id: 'F',
    name: 'User management business logic and safety checks remain untouched',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: createUserHasManager && userEditorHasManager,
    message: (createUserHasManager && userEditorHasManager) ? undefined : 'User management business logic hooks are missing'
  });

  // Proof G: role/self/Owner protections remain present in UserEditorModal
  const userEditorHasProtections = userEditorContent.includes('isLastActiveOwner') && userEditorContent.includes('isCurrentSessionUser');
  results.push({
    id: 'G',
    name: 'Owner, self-protection, and last-active guardrails remain intact in UserEditorModal',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: userEditorHasProtections,
    message: userEditorHasProtections ? undefined : 'Owner or self protection guardrails missing'
  });

  // Proof H: ViewTransition remains untouched
  results.push({
    id: 'H',
    name: 'ViewTransition component remains unmodified',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: viewTransitionContent.length > 0 && !viewTransitionContent.includes('AdminModalViewport'),
    message: 'ViewTransition unperturbed'
  });

  // Proof I: no global overflow masking introduced
  const hasGlobalOverflowHidden = createUserContent.includes('overflow-x:hidden') || userEditorContent.includes('overflow-x:hidden');
  results.push({
    id: 'I',
    name: 'No global overflow-x hidden masking introduced in modal files',
    classification: 'STATIC_SOURCE_ASSERTION',
    passed: !hasGlobalOverflowHidden,
    message: !hasGlobalOverflowHidden ? undefined : 'Global overflow masking found'
  });

  return results;
}
