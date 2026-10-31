import type { YouTubeRepository } from './youtubeRepository';
import type { YouTubeClient } from './youtubeClient';
import type { MediaRepository } from '../media/mediaRepository';
import type {
  YouTubeIntegrationConfig,
  YouTubeImportCandidate,
  CandidateSourceSnapshot,
  CandidateEditorialDraft,
  CandidateLifecycleStatus,
  YouTubeFetchResult,
  YouTubePlaylistSyncResult,
} from '../types/youtube';

export const YOUTUBE_SYNC_DIAGNOSTIC_STAGES = [
  'CONFIG_READ',
  'CONFIG_VALIDATE',
  'UPLOADS_PLAYLIST_LOOKUP',
  'PLAYLIST_ITEMS_FETCH',
  'VIDEO_DETAILS_FETCH',
  'CANDIDATE_READ',
  'CANDIDATE_CREATE',
  'CANDIDATE_UPDATE',
] as const;

export type YouTubeSyncDiagnosticStage = (typeof YOUTUBE_SYNC_DIAGNOSTIC_STAGES)[number];

const DIAGNOSTIC_STAGE_SYMBOL = Symbol.for('pop.youtube.sync.diagnosticStage');

export function isYouTubeSyncDiagnosticStage(value: unknown): value is YouTubeSyncDiagnosticStage {
  return (
    typeof value === 'string' &&
    (YOUTUBE_SYNC_DIAGNOSTIC_STAGES as readonly string[]).includes(value)
  );
}

export class YouTubeSyncStageError extends Error {
  public readonly diagnosticStage: YouTubeSyncDiagnosticStage;
  public readonly cause?: unknown;

