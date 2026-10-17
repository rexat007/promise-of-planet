"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MediaAdminClient = void 0;
const functions_1 = require("firebase/functions");
const firebase_1 = require("./firebase");
function getFunctionsInstance() {
    if (!firebase_1.isFirebaseConfigured || !firebase_1.app) {
        throw new Error('BACKEND_UNCONFIGURED: Firebase backend is not configured in client environment.');
    }
    if (!firebase_1.auth?.currentUser) {
        throw new Error('UNAUTHENTICATED: Authentication required. Live Media management requires an authenticated Admin user session.');
    }
    return (0, functions_1.getFunctions)(firebase_1.app);
}
exports.MediaAdminClient = {
    isBackendAvailable() {
        return firebase_1.isFirebaseConfigured && !!firebase_1.app;
    },
    isAuthenticated() {
        return !!(firebase_1.isFirebaseConfigured && firebase_1.auth?.currentUser);
    },
    async listAll() {
        const fns = getFunctionsInstance();
        const callable = (0, functions_1.httpsCallable)(fns, 'manageMedia');
        const res = await callable({ action: 'listAll' });
        return res.data?.videos ?? [];
    },
    async getById(id) {
        const fns = getFunctionsInstance();
        const callable = (0, functions_1.httpsCallable)(fns, 'manageMedia');
        const res = await callable({ action: 'getById', id });
        return res.data?.video ?? null;
    },
    async getRelationsForVideo(videoId) {
        const fns = getFunctionsInstance();
        const callable = (0, functions_1.httpsCallable)(fns, 'manageMedia');
        const res = await callable({ action: 'getRelationsForVideo', videoId });
        return res.data?.relations ?? [];
    },
    async register(input) {
        const fns = getFunctionsInstance();
        const callable = (0, functions_1.httpsCallable)(fns, 'manageMedia');
        const res = await callable({ action: 'register', input });
        return res.data.video;
    },
    async updateMetadata(id, updates) {
        const fns = getFunctionsInstance();
        const callable = (0, functions_1.httpsCallable)(fns, 'manageMedia');
        const res = await callable({ action: 'updateMetadata', id, updates });
        return res.data.video;
    },
    async updateRightsStatus(id, rightsStatus, notes) {
        const fns = getFunctionsInstance();
        const callable = (0, functions_1.httpsCallable)(fns, 'manageMedia');
        const res = await callable({ action: 'updateRightsStatus', id, rightsStatus, notes });
        return res.data.video;
    },
    async updateVisibilityDecision(id, visibilityDecision) {
        const fns = getFunctionsInstance();
        const callable = (0, functions_1.httpsCallable)(fns, 'manageMedia');
        const res = await callable({ action: 'updateVisibilityDecision', id, visibilityDecision });
        return res.data.video;
    },
    async linkVideoToContent(videoId, contentId, relationType, placement, options) {
        const fns = getFunctionsInstance();
        const callable = (0, functions_1.httpsCallable)(fns, 'manageMedia');
        const res = await callable({ action: 'linkVideoToContent', videoId, contentId, relationType, placement, options });
        return res.data.relation;
    },
    async unlinkVideoFromContent(videoId, contentId) {
        const fns = getFunctionsInstance();
        const callable = (0, functions_1.httpsCallable)(fns, 'manageMedia');
        const res = await callable({ action: 'unlinkVideoFromContent', videoId, contentId });
        return res.data.success;
    },
};
//# sourceMappingURL=mediaAdminClient.js.map