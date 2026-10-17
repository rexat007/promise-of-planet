"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.YouTubeAdminClient = void 0;
const functions_1 = require("firebase/functions");
const firebase_1 = require("./firebase");
/**
 * Ensures the Firebase backend and authentication session are truthfully active.
 * Throws explicit, descriptive errors if called when unconfigured or unauthenticated.
 */
function getFunctionsInstance() {
    if (!firebase_1.isFirebaseConfigured || !firebase_1.app) {
        throw new Error('BACKEND_UNCONFIGURED: Firebase backend is not configured in client environment. Live YouTube integration requires active Firebase provisioning.');
    }
    if (!firebase_1.auth?.currentUser) {
        throw new Error('UNAUTHENTICATED: Authentication required. Live YouTube management requires an authenticated Admin user session.');
    }
    return (0, functions_1.getFunctions)(firebase_1.app);
}
/**
 * Client service boundary for YouTube Admin operations.
 * Communicates strictly with authenticated server callable functions.
 * Browser never inspects or receives secrets, never writes to candidates directly,
 * and never bypasses RBAC or authentication.
 */
exports.YouTubeAdminClient = {
    isBackendAvailable() {
        return firebase_1.isFirebaseConfigured && !!firebase_1.app;
    },
    isAuthenticated() {
        return !!(firebase_1.isFirebaseConfigured && firebase_1.auth?.currentUser);
    },
    async getConfig() {
        const fns = getFunctionsInstance();
        const callable = (0, functions_1.httpsCallable)(fns, 'manageYouTubeIntegration');
        const res = await callable({ action: 'getConfig' });
        return res.data?.config ?? null;
    },
    async updateConfig(params) {
        const fns = getFunctionsInstance();
        const callable = (0, functions_1.httpsCallable)(fns, 'manageYouTubeIntegration');
        const res = await callable({
            action: 'updateConfig',
            channelId: params.channelId,
            enabled: params.enabled,
            version: params.version,
        });
        return res.data.config;
    },
    async listCandidates(status = 'PendingReview') {
        const fns = getFunctionsInstance();
        const callable = (0, functions_1.httpsCallable)(fns, 'manageYouTubeIntegration');
        const res = await callable({ action: 'listCandidates', status });
        return res.data?.candidates ?? [];
    },
    async syncUploads(pageToken) {
        const fns = getFunctionsInstance();
        const callable = (0, functions_1.httpsCallable)(fns, 'syncYouTubeUploads');
        const res = await callable({ pageToken });
        return res.data;
    },
    async updateEditorialDraft(candidateId, editorialDraft) {
        const fns = getFunctionsInstance();
        const callable = (0, functions_1.httpsCallable)(fns, 'reviewYouTubeCandidate');
        const res = await callable({
            action: 'updateDraft',
            candidateId,
            editorialDraft,
        });
        return res.data.candidate;
    },
    async rejectCandidate(candidateId, reviewedVersion) {
        const fns = getFunctionsInstance();
        const callable = (0, functions_1.httpsCallable)(fns, 'reviewYouTubeCandidate');
        const res = await callable({
            action: 'reject',
            candidateId,
            reviewedVersion,
        });
        return res.data.candidate;
    },
    async acceptCandidate(candidateId, reviewedVersion) {
        const fns = getFunctionsInstance();
        const callable = (0, functions_1.httpsCallable)(fns, 'reviewYouTubeCandidate');
        const res = await callable({
            action: 'accept',
            candidateId,
            reviewedVersion,
        });
        return res.data;
    },
    async syncPlaylists(maxResults = 20) {
        const fns = getFunctionsInstance();
        const callable = (0, functions_1.httpsCallable)(fns, 'manageYouTubeIntegration');
        const res = await callable({
            action: 'syncPlaylists',
            maxResults,
        });
        return res.data;
    },
};
//# sourceMappingURL=youtubeAdminClient.js.map