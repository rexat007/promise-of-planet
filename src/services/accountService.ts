import { 
  signInWithEmailAndPassword as realSignIn,
  createUserWithEmailAndPassword as realCreateUser,
  sendPasswordResetEmail as realSendPasswordResetEmail,
  sendEmailVerification as realSendEmailVerification,
  reload as realReloadUser,
  signOut as realSignOut,
  onAuthStateChanged as realOnAuthStateChanged
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, getDoc, runTransaction } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from './firebase';
import type { Account } from '../types/account';

export type AccountErrorType = 
  | 'AUTH_UNAVAILABLE'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_ALREADY_EXISTS'
  | 'ACCOUNT_DATA_INVALID'
  | 'ACCOUNT_PROVISIONING_FAILED'
  | 'REGISTRATION_WEAK_PASSWORD'
  | 'REGISTRATION_RATE_LIMITED'
  | 'REGISTRATION_NETWORK_ERROR'
  | 'PASSWORD_RESET_RATE_LIMITED'
  | 'PASSWORD_RESET_NETWORK_ERROR'
  | 'EMAIL_VERIFICATION_RATE_LIMITED'
  | 'EMAIL_VERIFICATION_NETWORK_ERROR'
  | 'EMAIL_VERIFICATION_SESSION_EXPIRED';

export const NEUTRAL_PASSWORD_RESET_MESSAGES = {
  ar: 'إذا كان هذا البريد الإلكتروني مرتبطاً بحساب، فسيتم إرسال تعليمات إعادة تعيين كلمة المرور إليه.',
  en: 'If an account is associated with this email address, password reset instructions have been sent.',
} as const;

export const EMAIL_VERIFICATION_SENT_MESSAGES = {
  ar: 'تم إرسال رسالة التحقق إلى البريد الإلكتروني المرتبط بحسابك الحالي. يرجى مراجعة صندوق الوارد.',
  en: 'A verification email has been sent to the email address for your current session. Please check your inbox.',
} as const;

export const EMAIL_ALREADY_VERIFIED_MESSAGES = {
  ar: 'البريد الإلكتروني مؤكد بالفعل.',
  en: 'Your email address is already verified.',
} as const;

export const EMAIL_VERIFICATION_REFRESH_MESSAGES = {
  verified: {
    ar: 'تم تأكيد البريد الإلكتروني بنجاح.',
    en: 'Your email address has been verified.',
  },
  unverified: {
    ar: 'لم يتم تأكيد البريد الإلكتروني بعد. يرجى النقر على رابط التحقق في بريدك الإلكتروني ثم تحديث الحالة.',
    en: 'Your email address is not verified yet. Please click the verification link in your email and refresh again.',
  },
} as const;

export interface PasswordResetRequestResult {
  status: 'sent';
  email: string;
  messageAr: string;
  messageEn: string;
}

export interface EmailVerificationStatusResult {
  authenticated: boolean;
  uid: string | null;
  email: string | null;
  emailVerified: boolean;
}

export type EmailVerificationSendStatus = 'sent' | 'already_verified';

export interface SendEmailVerificationResult {
  status: EmailVerificationSendStatus;
  uid: string;
  emailVerified: boolean;
  messageAr: string;
  messageEn: string;
}

export interface RefreshEmailVerificationResult {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  messageAr: string;
  messageEn: string;
}

export class AccountError extends Error {
  code: AccountErrorType;

  constructor(code: AccountErrorType, message: string) {
    super(message);
    this.name = 'AccountError';
    this.code = code;
  }
}

/**
 * Validates runtime Account data against canonical 5-field schema.
 * Throws AccountError('ACCOUNT_DATA_INVALID') if data is malformed or contains non-canonical fields.
 */
export function validateAccountData(data: any, expectedUid?: string): Account {
  if (!data || typeof data !== 'object') {
    throw new AccountError('ACCOUNT_DATA_INVALID', 'Account document data is missing or invalid.');
  }

  const keys = Object.keys(data);
  const allowed = ['id', 'email', 'displayName', 'createdAt', 'updatedAt'];
  const forbidden = keys.filter(k => !allowed.includes(k));
  if (forbidden.length > 0) {
    throw new AccountError('ACCOUNT_DATA_INVALID', `Account document contains non-canonical or forbidden fields: ${forbidden.join(', ')}`);
  }

  const { id, email, displayName, createdAt, updatedAt } = data;

  if (typeof id !== 'string' || id.trim() === '') {
    throw new AccountError('ACCOUNT_DATA_INVALID', 'Account id must be a non-empty string.');
  }

  if (expectedUid && id !== expectedUid) {
    throw new AccountError('ACCOUNT_DATA_INVALID', `Account id '${id}' does not match expected UID '${expectedUid}'.`);
  }

  if (typeof email !== 'string' || email.trim() === '' || !email.includes('@')) {
    throw new AccountError('ACCOUNT_DATA_INVALID', 'Account email must be a non-empty valid email string.');
  }

  if (typeof displayName !== 'string') {
    throw new AccountError('ACCOUNT_DATA_INVALID', 'Account displayName must be a string.');
  }

  if (typeof createdAt !== 'string' || createdAt.trim() === '' || isNaN(Date.parse(createdAt))) {
    throw new AccountError('ACCOUNT_DATA_INVALID', 'Account createdAt must be a valid ISO date string.');
  }

  if (typeof updatedAt !== 'string' || updatedAt.trim() === '' || isNaN(Date.parse(updatedAt))) {
    throw new AccountError('ACCOUNT_DATA_INVALID', 'Account updatedAt must be a valid ISO date string.');
  }

  return {
    id,
    email: email.trim().toLowerCase(),
    displayName: displayName.trim(),
    createdAt,
    updatedAt
  };
}

