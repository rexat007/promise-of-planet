export interface YouTubePlaylistItem {
  videoId: string;
}

export interface YouTubeFetchedVideo {
  externalVideoId: string;
  sourceTitle: string;
  sourceDescription: string;
  sourceThumbnailUrl: string;
  youtubePublishedAt: string;
}

export interface YouTubePlaylistPage {
  items: YouTubePlaylistItem[];
  nextPageToken?: string;
}

export interface YouTubeClient {
  getUploadsPlaylistId(channelId: string): Promise<string>;
  getPlaylistItems(uploadsPlaylistId: string, pageToken?: string, maxResults?: number): Promise<YouTubePlaylistPage>;
  getVideoDetailsBatch(videoIds: string[]): Promise<YouTubeFetchedVideo[]>;
}