  constructor(message: string, stage: YouTubeSyncDiagnosticStage, cause?: unknown) {
    super(message);
    this.name = 'YouTubeSyncStageError';
    this.diagnosticStage = stage;
    this.cause = cause;
    Object.defineProperty(this, DIAGNOSTIC_STAGE_SYMBOL, {
      value: stage,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
}

export function extractYouTubeSyncStage(err: unknown): YouTubeSyncDiagnosticStage | null {
  if (!err || typeof err !== 'object') {
    return null;
  }
  const record = err as Record<string | symbol, unknown>;
  const symbolStage = record[DIAGNOSTIC_STAGE_SYMBOL];
  if (isYouTubeSyncDiagnosticStage(symbolStage)) {
    return symbolStage;
  }
  const propStage = record.diagnosticStage ?? record.stage;
  if (isYouTubeSyncDiagnosticStage(propStage)) {
    return propStage;
  }
  if (record.cause && record.cause !== err) {
    return extractYouTubeSyncStage(record.cause);
  }
  return null;
}

export function attachYouTubeSyncStage(err: unknown, stage: YouTubeSyncDiagnosticStage): Error {
  const existingStage = extractYouTubeSyncStage(err);
  const resolvedStage = existingStage ?? stage;

  if (err instanceof Error) {
    if (!existingStage) {
      try {
        Object.defineProperty(err, DIAGNOSTIC_STAGE_SYMBOL, {
          value: resolvedStage,
          enumerable: false,
          configurable: true,
          writable: false,
        });
        Object.defineProperty(err, 'diagnosticStage', {
          value: resolvedStage,
          enumerable: false,
          configurable: true,
          writable: false,
        });
        return err;
      } catch {
        return new YouTubeSyncStageError(err.message, resolvedStage, err);
      }
    }
    return err;
  }

  const fallbackMessage = typeof err === 'string' ? err : 'YouTube synchronization failed';
  return new YouTubeSyncStageError(fallbackMessage, resolvedStage, err);
}

export class YoutubeApplicationService {
  private repository: YouTubeRepository;
  private client: YouTubeClient;
  private mediaRepository?: MediaRepository;

  constructor(repository?: YouTubeRepository, client?: YouTubeClient, mediaRepository?: MediaRepository) {
    if (repository) {
      this.repository = repository;
    } else {
      // Lazy load only when default production instantiation is needed
      const { FirestoreYouTubeRepository } = require('./firestoreYouTubeRepository');
      this.repository = new FirestoreYouTubeRepository();
    }

    if (client) {
      this.client = client;
    } else {
      const { RealYouTubeClient } = require('./realYouTubeClient');
      this.client = new RealYouTubeClient();
    }

    if (mediaRepository) {
      this.mediaRepository = mediaRepository;
    }
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
    let currentStage: YouTubeSyncDiagnosticStage = 'CONFIG_READ';

    try {
      const config = await this.repository.getConfiguration('youtube-primary');

      currentStage = 'CONFIG_VALIDATE';
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
      currentStage = 'UPLOADS_PLAYLIST_LOOKUP';
      const uploadsPlaylistId = await this.client.getUploadsPlaylistId(config.channelId);

      // 2. Fetch playlist items (default 25 newest videos)
      currentStage = 'PLAYLIST_ITEMS_FETCH';
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
      currentStage = 'VIDEO_DETAILS_FETCH';
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
        currentStage = 'CANDIDATE_READ';
        const existing = await this.repository.getCandidate(candidateId);

        if (existing && (existing.status === 'Accepted' || existing.status === 'Rejected')) {
          skippedTerminal++;
          continue;
        }

        if (existing) {
          currentStage = 'CANDIDATE_UPDATE';
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
          currentStage = 'CANDIDATE_CREATE';
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
    } catch (err: unknown) {
      throw attachYouTubeSyncStage(err, currentStage);
    }
  }

  /**
   * Channel Playlist Discovery & Synchronization Engine
   * Discovers official playlists, retrieves paginated memberships,
   * dedupes videos, ingests candidates into PendingReview, and records
   * canonical playlist associations.
   */
  public async syncChannelPlaylists(input?: { maxResults?: number }): Promise<YouTubePlaylistSyncResult> {
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

    // 1. Discover playlists owned by the channel
    const playlists = await this.client.getChannelPlaylists(config.channelId, input?.maxResults || 20);

    let playlistsCreated = 0;
    let playlistsUpdated = 0;
    let videosIngested = 0;
    let itemsAssociated = 0;

    for (const pl of playlists) {
      const canonicalPlaylistId = `playlist_yt_${pl.id}`;
      // Retrieve memberships
      const memberships = await this.client.getPlaylistMemberships(pl.id, undefined, 50);
      const videoIds = memberships.items.map(m => m.videoId);

      // Collect video IDs that need details batch fetched
      const missingDetailsIds: string[] = [];
      for (const vid of videoIds) {
        const candidateId = `youtube_${vid}`;
        const existingCandidate = await this.repository.getCandidate(candidateId);
        if (!existingCandidate) {
          missingDetailsIds.push(vid);
        }
      }

      if (missingDetailsIds.length > 0) {
        const fetchedVideos = await this.client.getVideoDetailsBatch(missingDetailsIds);
        for (const fv of fetchedVideos) {
          const snapshot: CandidateSourceSnapshot = {
            sourceTitle: fv.sourceTitle,
            sourceDescription: fv.sourceDescription,
            sourceThumbnailUrl: fv.sourceThumbnailUrl,
            // Original publication timestamp from video details, NOT playlist item addition
            youtubePublishedAt: fv.youtubePublishedAt,
          };
          await this.saveCandidateFromSource(snapshot, fv.externalVideoId);
          videosIngested++;
        }
      }

      // Map to canonical video IDs (e.g. video_yt_${vid})
      const mappedVideoIds = videoIds.map(vid => `video_yt_${vid}`);
      itemsAssociated += mappedVideoIds.length;

      // Upsert playlist in media repository if available
      if (this.mediaRepository) {
        const existingPl = await this.mediaRepository.getPlaylistById(canonicalPlaylistId);
        const nowIso = new Date().toISOString();
        if (existingPl) {
          await this.mediaRepository.updatePlaylist({
            ...existingPl,
            titleAr: pl.title,
            descriptionAr: pl.description,
            thumbnailUrl: pl.thumbnailUrl || existingPl.thumbnailUrl,
            itemCount: pl.itemCount,
            videoIds: mappedVideoIds,
            updatedAt: nowIso,
          });
          playlistsUpdated++;
        } else {
          await this.mediaRepository.createPlaylist({
            id: canonicalPlaylistId,
            externalPlaylistId: pl.id,
            titleAr: pl.title,
            titleEn: undefined,
            descriptionAr: pl.description,
            descriptionEn: undefined,
            thumbnailUrl: pl.thumbnailUrl,
            itemCount: pl.itemCount,
            status: 'Published',
            videoIds: mappedVideoIds,
            createdAt: nowIso,
            updatedAt: nowIso,
          });
          playlistsCreated++;
        }
      }
    }

    return {
      playlistsDiscovered: playlists.length,
      playlistsCreated,
      playlistsUpdated,
      videosIngested,
      itemsAssociated,
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