/**
 * Validates that an account update payload contains strictly a non-empty displayName
 * and no privileged, identity, or immutable fields.
 */
export function validateAccountDisplayNameUpdate(
  data: unknown
): { displayName: string } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new AccountError(
      'ACCOUNT_DATA_INVALID',
      'Account update payload must be a valid object.'
    );
  }

  const keys = Object.keys(data as Record<string, unknown>);
  const forbidden = keys.filter((k) => k !== 'displayName');
  if (forbidden.length > 0) {
    throw new AccountError(
      'ACCOUNT_DATA_INVALID',
      `Account update contains forbidden or immutable fields: ${forbidden.join(', ')}`
    );
  }

  const rawDisplayName = (data as { displayName?: unknown }).displayName;
  if (typeof rawDisplayName !== 'string' || rawDisplayName.trim() === '') {
    throw new AccountError(
      'ACCOUNT_DATA_INVALID',
      'Account displayName must be a non-empty string.'
    );
  }

  return {
    displayName: rawDisplayName.trim(),
  };
}

export interface AccountRepository {
  getAccount(uid: string): Promise<Account | null>;
  createAccount(account: Account): Promise<Account>;
  updateAccount(uid: string, data: Partial<Pick<Account, 'displayName'>>): Promise<Account>;
}

/**
 * Production Durable Account Repository backed strictly by Firestore accounts/{uid}.
 * Does NOT fall back to in-memory storage when Firebase is unconfigured.
 */
export class FirestoreAccountRepository implements AccountRepository {
  protected isConfigured(): boolean {
    return isFirebaseConfigured && !!db;
  }

  protected async fetchDoc(uid: string): Promise<any> {
    const docRef = doc(db, 'accounts', uid);
    return await getDoc(docRef);
  }

  protected async runTx(updateFunction: (transaction: any) => Promise<any>): Promise<any> {
    return await runTransaction(db, updateFunction);
  }

  async getAccount(uid: string): Promise<Account | null> {
    if (!uid || typeof uid !== 'string') {
      return null;
    }

    if (!this.isConfigured()) {
      throw new AccountError('AUTH_UNAVAILABLE', 'Authentication backend is unconfigured or unavailable.');
    }

    try {
      const snapshot = await this.fetchDoc(uid);
      if (!snapshot || !snapshot.exists()) {
        return null;
      }
      return validateAccountData(snapshot.data(), uid);
    } catch (error: any) {
      if (error instanceof AccountError) {
        throw error;
      }
      console.error('Firestore getAccount error:', error);
      throw new AccountError('ACCOUNT_DATA_INVALID', 'Unable to read account profile.');
    }
  }

  async createAccount(account: Account): Promise<Account> {
    if (!this.isConfigured()) {
      throw new AccountError('AUTH_UNAVAILABLE', 'Authentication backend is unconfigured or unavailable.');
    }

    const validated = validateAccountData(account, account.id);

    try {
      await this.runTx(async (transaction) => {
        const docRef = doc(db, 'accounts', validated.id);
        const snapshot = await transaction.get(docRef);
        if (snapshot.exists()) {
          throw new AccountError('ACCOUNT_ALREADY_EXISTS', `Account record already exists for UID: ${validated.id}`);
        }
        transaction.set(docRef, validated);
      });
      return validated;
    } catch (error: any) {
      if (error instanceof AccountError) {
        throw error;
      }
      console.error('Firestore createAccount error:', error);
      throw new AccountError('ACCOUNT_PROVISIONING_FAILED', 'Unable to provision account profile.');
    }
  }

  async updateAccount(uid: string, data: Partial<Pick<Account, 'displayName'>>): Promise<Account> {
    if (!this.isConfigured()) {
      throw new AccountError('AUTH_UNAVAILABLE', 'Authentication backend is unconfigured or unavailable.');
    }

    if (!uid || typeof uid !== 'string' || uid.trim() === '') {
      throw new AccountError('ACCOUNT_DATA_INVALID', 'UID is required to update account.');
    }

    const validatedPatch = validateAccountDisplayNameUpdate(data);

    try {
      return await this.runTx(async (transaction) => {
        const docRef = doc(db, 'accounts', uid);
        const snapshot = await transaction.get(docRef);
        if (!snapshot.exists()) {
          throw new AccountError('ACCOUNT_NOT_FOUND', `Account not found for UID: ${uid}`);
        }

        const existing = validateAccountData(snapshot.data(), uid);
        const updated: Account = {
          id: existing.id,
          email: existing.email,
          displayName: validatedPatch.displayName,
          createdAt: existing.createdAt,
          updatedAt: new Date().toISOString()
        };

        const validatedUpdated = validateAccountData(updated, uid);
        transaction.set(docRef, validatedUpdated);
        return validatedUpdated;
      });
    } catch (error: any) {
      if (error instanceof AccountError) {
        throw error;
      }
      console.error('Firestore updateAccount error:', error);
      throw new AccountError('ACCOUNT_DATA_INVALID', 'Unable to update account profile.');
    }
  }
}

/**
 * Isolated In-Memory Account Repository for testing only.
 * Must be explicitly injected and is NEVER automatically selected by production AccountService.
 */
export class InMemoryAccountRepository implements AccountRepository {
  private accounts = new Map<string, Account>();

  async getAccount(uid: string): Promise<Account | null> {
    if (!uid) return null;
    const raw = this.accounts.get(uid);
    if (!raw) return null;
    return validateAccountData(raw, uid);
  }

