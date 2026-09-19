import type { YouTubeRepository } from './youtubeRepository';
import { FirestoreYouTubeRepository } from './firestoreYouTubeRepository';
import type {
  YouTubeIntegrationConfig,
  YouTubeImportCandidate,
  CandidateSourceSnapshot,
  CandidateEditorialDraft,
  CandidateLifecycleStatus,
} from '../types/youtube';

export class YoutubeApplicationService {
  private repository: YouTubeRepository;

  constructor(repository?: YouTubeRepository) {
    // Defaults to server production Firestore repository when no explicit repo is injected
    this.repository = repository || new FirestoreYouTubeRepository();
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
  // 2. YouTube Import Candidate Lifecycle
  // ---------------------------------------------------------------------------

  public async getCandidate(id: string): Promise<YouTubeImportCandidate | null> {
    return this.repository.getCandidate(id);
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
        category: 'Climate',
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
