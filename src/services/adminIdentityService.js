"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminGateResolutionController = exports.AdminIdentityService = exports.AdminIdentityServiceClass = exports.InMemoryAdminIdentityRepository = exports.FirestoreAdminIdentityRepository = exports.AdminReadError = void 0;
exports.validateAdminUserData = validateAdminUserData;
const firestore_1 = require("firebase/firestore");
const firebase_1 = require("./firebase");
const adminContract_1 = require("../shared/adminContract");
/**
 * Validates runtime AdminUser data against canonical 5-field schema.
 * Returns valid AdminUser or null if malformed or non-canonical.
 */
function validateAdminUserData(data, expectedUid) {
    if (!data || typeof data !== 'object') {
        return null;
    }
    const { name, email, role, isActive } = data;
    if (typeof name !== 'string' || name.trim() === '') {
        return null;
    }
    if (typeof email !== 'string' || email.trim() === '' || !email.includes('@')) {
        return null;
    }
    if (!(0, adminContract_1.isValidAdminRole)(role)) {
        return null;
    }
    if (typeof isActive !== 'boolean') {
        return null;
    }
    // Document ID binding: if data.id is present, it must equal expectedUid
    if (data.id !== undefined && data.id !== expectedUid) {
        return null;
    }
    return {
        id: expectedUid,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role: role,
        isActive,
    };
}
class AdminReadError extends Error {
    originalError;
    constructor(message, originalError) {
        super(message);
        this.name = 'AdminReadError';
        this.originalError = originalError;
        Object.setPrototypeOf(this, AdminReadError.prototype);
    }
}
exports.AdminReadError = AdminReadError;
/**
 * Production Durable Admin Repository backed strictly by Firestore admins/{uid}.
 * Does NOT fall back to in-memory mock storage.
 */
class FirestoreAdminIdentityRepository {
    isConfigured() {
        return firebase_1.isFirebaseConfigured && !!firebase_1.db;
    }
    async getAdminUser(uid) {
        if (!uid || typeof uid !== 'string') {
            return null;
        }
        if (!this.isConfigured()) {
            throw new AdminReadError('ADMIN_READ_FAILURE', new Error('Firebase/Firestore is not configured'));
        }
        try {
            const docRef = (0, firestore_1.doc)(firebase_1.db, 'admins', uid);
            const snapshot = await (0, firestore_1.getDoc)(docRef);
            if (!snapshot || !snapshot.exists()) {
                return null; // Authoritative missing
            }
            return validateAdminUserData(snapshot.data(), uid); // Returns valid or null (Authoritative malformed/invalid)
        }
        catch (error) {
            console.error('Firestore getAdminUser error:', error);
            throw new AdminReadError('ADMIN_READ_FAILURE', error);
        }
    }
}
exports.FirestoreAdminIdentityRepository = FirestoreAdminIdentityRepository;
/**
 * Isolated In-Memory Admin Repository for testing only.
 * Must be explicitly injected for testing.
 */