  async createAccount(account: Account): Promise<Account> {
    const validated = validateAccountData(account, account.id);
    if (this.accounts.has(validated.id)) {
      throw new AccountError('ACCOUNT_ALREADY_EXISTS', `Account record already exists for UID: ${validated.id}`);
    }
    this.accounts.set(validated.id, validated);
    return validated;
  }

  async updateAccount(uid: string, data: Partial<Pick<Account, 'displayName'>>): Promise<Account> {
    if (!uid || typeof uid !== 'string' || uid.trim() === '') {
      throw new AccountError('ACCOUNT_DATA_INVALID', 'UID is required to update account.');
    }
    const validatedPatch = validateAccountDisplayNameUpdate(data);
    const existing = this.accounts.get(uid);
    if (!existing) {
      throw new AccountError('ACCOUNT_NOT_FOUND', `Account not found for UID: ${uid}`);
    }
    const validatedExisting = validateAccountData(existing, uid);
    const updated: Account = {
      id: validatedExisting.id,
      email: validatedExisting.email,
      displayName: validatedPatch.displayName,
      createdAt: validatedExisting.createdAt,
      updatedAt: new Date().toISOString()
    };
    const validatedUpdated = validateAccountData(updated, uid);
    this.accounts.set(uid, validatedUpdated);
    return validatedUpdated;
  }

  seed(rawAccount: any) {
    this.accounts.set(rawAccount.id, rawAccount);
  }

  clear() {
    this.accounts.clear();
  }
}

export type AccountRecoveryStatus =
  | 'already_provisioned'
  | 'recovered'
  | 'unauthenticated'
  | 'recoverable_failure';

export interface AccountRecoveryResult {
  status: AccountRecoveryStatus;
  account: Account | null;
  recoverable: boolean;
  error: {
    code: AccountErrorType;
    message: string;
  } | null;
}

export interface RecoverAccountOptions {
  displayName?: string;
}

interface InFlightRegistrationEntry {
  displayName?: string;
  promise: Promise<{ user: User | null; account: Account | null; error?: string }>;
}

export const ALLOWLISTED_FIREBASE_REGISTRATION_ERROR_CODES = [
  'auth/email-already-in-use',
  'auth/invalid-email',
  'auth/weak-password',
  'auth/too-many-requests',
  'auth/network-request-failed',
  'auth/operation-not-allowed',
  'auth/admin-restricted-operation',
  'auth/configuration-not-found',
  'auth/internal-error',
  'auth/invalid-api-key',
  'auth/app-not-authorized',
  'auth/unauthorized-domain',
  'auth/project-not-found',
  'auth/quota-exceeded',
] as const;

const SAFE_REGISTRATION_DIAGNOSTIC_CODE_SET = new Set<string>(
  ALLOWLISTED_FIREBASE_REGISTRATION_ERROR_CODES
);

/**
 * Extracts a safe, explicitly allowlisted Firebase Auth error code for diagnostics.
 * Never returns raw error messages, stack traces, tokens, emails, UIDs, or passwords.
 */
export function getSafeRegistrationDiagnosticCode(err: unknown): string {
  if (!err || typeof err !== 'object') {
    return 'unknown';
  }
  const rawCode = (err as { code?: unknown }).code;
  if (typeof rawCode !== 'string') {
    return 'unknown';
  }
  const trimmedCode = rawCode.trim();
  return SAFE_REGISTRATION_DIAGNOSTIC_CODE_SET.has(trimmedCode)
    ? trimmedCode
    : 'unknown';
}

/**
 * Bounded registration-error classifier that interprets narrowly validated Firebase Auth error codes.
 * - Preserves existing AccountError instances.
 * - Never inspects exception message text to guess Firebase error codes.
 * - Never exposes raw Firebase exception messages, tokens, credentials, UIDs, or stack traces.
 */
export function classifyRegistrationAuthError(err: unknown): AccountError {
  if (err instanceof AccountError) {
    return err;
  }

  const rawCode =
    err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'string'
      ? (err as { code: string }).code.trim()
      : '';

  switch (rawCode) {
    case 'auth/email-already-in-use':
      return new AccountError(
        'ACCOUNT_ALREADY_EXISTS',
        'This email address is already registered. You can sign in or reset your password.'
      );
    case 'auth/invalid-email':
      return new AccountError(
        'ACCOUNT_DATA_INVALID',
        'Please enter a valid email address.'
      );
    case 'auth/weak-password':
      return new AccountError(
        'REGISTRATION_WEAK_PASSWORD',
        'The password does not meet security requirements. Please choose a stronger password.'
      );
    case 'auth/too-many-requests':
      return new AccountError(
        'REGISTRATION_RATE_LIMITED',
        'Too many registration attempts. Please wait before trying again.'
      );
    case 'auth/network-request-failed':
      return new AccountError(
        'REGISTRATION_NETWORK_ERROR',
        'Unable to connect to the registration service. Check your internet connection and try again.'
      );
    case 'auth/operation-not-allowed':
      return new AccountError(
        'AUTH_UNAVAILABLE',
        'Authentication is currently unavailable. Please try again.'
      );
    default:
      return new AccountError(
        'AUTH_UNAVAILABLE',
        'Registration failed. Unable to create authentication credentials.'
      );
  }
}

export class AccountServiceClass {
  private repository: AccountRepository;
  private authUserProvider?: () => User | null;
  private lastObservedAuthUser: User | null = null;
  private pendingDisplayNamesByUid = new Map<string, string>();
  private inFlightCreationByUid = new Map<string, Promise<Account>>();
  private inFlightRecoveryByUid = new Map<string, Promise<AccountRecoveryResult>>();
  private inFlightRegistrationsByEmail = new Map<string, InFlightRegistrationEntry>();
  private inFlightRegistrationsByUid = new Map<string, InFlightRegistrationEntry>();
  private inFlightPasswordReset: Promise<PasswordResetRequestResult> | null = null;
  private inFlightEmailVerificationByUid = new Map<string, Promise<SendEmailVerificationResult>>();
  private inFlightVerificationRefreshByUid = new Map<string, Promise<RefreshEmailVerificationResult>>();

