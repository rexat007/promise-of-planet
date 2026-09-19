"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FakeYouTubeClient = void 0;
class FakeYouTubeClient {
    channels = {}; // channelId -> uploadsPlaylistId
    playlists = {}; // uploadsPlaylistId -> videoIds & token
    videos = {}; // videoId -> details
    // Simulated error triggers
    shouldFailWithApiKeyError = false;
    shouldFailWithQuotaError = false;
    shouldFailWithChannelNotFound = false;
    shouldFailWithUploadsMissing = false;
    shouldFailWithMalformed = false;
    callCounts = {
        getUploadsPlaylistId: 0,
        getPlaylistItems: 0,
        getVideoDetailsBatch: 0,
    };
    resetCalls() {
        this.callCounts.getUploadsPlaylistId = 0;
        this.callCounts.getPlaylistItems = 0;
        this.callCounts.getVideoDetailsBatch = 0;
    }
    async getUploadsPlaylistId(channelId) {
        this.callCounts.getUploadsPlaylistId++;
        if (this.shouldFailWithApiKeyError) {
            throw new Error('YouTube API key missing or invalid');
        }
        if (this.shouldFailWithQuotaError) {
            throw new Error('YouTube API quota exceeded');
        }
        if (this.shouldFailWithChannelNotFound || !this.channels[channelId]) {
            throw new Error(`YouTube Channel not found or invalid: ${channelId}`);
        }
        if (this.shouldFailWithUploadsMissing) {
            throw new Error(`Uploads playlist missing for channel: ${channelId}`);
        }
        return this.channels[channelId];
    }
    async getPlaylistItems(uploadsPlaylistId, _pageToken, maxResults = 25) {
        this.callCounts.getPlaylistItems++;
        if (this.shouldFailWithApiKeyError) {
            throw new Error('YouTube API key missing or invalid');
        }
        if (this.shouldFailWithQuotaError) {
            throw new Error('YouTube API quota exceeded');
        }
        if (this.shouldFailWithMalformed) {
            throw new Error('Malformed YouTube playlistItems response');
        }
        const playlist = this.playlists[uploadsPlaylistId];
        if (!playlist) {
            return { items: [] };
        }
        const limit = Math.min(maxResults, 25);
        const videoIds = playlist.items.slice(0, limit);
        return {
            items: videoIds.map((id) => ({ videoId: id })),
            nextPageToken: playlist.nextPageToken,
        };
    }
    async getVideoDetailsBatch(videoIds) {
        this.callCounts.getVideoDetailsBatch++;
        if (this.shouldFailWithApiKeyError) {
            throw new Error('YouTube API key missing or invalid');
        }
        if (this.shouldFailWithQuotaError) {
            throw new Error('YouTube API quota exceeded');
        }
        if (this.shouldFailWithMalformed) {
            throw new Error('Malformed YouTube videos response');
        }
        const result = [];
        for (const id of videoIds) {
            if (this.videos[id]) {
                result.push({ ...this.videos[id] });
            }
        }
        return result;
    }
}
exports.FakeYouTubeClient = FakeYouTubeClient;
//# sourceMappingURL=fakeYouTubeClient.js.map