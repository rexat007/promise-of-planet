import { 
  signInWithEmailAndPassword as realSignIn,
  createUserWithEmailAndPassword as realCreateUser,
  signOut as realSignOut,
  onAuthStateChanged as realOnAuthStateChanged
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured, handleFirestoreError, OperationType } from './firebase';
import type { Account } from '../types/account';

// In-memory store for fallback / testing when Firebase is unconfigured or in test mode
class InMemoryAccountStorage {
  private accounts = new Map<string, Account>();

  async get(uid: string): Promise<Account | null> {
    return this.accounts.get(uid) || null;
  }

  async set(account: Account): Promise<void> {
    this.accounts.set(account.id, account);
  }

  async update(uid: string, data: Partial<Account>): Promise<Account> {
    const existing = this.accounts.get(uid);
    if (!existing) {
      throw new Error(`Account not found for UID: ${uid}`);
    }
    const updated: Account = {
      ...existing,
      ...data,
      id: uid, // immutable UID
      email: existing.email, // email is immutable primary profile identifier
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(uid, updated);
    return updated;
  }

  clear() {
    this.accounts.clear();
  }
}

export const inMemoryAccountStorage = new InMemoryAccountStorage();

/**
     * Account Service & Authentication Foundation
     * Enforces strict separation between Firebase Auth identity, Firestore Account profile, and Admin RBAC.
     */
export const AccountService = {
  /**
       * Retrieve platform account profile by Firebase UID.
       */
  async getAccount(uid: string): Promise<Account | null> {
    if (!uid || typeof uid !== 'string') {
      return null;
    }

    if (!isFirebaseConfigured || !db) {
      return await inMemoryAccountStorage.get(uid);
    }

    try {
      const docRef = doc(db, 'accounts', uid);
      const snapshot = await getDoc(docRef);
      if (!snapshot.exists()) {
        return null;
      }
      const data = snapshot.data();
      return {
        id: data.id || uid,
        email: data.email || '',
        displayName: data.displayName || '',
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: data.updatedAt || new Date().toISOString()
      };
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `accounts/${uid}`);
    }
  },

  /**
       * Create a new platform account profile bound to authenticated Firebase UID.
       */
  async createAccount(uid: string, data: { email: string; displayName?: string }): Promise<Account> {
    if (!uid || !data.email) {
      throw new Error('UID and email are required to create an account.');
    }

    const now = new Date().toISOString();
    const newAccount: Account = {
      id: uid,
      email: data.email.trim().toLowerCase(),
      displayName: data.displayName?.trim() || data.email.split('@')[0],
      createdAt: now,
      updatedAt: now
    };

    if (!isFirebaseConfigured || !db) {
      await inMemoryAccountStorage.set(newAccount);
      return newAccount;
    }

    try {
      const docRef = doc(db, 'accounts', uid);
      await setDoc(docRef, {
        ...newAccount,
        serverTimestamp: serverTimestamp()
      });
      return newAccount;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `accounts/${uid}`);
    }
  },

  /**
       * Update platform account profile.
       */
  async updateAccount(uid: string, data: Partial<Account>): Promise<Account> {
    if (!uid) {
      throw new Error('UID is required to update an account.');
    }

    // Prohibit tampering with ID or email
    const cleanData: Partial<Account> = { ...data };
    delete cleanData.id;
    delete cleanData.email;

    const updatedAt = new Date().toISOString();
    const payload = {
      ...cleanData,
      updatedAt
    };

    if (!isFirebaseConfigured || !db) {
      return await inMemoryAccountStorage.update(uid, payload);
    }

    try {
      const docRef = doc(db, 'accounts', uid);
      await updateDoc(docRef, {
        ...payload,
        serverTimestamp: serverTimestamp()
      });
      const updated = await this.getAccount(uid);
      if (!updated) {
        throw new Error('Account not found after update.');
      }
      return updated;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `accounts/${uid}`);
    }
  },

  /**
       * Sign in with email and password (Email/Password Auth ONLY).
       */
  async signIn(email: string, password: string): Promise<User> {
    if (!isFirebaseConfigured || !auth) {
      throw new Error('Firebase Authentication is unconfigured in this environment. Cannot sign in.');
    }
    const cred = await realSignIn(auth, email, password);
    return cred.user;
  },

  /**
       * Register new account with email and password. Automatically provisions corresponding accounts/{uid} record.
       */
  async register(email: string, password: string, displayName?: string): Promise<{ user: User; account: Account }> {
    if (!isFirebaseConfigured || !auth) {
      throw new Error('Firebase Authentication is unconfigured in this environment. Cannot register.');
    }
    const cred = await realCreateUser(auth, email, password);
    const user = cred.user;
    
    // Provision account profile record bound to Firebase UID
    const account = await this.createAccount(user.uid, {
      email: user.email || email,
      displayName: displayName || user.displayName || email.split('@')[0]
    });

    return { user, account };
  },

  /**
       * Sign out current user.
       */
  async signOut(): Promise<void> {
    if (!isFirebaseConfigured || !auth) {
      return;
    }
    await realSignOut(auth);
  },

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
};