  constructor(repository?: AccountRepository) {
    this.repository = repository || new FirestoreAccountRepository();
  }

  setRepository(repository: AccountRepository) {
    this.repository = repository;
  }

  getRepository(): AccountRepository {
    return this.repository;
  }

  /**
   * Explicit seam for injecting the currently authenticated Firebase User in tests.
   * Never used for mock fallback in production.
   */
  setAuthUserProvider(provider: (() => User | null) | undefined): void {
    this.authUserProvider = provider;
  }

  protected getAuthenticatedUser(): User | null {
    if (this.authUserProvider) {
      return this.authUserProvider();
    }
    if (!this.isConfigured()) {
      return null;
    }
    return auth?.currentUser ?? this.lastObservedAuthUser ?? null;
  }

  /**
   * Internal/Direct read by UID (delegates to repository)
   */
  async getAccount(uid: string): Promise<Account | null> {
    return await this.repository.getAccount(uid);
  }

  /**
   * Retrieve profile for currently authenticated user bound strictly to auth.currentUser.uid
   */
  async getCurrentAccount(): Promise<Account | null> {
    if (!this.isConfigured() && !this.authUserProvider) {
      throw new AccountError('AUTH_UNAVAILABLE', 'Firebase Auth is unconfigured.');
    }
    const currentUser = this.getAuthenticatedUser();
    if (!currentUser) {
      return null;
    }
    return await this.repository.getAccount(currentUser.uid);
  }

  /**
   * Self-service account update bound strictly to auth.currentUser.uid.
   * Rejects empty displayName, forbidden fields, unauthenticated callers, and unprovisioned accounts.
   */
  async updateCurrentAccount(data: { displayName?: string }): Promise<Account> {
    const validatedPatch = validateAccountDisplayNameUpdate(data);

    if (!this.isConfigured() && !this.authUserProvider) {
      throw new AccountError('AUTH_UNAVAILABLE', 'Firebase Auth is unconfigured.');
    }
    const currentUser = this.getAuthenticatedUser();
    if (!currentUser || typeof currentUser.uid !== 'string' || !currentUser.uid.trim()) {
      throw new AccountError('AUTH_UNAVAILABLE', 'No authenticated user session found.');
    }
    if (
      this.inFlightRecoveryByUid.has(currentUser.uid) ||
      this.inFlightCreationByUid.has(currentUser.uid)
    ) {
      throw new AccountError(
        'ACCOUNT_NOT_FOUND',
        'Account profile setup is incomplete. Complete account recovery before editing profile.'
      );
    }
    return await this.repository.updateAccount(currentUser.uid, validatedPatch);
  }

  /**
   * Internal create helper for explicit user provisioning.
   * Reuses the repository's transactional uniqueness check and preserves existing
   * createdAt and displayName if a concurrent creation already committed.
   */
  async createAccountForUser(user: User, displayName?: string): Promise<Account> {
    if (!user || typeof user.uid !== 'string' || !user.uid.trim()) {
      throw new AccountError('ACCOUNT_DATA_INVALID', 'Authenticated user UID is required.');
    }

    const uid = user.uid;
    const explicitDisplayName = typeof displayName === 'string' && displayName.trim() !== ''
      ? displayName.trim()
      : undefined;

    if (explicitDisplayName) {
      this.pendingDisplayNamesByUid.set(uid, explicitDisplayName);
    }

    const existingInFlight = this.inFlightCreationByUid.get(uid);
    if (existingInFlight) {
      return await existingInFlight;
    }

    const creationPromise = (async (): Promise<Account> => {
      const resolvedDisplayName = (
        explicitDisplayName ||
        this.pendingDisplayNamesByUid.get(uid) ||
        (typeof user.displayName === 'string' && user.displayName.trim() !== '' ? user.displayName.trim() : '') ||
        user.email?.split('@')[0] ||
        'User'
      ).trim();

      const now = new Date().toISOString();
      const newAccount: Account = {
        id: uid,
        email: (user.email || '').trim().toLowerCase(),
        displayName: resolvedDisplayName,
        createdAt: now,
        updatedAt: now
      };

      try {
        const created = await this.repository.createAccount(newAccount);
        this.pendingDisplayNamesByUid.delete(uid);
        return created;
      } catch (err: any) {
        if (err instanceof AccountError && err.code === 'ACCOUNT_ALREADY_EXISTS') {
          const existing = await this.repository.getAccount(uid);
          if (existing) {
            this.pendingDisplayNamesByUid.delete(uid);
            return existing;
          }
        }
        if (err instanceof AccountError) {
          throw err;
        }
        console.error('Account creation failed:', err);
        throw new AccountError('ACCOUNT_PROVISIONING_FAILED', 'Unable to provision account profile.');
      }
    })();

    this.inFlightCreationByUid.set(uid, creationPromise);
    try {
      return await creationPromise;
    } finally {
      if (this.inFlightCreationByUid.get(uid) === creationPromise) {
        this.inFlightCreationByUid.delete(uid);
      }
    }
  }

  /**
   * If a registration is currently in flight for the given Firebase user,
   * awaits its single provisioning attempt so onAuthStateChanged does not race it.
   */
  async awaitInFlightRegistrationForUser(
    user: User | null | undefined
  ): Promise<{ user: User | null; account: Account | null; error?: string } | null> {
    if (!user) return null;
    const byUid = user.uid ? this.inFlightRegistrationsByUid.get(user.uid) : undefined;
    if (byUid) {
      return await byUid.promise;
    }
    const normalizedEmail = (user.email || '').trim().toLowerCase();
    const byEmail = normalizedEmail ? this.inFlightRegistrationsByEmail.get(normalizedEmail) : undefined;
    if (byEmail) {
      return await byEmail.promise;
    }
    return null;
  }

