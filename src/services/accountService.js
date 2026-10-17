"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountService = exports.AccountServiceClass = exports.InMemoryAccountRepository = exports.FirestoreAccountRepository = exports.AccountError = void 0;
exports.validateAccountData = validateAccountData;
const auth_1 = require("firebase/auth");
const firestore_1 = require("firebase/firestore");
const firebase_1 = require("./firebase");
class AccountError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'AccountError';
        this.code = code;
    }
}
exports.AccountError = AccountError;
/**
 * Validates runtime Account data against canonical 5-field schema.
 * Throws AccountError('ACCOUNT_DATA_INVALID') if data is malformed or contains non-canonical fields.
 */
function validateAccountData(data, expectedUid) {
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
 * Production Durable Account Repository backed strictly by Firestore accounts/{uid}.
 * Does NOT fall back to in-memory storage when Firebase is unconfigured.
 */
class FirestoreAccountRepository {
    isConfigured() {
        return firebase_1.isFirebaseConfigured && !!firebase_1.db;
    }
    async fetchDoc(uid) {
        const docRef = (0, firestore_1.doc)(firebase_1.db, 'accounts', uid);
        return await (0, firestore_1.getDoc)(docRef);
    }
    async runTx(updateFunction) {
        return await (0, firestore_1.runTransaction)(firebase_1.db, updateFunction);
    }
    async getAccount(uid) {
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
        }
        catch (error) {
            if (error instanceof AccountError) {
                throw error;
            }
            console.error('Firestore getAccount error:', error);
            throw new AccountError('ACCOUNT_DATA_INVALID', 'Unable to read account profile.');
        }
    }
    async createAccount(account) {
        if (!this.isConfigured()) {
            throw new AccountError('AUTH_UNAVAILABLE', 'Authentication backend is unconfigured or unavailable.');
        }
        const validated = validateAccountData(account, account.id);
        try {
            await this.runTx(async (transaction) => {
                const docRef = (0, firestore_1.doc)(firebase_1.db, 'accounts', validated.id);
                const snapshot = await transaction.get(docRef);
                if (snapshot.exists()) {
                    throw new AccountError('ACCOUNT_ALREADY_EXISTS', `Account record already exists for UID: ${validated.id}`);
                }
                transaction.set(docRef, validated);
            });
            return validated;
        }
        catch (error) {
            if (error instanceof AccountError) {
                throw error;
            }
            console.error('Firestore createAccount error:', error);
            throw new AccountError('ACCOUNT_PROVISIONING_FAILED', 'Unable to provision account profile.');
        }
    }
    async updateAccount(uid, data) {
        if (!this.isConfigured()) {
            throw new AccountError('AUTH_UNAVAILABLE', 'Authentication backend is unconfigured or unavailable.');
        }
        if (!uid) {
            throw new AccountError('ACCOUNT_DATA_INVALID', 'UID is required to update account.');
        }
        try {
            return await this.runTx(async (transaction) => {
                const docRef = (0, firestore_1.doc)(firebase_1.db, 'accounts', uid);
                const snapshot = await transaction.get(docRef);
                if (!snapshot.exists()) {
                    throw new AccountError('ACCOUNT_NOT_FOUND', `Account not found for UID: ${uid}`);
                }
                const existing = validateAccountData(snapshot.data(), uid);
                const updated = {
                    ...existing,
                    displayName: data.displayName !== undefined ? data.displayName.trim() : existing.displayName,
                    updatedAt: new Date().toISOString()
                };
                const validatedUpdated = validateAccountData(updated, uid);
                transaction.set(docRef, validatedUpdated);
                return validatedUpdated;
            });
        }
        catch (error) {
            if (error instanceof AccountError) {
                throw error;
            }
            console.error('Firestore updateAccount error:', error);
            throw new AccountError('ACCOUNT_DATA_INVALID', 'Unable to update account profile.');
        }
    }
}
exports.FirestoreAccountRepository = FirestoreAccountRepository;
/**
 * Isolated In-Memory Account Repository for testing only.
 * Must be explicitly injected and is NEVER automatically selected by production AccountService.
 */
