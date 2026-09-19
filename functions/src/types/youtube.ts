export type Category =
  | 'Climate'
  | 'Water'
  | 'Biodiversity'
  | 'Pollution'
  | 'Energy'
  | 'Agriculture'
  | 'EnvironmentalPolicy';

export type Tag = string;

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