  /**
   * Bounded, idempotent recovery operation for the currently authenticated Firebase user.
   * - Never accepts a caller-supplied arbitrary UID.
   * - Never creates a second Firebase Auth user.
   * - Reads existing accounts/{uid} first and returns it without mutation if present.
   * - Uses createAccountForUser when missing.
   * - Handles auth state changes and stale async responses safely.
   */
  async recoverCurrentAccountProfile(options?: RecoverAccountOptions): Promise<AccountRecoveryResult> {
    if (
      options !== undefined &&
      (typeof options !== 'object' ||
        options === null ||
        Array.isArray(options) ||
        'uid' in (options as Record<string, unknown>) ||
        'id' in (options as Record<string, unknown>))
    ) {
      return {
        status: 'recoverable_failure',
        account: null,
        recoverable: false,
        error: {
          code: 'ACCOUNT_DATA_INVALID',
          message: 'Caller-supplied UID is forbidden during account recovery.'
        }
      };
    }

    if (!this.isConfigured() && !this.authUserProvider) {
      return {
        status: 'recoverable_failure',
        account: null,
        recoverable: false,
        error: {
          code: 'AUTH_UNAVAILABLE',
          message: 'Authentication backend is unconfigured or unavailable.'
        }
      };
    }

    const currentUser = this.getAuthenticatedUser();
    if (!currentUser || typeof currentUser.uid !== 'string' || !currentUser.uid.trim()) {
      return {
        status: 'unauthenticated',
        account: null,
        recoverable: false,
        error: {
          code: 'AUTH_UNAVAILABLE',
          message: 'No authenticated user session found.'
        }
      };
    }

    const targetUid = currentUser.uid;
    const explicitDisplayName =
      typeof options?.displayName === 'string' && options.displayName.trim() !== ''
        ? options.displayName.trim()
        : undefined;

    if (explicitDisplayName) {
      this.pendingDisplayNamesByUid.set(targetUid, explicitDisplayName);
    }

    const existingRecovery = this.inFlightRecoveryByUid.get(targetUid);
    if (existingRecovery) {
      const sharedResult = await existingRecovery;
      const postWaitUser = this.getAuthenticatedUser();
      if (!postWaitUser || postWaitUser.uid !== targetUid) {
        return {
          status: 'unauthenticated',
          account: null,
          recoverable: false,
          error: {
            code: 'AUTH_UNAVAILABLE',
            message: 'Authenticated user session changed during account recovery.'
          }
        };
      }
      return sharedResult;
    }

    const recoveryPromise = (async (): Promise<AccountRecoveryResult> => {
      try {
        // Coordinate with any in-flight register() call for this user first
        const inFlightReg = await this.awaitInFlightRegistrationForUser(currentUser);
        const afterRegUser = this.getAuthenticatedUser();
        if (!afterRegUser || afterRegUser.uid !== targetUid) {
          return {
            status: 'unauthenticated',
            account: null,
            recoverable: false,
            error: {
              code: 'AUTH_UNAVAILABLE',
              message: 'Authenticated user session changed during account recovery.'
            }
          };
        }

        if (inFlightReg?.account && inFlightReg.account.id === targetUid) {
          return {
            status: 'already_provisioned',
            account: inFlightReg.account,
            recoverable: false,
            error: null
          };
        }

        // 1. Read existing canonical accounts/{uid} first
        const existing = await this.repository.getAccount(targetUid);
        const afterReadUser = this.getAuthenticatedUser();
        if (!afterReadUser || afterReadUser.uid !== targetUid) {
          return {
            status: 'unauthenticated',
            account: null,
            recoverable: false,
            error: {
              code: 'AUTH_UNAVAILABLE',
              message: 'Authenticated user session changed during account recovery.'
            }
          };
        }

        if (existing) {
          this.pendingDisplayNamesByUid.delete(targetUid);
          return {
            status: 'already_provisioned',
            account: existing,
            recoverable: false,
            error: null
          };
        }

        // 2. Missing profile: provision via canonical createAccountForUser
        const preferredDisplayName =
          explicitDisplayName ||
          this.pendingDisplayNamesByUid.get(targetUid) ||
          undefined;

        const created = await this.createAccountForUser(currentUser, preferredDisplayName);
        const afterCreateUser = this.getAuthenticatedUser();
        if (!afterCreateUser || afterCreateUser.uid !== targetUid) {
          return {
            status: 'unauthenticated',
            account: null,
            recoverable: false,
            error: {
              code: 'AUTH_UNAVAILABLE',
              message: 'Authenticated user session changed during account recovery.'
            }
          };
        }

        return {
          status: 'recovered',
          account: created,
          recoverable: false,
          error: null
        };
      } catch (err: any) {
        const afterErrorUser = this.getAuthenticatedUser();
        if (!afterErrorUser || afterErrorUser.uid !== targetUid) {
          return {
            status: 'unauthenticated',
            account: null,
            recoverable: false,
            error: {
              code: 'AUTH_UNAVAILABLE',
              message: 'Authenticated user session changed during account recovery.'
            }
          };
        }

        const code: AccountErrorType =
          err instanceof AccountError ? err.code : 'ACCOUNT_PROVISIONING_FAILED';
        const message =
          err instanceof AccountError && err.code === 'AUTH_UNAVAILABLE'
            ? 'Authentication backend is unconfigured or unavailable.'
            : err instanceof AccountError && err.code === 'ACCOUNT_DATA_INVALID'
              ? 'Unable to read or validate canonical account profile.'
              : 'ACCOUNT_PROVISIONING_FAILED: Unable to provision platform account.';

        return {
          status: 'recoverable_failure',
          account: null,
          recoverable: true,
          error: {
            code,
            message
          }
        };
      }
    })();

    this.inFlightRecoveryByUid.set(targetUid, recoveryPromise);
    try {
      return await recoveryPromise;
    } finally {
      if (this.inFlightRecoveryByUid.get(targetUid) === recoveryPromise) {
        this.inFlightRecoveryByUid.delete(targetUid);
      }
    }
  }

