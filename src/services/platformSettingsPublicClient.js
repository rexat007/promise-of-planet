"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlatformSettingsPublicClient = void 0;
const firestore_1 = require("firebase/firestore");
const firebase_1 = require("./firebase");
class PlatformSettingsPublicClient {
    static COLLECTION_NAME = 'platform_settings';
    static DOCUMENT_ID = 'global';
    /**
     * Retrieves canonical public platform settings from Firestore.
     * If Firestore is not configured or document does not exist, returns isInitialized: false.
     */
    static async getSettings() {
        if (!firebase_1.isFirebaseConfigured || !firebase_1.db) {
            return {
                isBackendConfigured: false,
                isInitialized: false,
                settings: null,
            };
        }
        try {
            const docRef = (0, firestore_1.doc)(firebase_1.db, this.COLLECTION_NAME, this.DOCUMENT_ID);
            const snap = await (0, firestore_1.getDoc)(docRef);
            if (!snap.exists()) {
                return {
                    isBackendConfigured: true,
                    isInitialized: false,
                    settings: null,
                };
            }
            const data = snap.data();
            if (!data || typeof data !== 'object') {
                return {
                    isBackendConfigured: true,
                    isInitialized: false,
                    settings: null,
                    error: 'Persisted settings document is empty or malformed.',
                };
            }
            return {
                isBackendConfigured: true,
                isInitialized: true,
                settings: data,
            };
        }
        catch (e) {
            console.error('PlatformSettingsPublicClient: Error fetching public settings:', e?.message || e);
            return {
                isBackendConfigured: true,
                isInitialized: false,
                settings: null,
                error: e?.message || String(e),
            };
        }
    }
}
exports.PlatformSettingsPublicClient = PlatformSettingsPublicClient;
//# sourceMappingURL=platformSettingsPublicClient.js.map