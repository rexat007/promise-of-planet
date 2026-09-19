import type { YouTubeRepository } from './youtubeRepository';
import { FirestoreYouTubeRepository } from './firestoreYouTubeRepository';
import type { YouTubeClient } from './youtubeClient';
import { RealYouTubeClient } from './realYouTubeClient';
import type {
  YouTubeIntegrationConfig,
  YouTubeImportCandidate,
  CandidateSourceSnapshot,
  CandidateEditorialDraft,
  CandidateLifecycleStatus,
  YouTubeFetchResult,
} from '../types/youtube';

export class YoutubeApplicationService {
  private repository: YouTubeRepository;
  private client: YouTubeClient;

  constructor(repository?: YouTubeRepository, client?: YouTubeClient) {
    this.repository = repository || new FirestoreYouTubeRepository();
    this.client = client || new RealYouTubeClient();
  }

  // ---------------------------------------------------------------------------
  // 1. YouTube Integration Configuration
  // ---------------------------------------------------------------------------

  public async getConfiguration(id: string = 'youtube-primary'): Promise<YouTubeIntegrationConfig | null> {
    return this.repository.getConfiguration(id);
  }

  public async updateConfiguration(input: {
    id?: string;
    channelId: string;
    enabled: boolean;
    version: number;
  }): Promise<YouTubeIntegrationConfig> {
    if (!input.channelId || input.channelId.trim() === '') {
      throw new Error('Invalid Configuration: channelId is required');
    }

    const id = input.id || 'youtube-primary';
    const existing = await this.repository.getConfiguration(id);

    if (existing && existing.version !== input.version) {
      throw new Error('Concurrency Conflict: Stale configuration version detected');
    }

    const nextVersion = (existing?.version || 0) + 1;
    const configRecord: YouTubeIntegrationConfig = {
      id,
      channelId: input.channelId,
      enabled: input.enabled,
      updatedAt: new Date().toISOString(),
      version: nextVersion,
    };

    return this.repository.saveConfiguration(configRecord);
  }

  // ---------------------------------------------------------------------------
  // 2. YouTube Import Candidate Ingestion & Lifecycle
  // ---------------------------------------------------------------------------

  public async getCandidate(id: string): Promise<YouTubeImportCandidate | null> {
    return this.repository.getCandidate(id);
  }

  public async listCandidates(filter?: { status?: CandidateLifecycleStatus }): Promise<YouTubeImportCandidate[]> {
    return this.repository.listCandidates(filter);
  }