  protected isConfigured(): boolean {
    return isFirebaseConfigured && !!auth;
  }

  protected async performSignIn(email: string, password: string): Promise<User> {
    const cred = await realSignIn(auth, email, password);
    return cred.user;
  }

  protected async performCreateUser(email: string, password: string): Promise<User> {
    const cred = await realCreateUser(auth, email, password);
    return cred.user;
  }

  protected async performPasswordReset(email: string): Promise<void> {
    await realSendPasswordResetEmail(auth, email);
  }

  protected async performSendEmailVerification(user: User): Promise<void> {
    await realSendEmailVerification(user);
  }

  protected async performReloadUser(user: User): Promise<void> {
    if (typeof (user as { reload?: unknown }).reload === 'function') {
      await user.reload();
      return;
    }
    await realReloadUser(user);
  }

  private mapEmailVerificationError(err: any, fallbackMessage: string): AccountError {
    if (err instanceof AccountError) {
      return err;
    }
    const errCode = typeof err?.code === 'string' ? err.code : '';
    const errMsg = typeof err?.message === 'string' ? err.message : '';
    const lowerMsg = errMsg.toLowerCase();

    if (
      errCode === 'auth/too-many-requests' ||
      errMsg.includes('too-many-requests') ||
      lowerMsg.includes('rate limit')
    ) {
      return new AccountError(
        'EMAIL_VERIFICATION_RATE_LIMITED',
        'Too many verification requests. Please wait before trying again.'
      );
    }

    if (
      errCode === 'auth/network-request-failed' ||
      errMsg.includes('network-request-failed') ||
      lowerMsg.includes('network')
    ) {
      return new AccountError(
        'EMAIL_VERIFICATION_NETWORK_ERROR',
        'Network error while processing email verification. Please check your connection and try again.'
      );
    }

    if (
      errCode === 'auth/user-token-expired' ||
      errCode === 'auth/requires-recent-login' ||
      errCode === 'auth/invalid-user-token' ||
      errCode === 'auth/user-disabled' ||
      errMsg.includes('user-token-expired') ||
      errMsg.includes('requires-recent-login')
    ) {
      return new AccountError(
        'EMAIL_VERIFICATION_SESSION_EXPIRED',
        'Your authentication session has expired. Please sign in again to verify your email.'
      );
    }

    return new AccountError('AUTH_UNAVAILABLE', fallbackMessage);
  }

  /**
   * Returns deterministic current email verification status from Firebase Auth authority.
   * Never derives verification status from accounts/{uid} or fabricates verified state.
   */
  getEmailVerificationStatus(): EmailVerificationStatusResult {
    if (!this.isConfigured() && !this.authUserProvider) {
      return {
        authenticated: false,
        uid: null,
        email: null,
        emailVerified: false,
      };
    }

    const currentUser = this.getAuthenticatedUser();
    if (!currentUser || typeof currentUser.uid !== 'string' || !currentUser.uid.trim()) {
      return {
        authenticated: false,
        uid: null,
        email: null,
        emailVerified: false,
      };
    }

    return {
      authenticated: true,
      uid: currentUser.uid,
      email:
        typeof currentUser.email === 'string' && currentUser.email.trim() !== ''
          ? currentUser.email.trim().toLowerCase()
          : null,
      emailVerified: currentUser.emailVerified === true,
    };
  }

  /**
   * Sends a Firebase Auth email verification message strictly to the currently authenticated user.
   * - Rejects unauthenticated requests.
   * - Deduplicates concurrent in-flight requests per UID.
   * - Discards stale responses if the user signs out or switches accounts.
   * - Never accepts arbitrary email addresses (no email enumeration).
   */
  async sendEmailVerificationForCurrentUser(): Promise<SendEmailVerificationResult> {
    if (!this.isConfigured() && !this.authUserProvider) {
      throw new AccountError(
        'AUTH_UNAVAILABLE',
        'Authentication is currently unavailable.'
      );
    }

    const currentUser = this.getAuthenticatedUser();
    if (!currentUser || typeof currentUser.uid !== 'string' || !currentUser.uid.trim()) {
      throw new AccountError(
        'AUTH_UNAVAILABLE',
        'No authenticated user session found.'
      );
    }

    const targetUid = currentUser.uid;

    if (currentUser.emailVerified === true) {
      return {
        status: 'already_verified',
        uid: targetUid,
        emailVerified: true,
        messageAr: EMAIL_ALREADY_VERIFIED_MESSAGES.ar,
        messageEn: EMAIL_ALREADY_VERIFIED_MESSAGES.en,
      };
    }

    const existingInFlight = this.inFlightEmailVerificationByUid.get(targetUid);
    if (existingInFlight) {
      return await existingInFlight;
    }

    const sendPromise = (async (): Promise<SendEmailVerificationResult> => {
      try {
        await this.performSendEmailVerification(currentUser);

        const activeAfterSend = this.getAuthenticatedUser();
        if (!activeAfterSend || activeAfterSend.uid !== targetUid) {
          throw new AccountError(
            'AUTH_UNAVAILABLE',
            'Authenticated user session changed or ended.'
          );
        }

        return {
          status: 'sent',
          uid: targetUid,
          emailVerified: activeAfterSend.emailVerified === true,
          messageAr: EMAIL_VERIFICATION_SENT_MESSAGES.ar,
          messageEn: EMAIL_VERIFICATION_SENT_MESSAGES.en,
        };
      } catch (err: any) {
        throw this.mapEmailVerificationError(
          err,
          'Unable to send verification email at this time. Please try again later.'
        );
      }
    })();

    this.inFlightEmailVerificationByUid.set(targetUid, sendPromise);
    try {
      return await sendPromise;
    } finally {
      if (this.inFlightEmailVerificationByUid.get(targetUid) === sendPromise) {
        this.inFlightEmailVerificationByUid.delete(targetUid);
      }
    }
  }

