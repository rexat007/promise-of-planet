import {
  CANONICAL_CATEGORIES,
  type Category,
  isCanonicalCategory,
  type Tag,
} from '../shared/contentContract';

export {
  CANONICAL_CATEGORIES,
  type Category,
  isCanonicalCategory,
  type Tag,
};

export type CandidateLifecycleStatus = 'PendingReview' | 'Accepted' | 'Rejected';

export interface CandidateSourceSnapshot {
  sourceTitle: string;
  sourceDescription: string;
  sourceThumbnailUrl: string;
  youtubePublishedAt: string;
}

export interface CandidateEditorialDraft {
  titleAr: string;
  titleEn?: string;
  excerptAr: string;
  excerptEn?: string;
  editorialDescriptionAr: string;
  editorialDescriptionEn?: string;
  category?: Category; // Unset until human editorial review
  tags: Tag[];
}

export interface YouTubeImportCandidate {
  id: string; // Derived deterministically: "youtube_" + externalVideoId
  provider: 'YouTube';
  externalVideoId: string;
  sourceSnapshot: CandidateSourceSnapshot;
  editorialDraft: CandidateEditorialDraft;
  status: CandidateLifecycleStatus;
  candidateVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface YouTubeIntegrationConfig {
  id: string; // Singleton ID e.g., "youtube-primary"
  channelId: string;
  enabled: boolean; // toggle to administratively enable/disable YouTube integration functionality
  updatedAt: string;
  version: number;
}

export interface YouTubeFetchResult {
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  skippedTerminal: number;
  nextPageToken?: string;
}

export interface YouTubePlaylist {
  id: string; // YouTube playlist ID
  title: string;
  description: string;
  thumbnailUrl: string;
  itemCount: number;
  publishedAt: string;
}

export interface YouTubePlaylistItemWithDetails {
  videoId: string;
  playlistItemId?: string;
  position?: number;
  addedToPlaylistAt?: string;
}

export interface YouTubePlaylistSyncResult {
  playlistsDiscovered: number;
  playlistsCreated: number;
  playlistsUpdated: number;
  videosIngested: number;
  itemsAssociated: number;
}

