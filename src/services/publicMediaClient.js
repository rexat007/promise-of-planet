"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PublicMediaClient = void 0;
const functions_1 = require("firebase/functions");
const firebase_1 = require("./firebase");
const contentVisibility_1 = require("./contentVisibility");
class PublicMediaClient {
    /**
     * Retrieves canonically eligible public multimedia items and playlists via
     * the secure server-side Firebase v2 HTTPS function `getPublicMultimedia`.
     * Enforces fail-closed behavior on failure or unconfigured environments.
     */
    static async fetchPublicMultimedia(currentLanguage) {
        if (!firebase_1.isFirebaseConfigured || !firebase_1.app) {
            throw new Error('BACKEND_UNCONFIGURED: Firebase backend is not configured. Public multimedia requires active backend connectivity.');
        }
        try {
            const fns = (0, functions_1.getFunctions)(firebase_1.app);
            const callable = (0, functions_1.httpsCallable)(fns, 'getPublicMultimedia');
            const res = await callable();
            const data = res.data;
            const rawVideos = Array.isArray(data?.videos) ? data.videos : [];
            const rawPlaylists = Array.isArray(data?.playlists) ? data.playlists : [];
            // Double-sanitize on client side as an extra governance layer
            const eligibleVideos = rawVideos.filter(video => {
                const check = (0, contentVisibility_1.isVideoVisibleInMediaHub)(video, currentLanguage);
                return check.visible;
            });
            const eligibleVideoIds = new Set(eligibleVideos.map(v => v.id));
            const eligiblePlaylists = rawPlaylists
                .map(pl => ({
                ...pl,
                videoIds: (pl.videoIds || []).filter(id => eligibleVideoIds.has(id)),
            }))
                .filter(pl => pl.status === 'Published' && pl.videoIds.length > 0);
            return {
                videos: eligibleVideos,
                playlists: eligiblePlaylists,
            };
        }
        catch (err) {
            console.error('PublicMediaClient: Failed to fetch public multimedia from server function:', err);
            throw err; // Fail-closed: Never fallback to local mock fixtures
        }
    }
}
exports.PublicMediaClient = PublicMediaClient;
//# sourceMappingURL=publicMediaClient.js.map