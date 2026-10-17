"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OperationType = exports.auth = exports.db = exports.app = exports.isFirebaseStorageConfigured = exports.isFirebaseConfigured = exports.firebaseConfig = void 0;
exports.onAuthStateChanged = onAuthStateChanged;
exports.signOut = signOut;
exports.testConnection = testConnection;
exports.handleFirestoreError = handleFirestoreError;
const app_1 = require("firebase/app");
const auth_1 = require("firebase/auth");
const firestore_1 = require("firebase/firestore");
// Multi-environment safe reference to prevent Node-based CLI test crashes (where import.meta.env is undefined)
const env = (typeof import.meta !== 'undefined' && import.meta.env)
    ? import.meta.env
    : (typeof globalThis !== 'undefined' && 'process' in globalThis)
        ? globalThis.process.env || {}
        : {};
// Authoritative client configuration: environment variables only to guarantee a single runtime configuration authority.
// All keys are browser-safe.
exports.firebaseConfig = {
    apiKey: env.VITE_FIREBASE_API_KEY || "",
    projectId: env.VITE_FIREBASE_PROJECT_ID || "",
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "",
    appId: env.VITE_FIREBASE_APP_ID || "",
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "",
};
// Detect whether a valid, non-blank configuration exists
exports.isFirebaseConfigured = !!(exports.firebaseConfig.apiKey &&
    exports.firebaseConfig.apiKey.trim() !== "" &&
    exports.firebaseConfig.projectId &&
    exports.firebaseConfig.projectId.trim() !== "");
exports.isFirebaseStorageConfigured = !!(exports.isFirebaseConfigured &&
    exports.firebaseConfig.storageBucket &&
    exports.firebaseConfig.storageBucket.trim() !== "");
exports.app = null;
exports.db = null;
exports.auth = null;
if (exports.isFirebaseConfigured) {
    // Safe client-side initialization
    exports.app = (0, app_1.getApps)().length === 0 ? (0, app_1.initializeApp)(exports.firebaseConfig) : (0, app_1.getApp)();
    exports.db = (0, firestore_1.getFirestore)(exports.app);
    exports.auth = (0, auth_1.getAuth)(exports.app);
}
else {
    // UNCONFIGURED FIREBASE = INACTIVE INTEGRATION (NO FAKES/MOCKS)
    // We leave app, db, and auth as null. No simulated database or fake authentication is supplied.
    console.warn("Firebase Backend Foundation: Unconfigured. Integration remains inactive.");
}
// Wrapped onAuthStateChanged that handles safe fallback
function onAuthStateChanged(authInstance, next, error) {
    if (exports.isFirebaseConfigured && authInstance) {
        return (0, auth_1.onAuthStateChanged)(authInstance, next, error);
    }
    else {
        // Unconfigured Firebase = Inactive integration.
        // Trigger callback with null immediately to ensure the app doesn't hang in a "loading" state,
        // but do NOT emit any fake simulated user.
        next(null);
        return () => { }; // Return no-op unsubscribe function
    }
}
// Wrapped signOut that handles safe fallback
async function signOut(authInstance) {
    if (exports.isFirebaseConfigured && authInstance) {
        await (0, auth_1.signOut)(authInstance);
    }
    else {
        // No-op for inactive integration
    }
}
// Test connection on application boot (Critical Constraint)
async function testConnection() {
    if (!exports.isFirebaseConfigured) {
        console.warn("Firebase configuration is blank. Remote database connection skipped.");
        return;
    }
    try {
        await (0, firestore_1.getDocFromServer)((0, firestore_1.doc)(exports.db, 'test', 'connection'));
    }
    catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
            console.error("Please check your Firebase configuration.");
        }
    }
}
// -----------------------------------------------------------------------------
// SECURE FIRESTORE ERROR HANDLING GATEWAY
// -----------------------------------------------------------------------------
exports.OperationType = {
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete',
    LIST: 'list',
    GET: 'get',
    WRITE: 'write',
};
function handleFirestoreError(error, operationType, path) {
    const errInfo = {
        error: error instanceof Error ? error.message : String(error),
        authInfo: {
            userId: exports.auth?.currentUser?.uid || null,
        },
        operationType,
        path
    };
    // Internal diagnostic logging retains full details safely for server/console inspection
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    // The outward thrown Error is strictly bounded and stripped of internal path, UID, or raw error string
    throw new Error('FIRESTORE_ACCESS_ERROR: Database operation failed. Details redacted for security.');
}
//# sourceMappingURL=firebase.js.map