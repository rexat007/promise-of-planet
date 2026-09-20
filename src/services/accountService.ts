import { 
  signInWithEmailAndPassword as realSignIn,
  createUserWithEmailAndPassword as realCreateUser,
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
  | 'ACCOUNT_PROVISIONING_FAILED';

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

    if (!uid) {
      throw new AccountError('ACCOUNT_DATA_INVALID', 'UID is required to update account.');
    }

    try {
      return await this.runTx(async (transaction) => {
        const docRef = doc(db, 'accounts', uid);
        const snapshot = await transaction.get(docRef);
        if (!snapshot.exists()) {
          throw new AccountError('ACCOUNT_NOT_FOUND', `Account not found for UID: ${uid}`);
        }

        const existing = validateAccountData(snapshot.data(), uid);
        const updated: Account = {
          ...existing,
          displayName: data.displayName !== undefined ? data.displayName.trim() : existing.displayName,
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
    const existing = this.accounts.get(uid);
    if (!existing) {
      throw new AccountError('ACCOUNT_NOT_FOUND', `Account not found for UID: ${uid}`);
    }
    const validatedExisting = validateAccountData(existing, uid);
    const updated: Account = {
      ...validatedExisting,
      displayName: data.displayName !== undefined ? data.displayName.trim() : validatedExisting.displayName,
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

export class AccountServiceClass {
  private repository: AccountRepository;

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
   * Internal/Direct read by UID (delegates to repository)
   */
  async getAccount(uid: string): Promise<Account | null> {
    return await this.repository.getAccount(uid);
  }

  /**
   * Retrieve profile for currently authenticated user bound strictly to auth.currentUser.uid
   */
  async getCurrentAccount(): Promise<Account | null> {
    if (!isFirebaseConfigured || !auth) {
      throw new AccountError('AUTH_UNAVAILABLE', 'Firebase Auth is unconfigured.');
    }
    const currentUser = auth.currentUser;
    if (!currentUser) {
      return null;
    }
    return await this.repository.getAccount(currentUser.uid);
  }

  /**
   * Self-service account update bound strictly to auth.currentUser.uid
   */
  async updateCurrentAccount(data: { displayName?: string }): Promise<Account> {
    if (!isFirebaseConfigured || !auth) {
      throw new AccountError('AUTH_UNAVAILABLE', 'Firebase Auth is unconfigured.');
    }
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new AccountError('AUTH_UNAVAILABLE', 'No authenticated user session found.');
    }
    return await this.repository.updateAccount(currentUser.uid, data);
  }

  /**
   * Internal create helper for explicit user provisioning
   */
  async createAccountForUser(user: User, displayName?: string): Promise<Account> {
    const now = new Date().toISOString();
    const newAccount: Account = {
      id: user.uid,
      email: (user.email || '').trim().toLowerCase(),
      displayName: (displayName || user.displayName || user.email?.split('@')[0] || 'User').trim(),
      createdAt: now,
      updatedAt: now
    };
    return await this.repository.createAccount(newAccount);
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

  /**
   * Sign in with email and password.
   */
  async signIn(email: string, password: string): Promise<User> {
    if (!this.isConfigured()) {
      throw new AccountError('AUTH_UNAVAILABLE', 'Authentication is currently unavailable.');
    }
    try {
      return await this.performSignIn(email, password);
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

    let user: User;
    try {
      user = await this.performCreateUser(email, password);
    } catch (err: any) {
      if (err instanceof AccountError) {
        throw err;
      }
      console.error('Registration auth failed:', err);
      throw new AccountError('AUTH_UNAVAILABLE', 'Registration failed. Unable to create authentication credentials.');
    }

    // Provision account profile bound to newly authenticated user UID
    try {
      const account = await this.createAccountForUser(user, displayName);
      return { user, account };
    } catch (err: any) {
      console.error('Account profile provisioning failed after auth creation:', err);
      return {
        user,
        account: null,
        error: 'ACCOUNT_PROVISIONING_FAILED: Unable to provision platform account.'
      };
    }
  }

  /**
   * Sign out current user.
   */
  async signOut(): Promise<void> {
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
      callback(null);
      return () => {};
    }
    return realOnAuthStateChanged(auth, callback);
  }
}

export const AccountService = new AccountServiceClass();