class InMemoryAccountRepository {
    accounts = new Map();
    async getAccount(uid) {
        if (!uid)
            return null;
        const raw = this.accounts.get(uid);
        if (!raw)
            return null;
        return validateAccountData(raw, uid);
    }
    async createAccount(account) {
        const validated = validateAccountData(account, account.id);
        if (this.accounts.has(validated.id)) {
            throw new AccountError('ACCOUNT_ALREADY_EXISTS', `Account record already exists for UID: ${validated.id}`);
        }
        this.accounts.set(validated.id, validated);
        return validated;
    }
    async updateAccount(uid, data) {
        const existing = this.accounts.get(uid);
        if (!existing) {
            throw new AccountError('ACCOUNT_NOT_FOUND', `Account not found for UID: ${uid}`);
        }
        const validatedExisting = validateAccountData(existing, uid);
        const updated = {
            ...validatedExisting,
            displayName: data.displayName !== undefined ? data.displayName.trim() : validatedExisting.displayName,
            updatedAt: new Date().toISOString()
        };
        const validatedUpdated = validateAccountData(updated, uid);
        this.accounts.set(uid, validatedUpdated);
        return validatedUpdated;
    }
    seed(rawAccount) {
        this.accounts.set(rawAccount.id, rawAccount);
    }
    clear() {
        this.accounts.clear();
    }
}
exports.InMemoryAccountRepository = InMemoryAccountRepository;
class AccountServiceClass {
    repository;
    constructor(repository) {
        this.repository = repository || new FirestoreAccountRepository();
    }
    setRepository(repository) {
        this.repository = repository;
    }
    getRepository() {
        return this.repository;
    }
    /**
     * Internal/Direct read by UID (delegates to repository)
     */
    async getAccount(uid) {
        return await this.repository.getAccount(uid);
    }
    /**
     * Retrieve profile for currently authenticated user bound strictly to auth.currentUser.uid
     */
    async getCurrentAccount() {
        if (!firebase_1.isFirebaseConfigured || !firebase_1.auth) {
            throw new AccountError('AUTH_UNAVAILABLE', 'Firebase Auth is unconfigured.');
        }
        const currentUser = firebase_1.auth.currentUser;
        if (!currentUser) {
            return null;
        }
        return await this.repository.getAccount(currentUser.uid);
    }
    /**
     * Self-service account update bound strictly to auth.currentUser.uid
     */
    async updateCurrentAccount(data) {
        if (!firebase_1.isFirebaseConfigured || !firebase_1.auth) {
            throw new AccountError('AUTH_UNAVAILABLE', 'Firebase Auth is unconfigured.');
        }
        const currentUser = firebase_1.auth.currentUser;
        if (!currentUser) {
            throw new AccountError('AUTH_UNAVAILABLE', 'No authenticated user session found.');
        }
        return await this.repository.updateAccount(currentUser.uid, data);
    }
    /**
     * Internal create helper for explicit user provisioning
     */
    async createAccountForUser(user, displayName) {
        const now = new Date().toISOString();
        const newAccount = {
            id: user.uid,
            email: (user.email || '').trim().toLowerCase(),
            displayName: (displayName || user.displayName || user.email?.split('@')[0] || 'User').trim(),
            createdAt: now,
            updatedAt: now
        };
        return await this.repository.createAccount(newAccount);
    }
    isConfigured() {
        return firebase_1.isFirebaseConfigured && !!firebase_1.auth;
    }
    async performSignIn(email, password) {
        const cred = await (0, auth_1.signInWithEmailAndPassword)(firebase_1.auth, email, password);
        return cred.user;
    }
    async performCreateUser(email, password) {
        const cred = await (0, auth_1.createUserWithEmailAndPassword)(firebase_1.auth, email, password);
        return cred.user;
    }
    /**
     * Sign in with email and password.
     */
    async signIn(email, password) {
        if (!this.isConfigured()) {
            throw new AccountError('AUTH_UNAVAILABLE', 'Authentication is currently unavailable.');
        }
        try {
            return await this.performSignIn(email, password);
        }
        catch (err) {
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
    async register(email, password, displayName) {
        if (!this.isConfigured()) {
            throw new AccountError('AUTH_UNAVAILABLE', 'Authentication is currently unavailable.');
        }
        let user;
        try {
            user = await this.performCreateUser(email, password);
        }
        catch (err) {
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
        }
        catch (err) {
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
    async signOut() {
        if (!firebase_1.isFirebaseConfigured || !firebase_1.auth) {
            return;
        }
        await (0, auth_1.signOut)(firebase_1.auth);
    }
    /**
     * Observe authentication state changes.
     */
    observeAuthState(callback) {
        if (!firebase_1.isFirebaseConfigured || !firebase_1.auth) {
            callback(null);
            return () => { };
        }
        return (0, auth_1.onAuthStateChanged)(firebase_1.auth, callback);
    }
}
exports.AccountServiceClass = AccountServiceClass;
exports.AccountService = new AccountServiceClass();
//# sourceMappingURL=accountService.js.map