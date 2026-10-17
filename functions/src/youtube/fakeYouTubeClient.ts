import type {
  YouTubeClient,
  YouTubeFetchedVideo,
  YouTubePlaylistPage,
} from './youtubeClient';

export class FakeYouTubeClient implements YouTubeClient {
  public channels: Record<string, string> = {}; // channelId -> uploadsPlaylistId
  public playlists: Record<string, { items: string[]; nextPageToken?: string }> = {}; // uploadsPlaylistId -> videoIds & token
  public videos: Record<string, YouTubeFetchedVideo> = {}; // videoId -> details

  // Simulated error triggers
  public shouldFailWithApiKeyError = false;
  public shouldFailWithQuotaError = false;
  public shouldFailWithChannelNotFound = false;
  public shouldFailWithUploadsMissing = false;
  public shouldFailWithMalformed = false;

  public callCounts = {
    getUploadsPlaylistId: 0,
    getPlaylistItems: 0,
    getVideoDetailsBatch: 0,
  };

  public resetCalls(): void {
    this.callCounts.getUploadsPlaylistId = 0;
    this.callCounts.getPlaylistItems = 0;
    this.callCounts.getVideoDetailsBatch = 0;
  }

  public async getUploadsPlaylistId(channelId: string): Promise<string> {
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

  public async getPlaylistItems(
    uploadsPlaylistId: string,
    _pageToken?: string,
    maxResults = 25
  ): Promise<YouTubePlaylistPage> {
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

  public async getVideoDetailsBatch(videoIds: string[]): Promise<YouTubeFetchedVideo[]> {
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

    const result: YouTubeFetchedVideo[] = [];
    for (const id of videoIds) {
      if (this.videos[id]) {
        result.push({ ...this.videos[id] });
      }
    }
    return result;
  }

  // Channel playlists fixture mapping: channelId -> YouTubePlaylist[]
  public channelPlaylists: Record<string, import('../types/youtube').YouTubePlaylist[]> = {};
  // Playlist membership fixture mapping: playlistId -> { items: YouTubePlaylistItemWithDetails[]; nextPageToken?: string }
  public playlistMemberships: Record<string, { items: import('../types/youtube').YouTubePlaylistItemWithDetails[]; nextPageToken?: string }> = {};

  public async getChannelPlaylists(
    channelId: string,
    maxResults = 20
  ): Promise<import('../types/youtube').YouTubePlaylist[]> {
    if (this.shouldFailWithApiKeyError) {
      throw new Error('YouTube API key missing or invalid');
    }
    if (this.shouldFailWithQuotaError) {
      throw new Error('YouTube API quota exceeded');
    }
    if (this.shouldFailWithChannelNotFound || !channelId) {
      throw new Error(`YouTube Channel not found or invalid: ${channelId}`);
    }

    const list = this.channelPlaylists[channelId] || [];
    return list.slice(0, maxResults);
  }

  public async getPlaylistMemberships(
    playlistId: string,
    _pageToken?: string,
    maxResults = 50
  ): Promise<{ items: import('../types/youtube').YouTubePlaylistItemWithDetails[]; nextPageToken?: string }> {
    if (this.shouldFailWithApiKeyError) {
      throw new Error('YouTube API key missing or invalid');
    }
    if (this.shouldFailWithQuotaError) {
      throw new Error('YouTube API quota exceeded');
    }
    if (!playlistId) {
      throw new Error('Invalid playlistId: Playlist ID cannot be empty');
    }

    const res = this.playlistMemberships[playlistId];
    if (!res) {
      return { items: [] };
    }

    return {
      items: res.items.slice(0, maxResults),
      nextPageToken: res.nextPageToken,
    };
  }
}

