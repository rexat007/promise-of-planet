"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlatformSettingsAdminClient = void 0;
const functions_1 = require("firebase/functions");
const firebase_1 = require("./firebase");
function getFunctionsInstance() {
    if (!firebase_1.isFirebaseConfigured || !firebase_1.app) {
        throw new Error('BACKEND_UNCONFIGURED: Firebase backend is not configured in client environment.');
    }
    if (!firebase_1.auth?.currentUser) {
        throw new Error('UNAUTHENTICATED: Authentication required. Platform settings management requires an authenticated Admin user session.');
    }
    return (0, functions_1.getFunctions)(firebase_1.app);
}
exports.PlatformSettingsAdminClient = {
    isBackendAvailable() {
        return firebase_1.isFirebaseConfigured && !!firebase_1.app;
    },
    isAuthenticated() {
        return !!(firebase_1.isFirebaseConfigured && firebase_1.auth?.currentUser);
    },
    /**
     * Retrieves canonical settings document from server.
     */
    async get() {
        const fns = getFunctionsInstance();
        const callable = (0, functions_1.httpsCallable)(fns, 'managePlatformSettings');
        const res = await callable({ action: 'get' });
        return res.data?.settings ?? null;
    },
    /**
     * Initializes settings from defaults if not already present.
     * Requires ManageSettings permission.
     */
    async initializeFromDefaults() {
        const fns = getFunctionsInstance();
        const callable = (0, functions_1.httpsCallable)(fns, 'managePlatformSettings');
        const res = await callable({ action: 'initializeFromDefaults' });
        return res.data;
    },
    /**
     * Applies partial updates to canonical platform settings.
     * Requires ManageSettings permission.
     */
    async update(input) {
        const fns = getFunctionsInstance();
        const callable = (0, functions_1.httpsCallable)(fns, 'managePlatformSettings');
        const res = await callable({ action: 'update', input });
        return res.data;
    },
};
//# sourceMappingURL=platformSettingsAdminClient.js.map