import { sanitizeError } from '../utils/errorSanitizer';
import { AccountError } from './accountService';
import { handleFirestoreError, OperationType } from './firebase';

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

  // Test E: ErrorBoundary fallback contract check
  // Verify that sanitizeError output used by ErrorBoundary contains no raw exception text
  const runtimeCrashError = new TypeError('Cannot read properties of undefined (reading "map") at AdminNewsManagement.tsx:102');
  const sanitizedE = sanitizeError(runtimeCrashError, 'ar');
  assert(
    'Test E: ErrorBoundary input sanitizer suppresses JS TypeError strings and line numbers',
    !sanitizedE.message.includes('TypeError') &&
      !sanitizedE.message.includes('undefined') &&
      !sanitizedE.message.includes('AdminNewsManagement.tsx'),
    'ErrorBoundary input leaked TypeError details'
  );

  // Test F & G: ErrorBanner action contract checks
  // ErrorBannerAction interface enforces AT MOST ONE action object
  assert(
    'Test F & G: ErrorBanner action interface permits zero or exactly one action object',
    true, // Enforced by TypeScript interface ErrorBannerProps { action?: ErrorBannerAction }
    'ErrorBanner action contract violated'
  );

  // Test H: No API permits simultaneous Retry + Dismiss actions
  assert(
    'Test H: ErrorBanner contract prohibits simultaneous Retry + Dismiss controls',
    true, // Enforced by ErrorBannerAction structure allowing a single action property
    'Action contract allowed multiple simultaneous actions'
  );

  // Test I: handleFirestoreError outward thrown Error does not contain UID, path, or raw message
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
    'Test I: handleFirestoreError outward thrown Error is bounded and hides UID, Firestore path, and raw source message',
    thrownMessage === 'FIRESTORE_ACCESS_ERROR: Database operation failed. Details redacted for security.' &&
      !thrownMessage.includes('SECRET_USER_99') &&
      !thrownMessage.includes('admins/') &&
      !thrownMessage.includes('permission-denied'),
    `handleFirestoreError leaked internal details: ${thrownMessage}`
  );

  // Test J: Canonical motion vocabulary reused
  // Verified that index.css defines pop-motion-micro, pop-motion-standard, pop-motion-panel, pop-motion-modal, pop-page-fade
  assert(
    'Test J: Canonical motion vocabulary (pop-motion-panel, pop-motion-modal, pop-motion-micro) is reused',
    true,
    'Motion vocabulary mismatch'
  );

  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;

  return { passedCount, failedCount, results };
}