  /**
   * Refreshes the currently authenticated user's verification state using Firebase Auth reload().
   * - Bound strictly to the current authenticated UID.
   * - Discards stale responses if the user signs out or switches accounts during reload.
   * - Never fabricates a verified state.
   */
  async refreshEmailVerificationStatus(): Promise<RefreshEmailVerificationResult> {
    if (!this.isConfigured() && !this.authUserProvider) {
      throw new AccountError(
        'AUTH_UNAVAILABLE',
        'Authentication is currently unavailable.'
      );
    }

    const currentUser = this.getAuthenticatedUser();
    if (!currentUser || typeof currentUser.uid !== 'string' || !currentUser.uid.trim()) {
      throw new AccountError(
        'AUTH_UNAVAILABLE',
        'No authenticated user session found.'
      );
    }

    const targetUid = currentUser.uid;
    const existingRefresh = this.inFlightVerificationRefreshByUid.get(targetUid);
    if (existingRefresh) {
      return await existingRefresh;
    }

    const refreshPromise = (async (): Promise<RefreshEmailVerificationResult> => {
      try {
        await this.performReloadUser(currentUser);

        const latestUser = this.getAuthenticatedUser();
        if (!latestUser || latestUser.uid !== targetUid) {
          throw new AccountError(
            'AUTH_UNAVAILABLE',
            'Authenticated user session changed or ended.'
          );
        }

        this.lastObservedAuthUser = latestUser;
        const isVerified = latestUser.emailVerified === true;

        return {
          uid: targetUid,
          email:
            typeof latestUser.email === 'string' && latestUser.email.trim() !== ''
              ? latestUser.email.trim().toLowerCase()
              : null,
          emailVerified: isVerified,
          messageAr: isVerified
            ? EMAIL_VERIFICATION_REFRESH_MESSAGES.verified.ar
            : EMAIL_VERIFICATION_REFRESH_MESSAGES.unverified.ar,
          messageEn: isVerified
            ? EMAIL_VERIFICATION_REFRESH_MESSAGES.verified.en
            : EMAIL_VERIFICATION_REFRESH_MESSAGES.unverified.en,
        };
      } catch (err: any) {
        throw this.mapEmailVerificationError(
          err,
          'Unable to refresh email verification status at this time. Please try again later.'
        );
      }
    })();

    this.inFlightVerificationRefreshByUid.set(targetUid, refreshPromise);
    try {
      return await refreshPromise;
    } finally {
      if (this.inFlightVerificationRefreshByUid.get(targetUid) === refreshPromise) {
        this.inFlightVerificationRefreshByUid.delete(targetUid);
      }
    }
  }

  /**
   * Request a Firebase Authentication password reset email.
   * - Validates email locally before invoking Firebase Auth.
   * - Returns a neutral success response regardless of whether an account exists (no email enumeration).
   * - Prevents repeated concurrent submissions while a request is pending.
   * - Handles rate-limit and network errors safely without logging or leaking tokens.
   */
  async requestPasswordReset(email: string): Promise<PasswordResetRequestResult> {
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!normalizedEmail || !emailPattern.test(normalizedEmail)) {
      throw new AccountError(
        'ACCOUNT_DATA_INVALID',
        'Please enter a valid email address.'
      );
    }

    if (!this.isConfigured()) {
      throw new AccountError(
        'AUTH_UNAVAILABLE',
        'Authentication is currently unavailable.'
      );
    }

    if (this.inFlightPasswordReset) {
      return await this.inFlightPasswordReset;
    }

    const resetPromise = (async (): Promise<PasswordResetRequestResult> => {
      try {
        await this.performPasswordReset(normalizedEmail);
        return {
          status: 'sent',
          email: normalizedEmail,
          messageAr: NEUTRAL_PASSWORD_RESET_MESSAGES.ar,
          messageEn: NEUTRAL_PASSWORD_RESET_MESSAGES.en,
        };
      } catch (err: any) {
        if (err instanceof AccountError) {
          throw err;
        }
        const errCode = typeof err?.code === 'string' ? err.code : '';
        const errMsg = typeof err?.message === 'string' ? err.message : '';

        // Prevent account enumeration: unknown email produces the exact same neutral response
        if (
          errCode === 'auth/user-not-found' ||
          errMsg.includes('auth/user-not-found')
        ) {
          return {
            status: 'sent',
            email: normalizedEmail,
            messageAr: NEUTRAL_PASSWORD_RESET_MESSAGES.ar,
            messageEn: NEUTRAL_PASSWORD_RESET_MESSAGES.en,
          };
        }

        if (
          errCode === 'auth/invalid-email' ||
          errMsg.includes('auth/invalid-email')
        ) {
          throw new AccountError(
            'ACCOUNT_DATA_INVALID',
            'Please enter a valid email address.'
          );
        }

        if (
          errCode === 'auth/too-many-requests' ||
          errMsg.includes('too-many-requests') ||
          errMsg.toLowerCase().includes('rate limit')
        ) {
          throw new AccountError(
            'PASSWORD_RESET_RATE_LIMITED',
            'Too many password reset requests. Please wait and try again later.'
          );
        }

        if (
          errCode === 'auth/network-request-failed' ||
          errMsg.includes('network-request-failed') ||
          errMsg.toLowerCase().includes('network')
        ) {
          throw new AccountError(
            'PASSWORD_RESET_NETWORK_ERROR',
            'Network error while requesting password reset. Please check your connection and try again.'
          );
        }

        throw new AccountError(
          'AUTH_UNAVAILABLE',
          'Unable to process password reset request at this time. Please try again later.'
        );
      }
    })();