class InMemoryAdminIdentityRepository {
    admins = new Map();
    shouldFail = false;
    async getAdminUser(uid) {
        if (this.shouldFail) {
            throw new AdminReadError('ADMIN_READ_FAILURE');
        }
        if (!uid)
            return null;
        const raw = this.admins.get(uid);
        if (!raw)
            return null;
        return validateAdminUserData(raw, uid);
    }
    setShouldFail(fail) {
        this.shouldFail = fail;
    }
    seed(rawAdmin) {
        this.admins.set(rawAdmin.id, rawAdmin);
    }
    clear() {
        this.admins.clear();
    }
}
exports.InMemoryAdminIdentityRepository = InMemoryAdminIdentityRepository;
class AdminIdentityServiceClass {
    repository;
    constructor(repository) {
        this.repository = repository || new FirestoreAdminIdentityRepository();
    }
    setRepository(repository) {
        this.repository = repository;
    }
    getRepository() {
        return this.repository;
    }
    /**
     * Internal read by explicit UID (primarily for repository/testing delegation).
     */
    async getAdminUserByUid(uid) {
        return await this.repository.getAdminUser(uid);
    }
    /**
     * Resolves canonical AdminUser for an authenticated UID emitted by an auth observer event.
     * Binds resolution to the exact supplied UID rather than re-reading auth.currentUser.
     */
    async resolveAdminForAuthenticatedUid(uid) {
        if (!uid || typeof uid !== 'string') {
            return null;
        }
        return await this.repository.getAdminUser(uid);
    }
    /**
     * Resolves the canonical AdminUser profile bound strictly to auth.currentUser.uid.
     * Does NOT allow caller to supply arbitrary UID for self-resolution.
     */
    async getCurrentAdminUser() {
        if (!firebase_1.isFirebaseConfigured || !firebase_1.auth) {
            return null;
        }
        const currentUser = firebase_1.auth.currentUser;
        if (!currentUser) {
            return null;
        }
        return await this.repository.getAdminUser(currentUser.uid);
    }
}
exports.AdminIdentityServiceClass = AdminIdentityServiceClass;
exports.AdminIdentityService = new AdminIdentityServiceClass();
class AdminGateResolutionController {
    generation = 0;
    expectedUid = null;
    isMounted = true;
    snapshot = {
        gateState: 'AUTH_LOADING',
        firebaseUser: null,
        adminUser: null,
        generation: 0,
        revalidationError: null,
    };
    listeners = new Set();
    getSnapshot() {
        return { ...this.snapshot };
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
    mount() {
        this.isMounted = true;
    }
    unmount() {
        this.isMounted = false;
    }
    emitState(gateState, firebaseUser, adminUser, gen, revalidationError = null) {
        if (!this.isMounted)
            return;
        this.snapshot = { gateState, firebaseUser, adminUser, generation: gen, revalidationError };
        this.listeners.forEach((l) => l(this.snapshot));
    }
    async handleAuthEvent(user, resolver) {
        const currentGen = ++this.generation;
        if (!this.isMounted)
            return;
        if (!user) {
            this.expectedUid = null;
            this.emitState('UNAUTHENTICATED', null, null, currentGen, null);
            return;
        }
        const uid = user.uid;
        const isSameUidRevalidation = this.snapshot.gateState === 'ADMIN_AUTHORIZED' &&
            this.snapshot.adminUser &&
            this.snapshot.adminUser.id === uid;
        this.expectedUid = uid;
        if (!isSameUidRevalidation) {
            // Clear previous adminUser immediately upon starting resolution for new UID / different state
            this.emitState('ADMIN_RESOLVING', user, null, currentGen, null);
        }
        try {
            const resolved = await resolver(uid);
            if (!this.isMounted)
                return;
            if (this.generation !== currentGen)
                return;
            if (this.expectedUid !== uid)
                return;
            if (resolved && resolved.isActive) {
                this.emitState('ADMIN_AUTHORIZED', user, resolved, currentGen, null);
            }
            else {
                this.emitState('ADMIN_DENIED', user, null, currentGen, null);
            }
        }
        catch (error) {
            if (!this.isMounted)
                return;
            if (this.generation !== currentGen)
                return;
            if (this.expectedUid !== uid)
                return;
            if (error instanceof AdminReadError) {
                if (isSameUidRevalidation) {
                    // Safe degraded state: preserve ADMIN_AUTHORIZED with existing valid identity, setting the transient read error flag
                    this.snapshot = {
                        ...this.snapshot,
                        revalidationError: 'ADMIN_READ_FAILURE',
                    };
                    this.listeners.forEach((l) => l(this.snapshot));
                }
                else {
                    // Initial load failure: Fail Closed (prevent authorization and render denied screen with bounded error)
                    this.emitState('ADMIN_DENIED', user, null, currentGen, 'ADMIN_READ_FAILURE');
                }
            }
            else {
                // Unexpected/programming/runtime error: FAIL CLOSED SAFELY immediately
                // Do NOT label it as ADMIN_READ_FAILURE or preserve the authorized workspace under revalidation
                this.emitState('ADMIN_DENIED', user, null, currentGen, null);
            }
        }
    }
}
exports.AdminGateResolutionController = AdminGateResolutionController;
//# sourceMappingURL=adminIdentityService.js.map