  /**
   * Secure Server Fetch & Candidate Ingestion Engine
   */
  public async fetchChannelUploads(input?: {
    pageToken?: string;
    maxResults?: number;
  }): Promise<YouTubeFetchResult> {
    const config = await this.repository.getConfiguration('youtube-primary');

    if (!config) {
      throw new Error('Configuration missing: youtube-primary is not initialized');
    }

    if (!config.enabled) {
      throw new Error('YouTube integration is disabled');
    }

    if (!config.channelId || config.channelId.trim() === '') {
      throw new Error('Invalid Configuration: channelId is required');
    }

    // 1. Resolve channel's uploads playlist ID
    const uploadsPlaylistId = await this.client.getUploadsPlaylistId(config.channelId);

    // 2. Fetch playlist items (default 25 newest videos)
    const playlistPage = await this.client.getPlaylistItems(
      uploadsPlaylistId,
      input?.pageToken,
      input?.maxResults || 25
    );

    const videoIds = playlistPage.items.map((item) => item.videoId);
    if (videoIds.length === 0) {
      return {
        fetched: 0,
        created: 0,
        updated: 0,
        unchanged: 0,
        skippedTerminal: 0,
        nextPageToken: playlistPage.nextPageToken,
      };
    }

    // 3. Batch fetch video details
    const fetchedVideos = await this.client.getVideoDetailsBatch(videoIds);

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let skippedTerminal = 0;

    // 4. Normalize and upsert candidates
    for (const fetchedVideo of fetchedVideos) {
      const snapshot: CandidateSourceSnapshot = {
        sourceTitle: fetchedVideo.sourceTitle,
        sourceDescription: fetchedVideo.sourceDescription,
        sourceThumbnailUrl: fetchedVideo.sourceThumbnailUrl,
        youtubePublishedAt: fetchedVideo.youtubePublishedAt,
      };

      const candidateId = `youtube_${fetchedVideo.externalVideoId}`;
      const existing = await this.repository.getCandidate(candidateId);

      if (existing && (existing.status === 'Accepted' || existing.status === 'Rejected')) {
        skippedTerminal++;
        continue;
      }

      if (existing) {
        const sourceHasChanged =
          existing.sourceSnapshot.sourceTitle !== snapshot.sourceTitle ||
          existing.sourceSnapshot.sourceDescription !== snapshot.sourceDescription ||
          existing.sourceSnapshot.sourceThumbnailUrl !== snapshot.sourceThumbnailUrl ||
          existing.sourceSnapshot.youtubePublishedAt !== snapshot.youtubePublishedAt;

        if (!sourceHasChanged) {
          unchanged++;
        } else {
          const updatedCandidate: YouTubeImportCandidate = {
            ...existing,
            sourceSnapshot: { ...snapshot },
            candidateVersion: existing.candidateVersion + 1,
            updatedAt: new Date().toISOString(),
          };
          await this.repository.saveCandidate(updatedCandidate);
          updated++;
        }
      } else {
        const newCandidate: YouTubeImportCandidate = {
          id: candidateId,
          provider: 'YouTube',
          externalVideoId: fetchedVideo.externalVideoId,
          sourceSnapshot: { ...snapshot },
          editorialDraft: {
            titleAr: snapshot.sourceTitle,
            titleEn: '',
            excerptAr:
              snapshot.sourceDescription.substring(0, 150) +
              (snapshot.sourceDescription.length > 150 ? '...' : ''),
            excerptEn: '',
            editorialDescriptionAr: snapshot.sourceDescription,
            editorialDescriptionEn: '',
            category: undefined, // Unset until human review
            tags: [],
          },
          status: 'PendingReview',
          candidateVersion: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await this.repository.saveCandidate(newCandidate);
        created++;
      }
    }

    return {
      fetched: fetchedVideos.length,
      created,
      updated,
      unchanged,
      skippedTerminal,
      nextPageToken: playlistPage.nextPageToken,
    };
  }

  public async saveCandidateFromSource(
    snapshot: CandidateSourceSnapshot,
    externalVideoId: string
  ): Promise<YouTubeImportCandidate> {
    const id = `youtube_${externalVideoId}`;
    const existing = await this.repository.getCandidate(id);

    // Terminal state lock: Accepted and Rejected are terminal and cannot be reopened by ingestion
    if (existing && (existing.status === 'Accepted' || existing.status === 'Rejected')) {
      return existing;
    }

    let nextVersion = 1;
    let currentLifecycle: CandidateLifecycleStatus = 'PendingReview';
    let currentEditorialDraft: CandidateEditorialDraft;

    if (existing) {
      currentEditorialDraft = { ...existing.editorialDraft };

      const sourceHasChanged =
        existing.sourceSnapshot.sourceTitle !== snapshot.sourceTitle ||
        existing.sourceSnapshot.sourceDescription !== snapshot.sourceDescription ||
        existing.sourceSnapshot.sourceThumbnailUrl !== snapshot.sourceThumbnailUrl ||
        existing.sourceSnapshot.youtubePublishedAt !== snapshot.youtubePublishedAt;

      if (sourceHasChanged) {
        nextVersion = existing.candidateVersion + 1;
      } else {
        nextVersion = existing.candidateVersion;
      }
    } else {
      currentEditorialDraft = {
        titleAr: snapshot.sourceTitle,
        titleEn: '',
        excerptAr:
          snapshot.sourceDescription.substring(0, 150) +
          (snapshot.sourceDescription.length > 150 ? '...' : ''),
        excerptEn: '',
        editorialDescriptionAr: snapshot.sourceDescription,
        editorialDescriptionEn: '',
        category: undefined,
        tags: [],
      };
    }

    const candidateRecord: YouTubeImportCandidate = {
      id,
      provider: 'YouTube',
      externalVideoId,
      sourceSnapshot: { ...snapshot },
      editorialDraft: currentEditorialDraft,
      status: currentLifecycle,
      candidateVersion: nextVersion,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return this.repository.saveCandidate(candidateRecord);
  }

  public async updateEditorialDraft(
    id: string,
    updates: Partial<CandidateEditorialDraft>
  ): Promise<YouTubeImportCandidate> {
    const candidate = await this.repository.getCandidate(id);
    if (!candidate) throw new Error('Candidate not found');

    if (candidate.status !== 'PendingReview') {
      throw new Error(`Invalid State: Candidate cannot be edited in terminal state '${candidate.status}'`);
    }

    const hasChanges = Object.keys(updates).some((key) => {
      const k = key as keyof CandidateEditorialDraft;
      if (k === 'tags') {
        return JSON.stringify(candidate.editorialDraft.tags) !== JSON.stringify(updates.tags);
      }
      return candidate.editorialDraft[k] !== updates[k];
    });

    let nextVersion = candidate.candidateVersion;
    if (hasChanges) {
      nextVersion = candidate.candidateVersion + 1;
    }

    const updatedDraft: CandidateEditorialDraft = {
      ...candidate.editorialDraft,
      ...updates,
    };

    const updatedCandidate: YouTubeImportCandidate = {
      ...candidate,
      editorialDraft: updatedDraft,
      candidateVersion: nextVersion,
      updatedAt: new Date().toISOString(),
    };

    return this.repository.saveCandidate(updatedCandidate);
  }

  public async rejectCandidate(id: string, reviewedVersion: number): Promise<YouTubeImportCandidate> {
    const candidate = await this.repository.getCandidate(id);
    if (!candidate) throw new Error('Candidate not found');

    if (candidate.status !== 'PendingReview') {
      throw new Error('Invalid Transition: Candidate is already in a terminal state');
    }

    if (candidate.candidateVersion !== reviewedVersion) {
      throw new Error('Stale Review: The candidate material was updated since review began');
    }

    const rejectedCandidate: YouTubeImportCandidate = {
      ...candidate,
      status: 'Rejected',
      updatedAt: new Date().toISOString(),
    };

    return this.repository.saveCandidate(rejectedCandidate);
  }

  public async acceptCandidate(
    id: string,
    reviewedVersion: number,
    mediaRegisterFn?: (candidate: YouTubeImportCandidate) => void
  ): Promise<YouTubeImportCandidate> {
    const candidate = await this.repository.getCandidate(id);
    if (!candidate) throw new Error('Candidate not found');

    if (candidate.status !== 'PendingReview') {
      throw new Error('Invalid Transition: Candidate is already in a terminal state');
    }

    if (candidate.candidateVersion !== reviewedVersion) {
      throw new Error('Stale Review: The candidate material was updated since review began');
    }

    if (!candidate.editorialDraft.category) {
      throw new Error('Invalid Draft: Canonical Category must be assigned by a human editor before acceptance');
    }

    if (mediaRegisterFn) {
      mediaRegisterFn(candidate);
    }

    const acceptedCandidate: YouTubeImportCandidate = {
      ...candidate,
      status: 'Accepted',
      updatedAt: new Date().toISOString(),
    };

    return this.repository.saveCandidate(acceptedCandidate);
  }
}
