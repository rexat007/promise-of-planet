"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RealYouTubeClient = void 0;
const youtubeSecrets_1 = require("./youtubeSecrets");
class RealYouTubeClient {
    apiKeyProvider;
    constructor(apiKeyProvider = youtubeSecrets_1.defaultProductionApiKeyProvider) {
        this.apiKeyProvider = apiKeyProvider;
    }
    getApiKey() {
        let key;
        try {
            key = this.apiKeyProvider();
        }
        catch (e) {
            throw new Error(`YouTube API key missing: YOUTUBE_API_KEY secret is not configured (${e?.message || 'Secret missing'})`);
        }
        if (!key || key.trim() === '') {
            throw new Error('YouTube API key missing: YOUTUBE_API_KEY secret is not configured');
        }
        return key.trim();
    }
    sanitizeError(err) {
        const rawMsg = err instanceof Error ? err.message : String(err);
        let key;
        try {
            key = this.apiKeyProvider();
        }
        catch {
            // Key lookup may fail if secret uninitialized
        }
        let safeMsg = rawMsg;
        if (key && key.trim() !== '') {
            safeMsg = safeMsg.split(key.trim()).join('[REDACTED_KEY]');
        }
        // Also strip key query parameter patterns if present
        safeMsg = safeMsg.replace(/key=[a-zA-Z0-9_-]+/g, 'key=[REDACTED_KEY]');
        return new Error(safeMsg);
    }
    async fetchWithRetry(url, attempts = 2) {
        let lastError;
        for (let i = 0; i < attempts; i++) {
            try {
                const response = await fetch(url);
                if (response.ok) {
                    return response;
                }
                if (response.status >= 500 && i < attempts - 1) {
                    // Brief backoff before transient 5xx retry
                    await new Promise((r) => setTimeout(r, 200));
                    continue;
                }
                if (response.status === 403) {
                    throw new Error('YouTube API authorization or quota error (403)');
                }
                if (response.status === 404) {
                    throw new Error('Requested YouTube resource not found (404)');
                }
                throw new Error(`YouTube API HTTP error: ${response.status} ${response.statusText}`);
            }
            catch (e) {
                lastError = e;
                if (i < attempts - 1 && !(e instanceof Error && e.message.includes('403'))) {
                    await new Promise((r) => setTimeout(r, 200));
                }
                else {
                    break;
                }
            }
        }
        throw this.sanitizeError(lastError);
    }
    async getUploadsPlaylistId(channelId) {
        if (!channelId || channelId.trim() === '') {
            throw new Error('Invalid channelId: Channel ID cannot be empty');
        }
        const apiKey = this.getApiKey();
        const url = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${encodeURIComponent(channelId)}&key=${apiKey}`;
        try {
            const response = await this.fetchWithRetry(url);
            const data = (await response.json());
            if (!data || !Array.isArray(data.items) || data.items.length === 0) {
                throw new Error(`YouTube Channel not found or invalid: ${channelId}`);
            }
            const uploadsId = data.items[0]?.contentDetails?.relatedPlaylists?.uploads;
            if (!uploadsId) {
                throw new Error(`Uploads playlist missing for channel: ${channelId}`);
            }
            return uploadsId;
        }
        catch (e) {
            throw this.sanitizeError(e);
        }
    }
    async getPlaylistItems(uploadsPlaylistId, pageToken, maxResults = 25) {
        if (!uploadsPlaylistId || uploadsPlaylistId.trim() === '') {
            throw new Error('Invalid uploadsPlaylistId: Playlist ID cannot be empty');
        }
        const apiKey = this.getApiKey();
        const limit = Math.min(Math.max(maxResults, 1), 50);
        let url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${encodeURIComponent(uploadsPlaylistId)}&maxResults=${limit}&key=${apiKey}`;
        if (pageToken && pageToken.trim() !== '') {
            url += `&pageToken=${encodeURIComponent(pageToken)}`;
        }
        try {
            const response = await this.fetchWithRetry(url);
            const data = (await response.json());
            if (!data || !Array.isArray(data.items)) {
                throw new Error('Malformed YouTube playlistItems response');
            }
            const items = data.items
                .map((item) => ({
                videoId: item?.snippet?.resourceId?.videoId,
            }))
                .filter((item) => typeof item.videoId === 'string' && item.videoId.trim() !== '');
            return {
                items,
                nextPageToken: data.nextPageToken || undefined,
            };
        }
        catch (e) {
            throw this.sanitizeError(e);
        }
    }
    async getVideoDetailsBatch(videoIds) {
        if (!videoIds || videoIds.length === 0) {
            return [];
        }
        const apiKey = this.getApiKey();
        // Support batching up to 50 video IDs per request
        const batch = videoIds.slice(0, 50);
        const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(batch.join(','))}&key=${apiKey}`;
        try {
            const response = await this.fetchWithRetry(url);
            const data = (await response.json());
            if (!data || !Array.isArray(data.items)) {
                throw new Error('Malformed YouTube videos response');
            }
            return data.items.map((item) => {
                const snippet = item?.snippet || {};
                const thumbs = snippet?.thumbnails || {};
                // Deterministic thumbnail fallback order: maxres -> standard -> high -> medium -> default
                const thumbnailUrl = thumbs.maxres?.url ||
                    thumbs.standard?.url ||
                    thumbs.high?.url ||
                    thumbs.medium?.url ||
                    thumbs.default?.url ||
                    '';
                return {
                    externalVideoId: item.id,
                    sourceTitle: snippet.title || '',
                    sourceDescription: snippet.description || '',
                    sourceThumbnailUrl: thumbnailUrl,
                    youtubePublishedAt: snippet.publishedAt || new Date().toISOString(),
                };
            });
        }
        catch (e) {
            throw this.sanitizeError(e);
        }
    }
}
exports.RealYouTubeClient = RealYouTubeClient;
//# sourceMappingURL=realYouTubeClient.js.map