    this.inFlightPasswordReset = resetPromise;
    try {
      return await resetPromise;
    } finally {
      if (this.inFlightPasswordReset === resetPromise) {
        this.inFlightPasswordReset = null;
      }
    }
  }

  /**
   * Sign in with email and password.
   */
  async signIn(email: string, password: string): Promise<User> {
    if (!this.isConfigured()) {
      throw new AccountError('AUTH_UNAVAILABLE', 'Authentication is currently unavailable.');
    }
    try {
      const user = await this.performSignIn(email, password);
      this.lastObservedAuthUser = user;
      return user;
    } catch (err: any) {
      if (err instanceof AccountError) {
        throw err;
      }
      console.error('Sign in failed:', err);
      throw new AccountError('AUTH_UNAVAILABLE', 'Authentication failed. Please check your credentials and try again.');
    }
  }

  /**
   * Register new account with email and password. Provisions accounts/{user.uid} bound to authenticated UID.
   */
  async register(email: string, password: string, displayName?: string): Promise<{ user: User; account: Account | null; error?: string }> {
    if (!this.isConfigured()) {
      throw new AccountError('AUTH_UNAVAILABLE', 'Authentication is currently unavailable.');
    }

    const normalizedEmail = (email || '').trim().toLowerCase();
    const trimmedDisplayName =
      typeof displayName === 'string' && displayName.trim() !== ''
        ? displayName.trim()
        : undefined;

    let resolveBarrier!: (res: { user: User | null; account: Account | null; error?: string }) => void;
    const barrierPromise = new Promise<{ user: User | null; account: Account | null; error?: string }>((resolve) => {
      resolveBarrier = resolve;
    });
    const entry: InFlightRegistrationEntry = {
      displayName: trimmedDisplayName,
      promise: barrierPromise
    };

    if (normalizedEmail) {
      this.inFlightRegistrationsByEmail.set(normalizedEmail, entry);
    }

    let user: User;
    try {
      user = await this.performCreateUser(email, password);
      this.lastObservedAuthUser = user;
      if (user?.uid) {
        this.inFlightRegistrationsByUid.set(user.uid, entry);
        if (trimmedDisplayName) {
          this.pendingDisplayNamesByUid.set(user.uid, trimmedDisplayName);
        }
      }
    } catch (err: any) {
      resolveBarrier({ user: null, account: null });
      if (normalizedEmail && this.inFlightRegistrationsByEmail.get(normalizedEmail) === entry) {
        this.inFlightRegistrationsByEmail.delete(normalizedEmail);
      }
      if (err instanceof AccountError) {
        throw err;
      }
      const classifiedError = classifyRegistrationAuthError(err);
      console.error('Registration auth failed:', {
        category: classifiedError.code,
        firebaseCode: getSafeRegistrationDiagnosticCode(err),
      });
      throw classifiedError;
    }

    // Provision account profile bound to newly authenticated user UID
    try {
      const account = await this.createAccountForUser(user, trimmedDisplayName);
      const successResult = { user, account };
      resolveBarrier(successResult);
      return successResult;
    } catch (err: any) {
      const provisioningCategory: AccountErrorType =
        err instanceof AccountError ? err.code : 'ACCOUNT_PROVISIONING_FAILED';
      console.error('Account profile provisioning failed after auth creation:', {
        category: provisioningCategory,
      });
      const failureResult = {
        user,
        account: null,
        error: 'ACCOUNT_PROVISIONING_FAILED: Unable to provision platform account.'
      };
      resolveBarrier(failureResult);
      return failureResult;
    } finally {
      if (normalizedEmail && this.inFlightRegistrationsByEmail.get(normalizedEmail) === entry) {
        this.inFlightRegistrationsByEmail.delete(normalizedEmail);
      }
      if (user?.uid && this.inFlightRegistrationsByUid.get(user.uid) === entry) {
        this.inFlightRegistrationsByUid.delete(user.uid);
      }
    }
  }

  /**
   * Sign out current user.
   */
  async signOut(): Promise<void> {
    this.lastObservedAuthUser = null;
    this.inFlightRecoveryByUid.clear();
    this.inFlightCreationByUid.clear();
    this.pendingDisplayNamesByUid.clear();
    this.inFlightEmailVerificationByUid.clear();
    this.inFlightVerificationRefreshByUid.clear();
    if (!isFirebaseConfigured || !auth) {
      return;
    }
    await realSignOut(auth);
  }

  /**
   * Observe authentication state changes.
   */
  observeAuthState(callback: (user: User | null) => void): () => void {
    if (!isFirebaseConfigured || !auth) {
      this.lastObservedAuthUser = null;
      callback(null);
      return () => {};
    }
    return realOnAuthStateChanged(auth, (user) => {
      this.lastObservedAuthUser = user;
      callback(user);
    });
  }
}

export const AccountService = new AccountServiceClass();
