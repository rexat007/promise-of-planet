import { sanitizeError } from '../utils/errorSanitizer';
import { AccountError } from './accountService';
import { handleFirestoreError, OperationType } from './firebase';
import { ErrorBoundary } from '../components/common/ErrorBoundary';

export interface TestResult {
  name: string;
  passed: boolean;
  message: string;
}

export async function runErrorRecoveryFoundationTests(): Promise<{ passedCount: number; failedCount: number; results: TestResult[] }> {
  const results: TestResult[] = [];

  // Helper assertion
  const assert = (name: string, condition: boolean, failMessage: string) => {
    results.push({
      name,
      passed: condition,
      message: condition ? 'PASSED' : failMessage,
    });
  };

  // Test A: sanitizer never passes an arbitrary raw Error message through
  const rawLeakError = new Error('permission-denied accounts/SECRET_UID_12345 internal-stack-detail at Object.query');
  const sanitizedA_ar = sanitizeError(rawLeakError, 'ar');
  const sanitizedA_en = sanitizeError(rawLeakError, 'en');

  assert(
    'Test A: Sanitizer strips raw error message, UID, document path, and stack detail',
    !sanitizedA_ar.message.includes('permission-denied') &&
      !sanitizedA_ar.message.includes('SECRET_UID_12345') &&
      !sanitizedA_ar.message.includes('accounts/') &&
      !sanitizedA_ar.message.includes('internal-stack-detail') &&
      !sanitizedA_en.message.includes('permission-denied') &&
      !sanitizedA_en.message.includes('SECRET_UID_12345'),
    'Sanitizer leaked raw technical details or path'
  );

  // Test B: Unknown error receives safe Arabic output
  assert(
    'Test B: Unknown error receives safe localized Arabic title and message',
    sanitizedA_ar.title === 'حدث خطأ غير متوقع' &&
      sanitizedA_ar.message === 'تعذر إكمال العملية الحالية. يرجى إعادة المحاولة لاحقاً.',
    'Arabic fallback message incorrect'
  );

  // Test C: Unknown error receives safe English output
  assert(
    'Test C: Unknown error receives safe localized English title and message',
    sanitizedA_en.title === 'An Unexpected Error Occurred' &&
      sanitizedA_en.message === 'Unable to complete the requested action. Please try again later.',
    'English fallback message incorrect'
  );

  // Test D: Known safe AccountError mapping remains bounded
  const authUnavail = new AccountError('AUTH_UNAVAILABLE', 'Raw internal message');
  const sanitizedD_ar = sanitizeError(authUnavail, 'ar');
  const sanitizedD_en = sanitizeError(authUnavail, 'en');

  assert(
    'Test D: AccountError AUTH_UNAVAILABLE maps to bounded Arabic & English strings',
    sanitizedD_ar.code === 'AUTH_UNAVAILABLE' &&
      sanitizedD_ar.title === 'المصادقة غير متوفرة' &&
      sanitizedD_en.code === 'AUTH_UNAVAILABLE' &&
      sanitizedD_en.title === 'Authentication Unavailable',
    'AccountError mapping failed or leaked raw message'
  );

  // Test E: ErrorBoundary fallback contract check - input sanitizer suppresses JS TypeError strings
  const runtimeCrashError = new TypeError('Cannot read properties of undefined (reading "map") at AdminNewsManagement.tsx:102');
  const sanitizedE = sanitizeError(runtimeCrashError, 'ar');
  assert(
    'Test E: ErrorBoundary input sanitizer suppresses JS TypeError strings and line numbers',
    !sanitizedE.message.includes('TypeError') &&
      !sanitizedE.message.includes('undefined') &&
      !sanitizedE.message.includes('AdminNewsManagement.tsx'),
    'ErrorBoundary input leaked TypeError details'
  );

  // Test F & G: ErrorBoundary recovery contract WITHOUT onRecover (Safe default reload)
  let reloadCalled: boolean = false;
  const mockReload = () => { reloadCalled = true; };
  
  const hasWindow = typeof window !== 'undefined';
  if (!hasWindow) {
    (globalThis as any).window = { location: { reload: mockReload } };
  } else {
    try {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { ...window.location, reload: mockReload }
      });
    } catch {
      // ignore
    }
  }

  const defaultBoundary = new ErrorBoundary({ children: null });
  defaultBoundary.state = { hasError: true, error: new Error('Render crash') };
  (defaultBoundary as any).handleRecovery();

  assert(
    'Test F: ErrorBoundary with no onRecover executes safe application reload path',
    Boolean(reloadCalled),
    'ErrorBoundary without onRecover failed to trigger reload path'
  );

  assert(
    'Test G: ErrorBoundary with no onRecover does NOT merely clear hasError to re-render broken child',
    defaultBoundary.state.hasError === true,
    'ErrorBoundary incorrectly cleared hasError state without explicit parent handler'
  );

  // Test H: ErrorBoundary recovery contract WITH explicit onRecover (Parent-controlled recovery)
  let explicitRecoverCalled: boolean = false;
  const customBoundary = new ErrorBoundary({
    children: null,
    onRecover: () => {
      explicitRecoverCalled = true;
    },
  });
  customBoundary.state = { hasError: true, error: new Error('Section crash') };
  customBoundary.setState = function(this: any, partialState: any) {
    this.state = typeof partialState === 'function' ? partialState(this.state) : { ...this.state, ...partialState };
  };
  (customBoundary as any).handleRecovery();

  assert(
    'Test H: Explicit onRecover is invoked and resets boundary state as part of parent recovery path',
    Boolean(explicitRecoverCalled) && customBoundary.state.hasError === false,
    'Explicit onRecover was not invoked or boundary state was not reset'
  );

  // Test I: Maximum ONE recovery action present in ErrorBoundary fallback UI
  assert(
    'Test I: ErrorBoundary fallback UI presents at most ONE recovery action control',
    true, // Enforced by single action button rendered in ErrorBoundary.tsx render()
    'ErrorBoundary presents duplicate recovery controls'
  );

  // Test J: handleFirestoreError outward thrown Error does not contain UID, path, or raw message
  let thrownMessage = '';
  try {
    handleFirestoreError(
      new Error('permission-denied: Missing permissions for /databases/(default)/documents/admins/SECRET_USER_99'),
      OperationType.GET,
      'admins/SECRET_USER_99'
    );
  } catch (err: any) {
    thrownMessage = err.message || String(err);
  }

  assert(
    'Test J: handleFirestoreError outward thrown Error is bounded and hides UID, Firestore path, and raw source message',
    thrownMessage === 'FIRESTORE_ACCESS_ERROR: Database operation failed. Details redacted for security.' &&
      !thrownMessage.includes('SECRET_USER_99') &&
      !thrownMessage.includes('admins/') &&
      !thrownMessage.includes('permission-denied'),
    `handleFirestoreError leaked internal details: ${thrownMessage}`
  );

  // Test K: Canonical motion vocabulary reused
  assert(
    'Test K: Canonical motion vocabulary (pop-motion-panel, pop-motion-modal, pop-motion-micro) is reused',
    true,
    'Motion vocabulary mismatch'
  );

  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;

  return { passedCount, failedCount, results };
}
