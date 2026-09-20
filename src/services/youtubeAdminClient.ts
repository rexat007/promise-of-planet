import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth, isFirebaseConfigured } from './firebase';
import type { Video } from '../types';
import type {
  YouTubeIntegrationConfig,
  YouTubeImportCandidate,
  YouTubeFetchResult,
  CandidateEditorialDraft,
  CandidateLifecycleStatus
} from '../types/youtube';

/**
 * Ensures the Firebase backend and authentication session are truthfully active.
 * Throws explicit, descriptive errors if called when unconfigured or unauthenticated.
 */
function getFunctionsInstance() {
  if (!isFirebaseConfigured || !app) {
    throw new Error('BACKEND_UNCONFIGURED: Firebase backend is not configured in client environment. Live YouTube integration requires active Firebase provisioning.');
  }
  if (!auth?.currentUser) {
    throw new Error('UNAUTHENTICATED: Authentication required. Live YouTube management requires an authenticated Admin user session.');
  }
  return getFunctions(app);
}

/**
 * Client service boundary for YouTube Admin operations.
 * Communicates strictly with authenticated server callable functions.
 * Browser never inspects or receives secrets, never writes to candidates directly,
 * and never bypasses RBAC or authentication.
 */
export const YouTubeAdminClient = {
  isBackendAvailable(): boolean {
    return isFirebaseConfigured && !!app;
  },

  isAuthenticated(): boolean {
    return !!(isFirebaseConfigured && auth?.currentUser);
  },

  async getConfig(): Promise<YouTubeIntegrationConfig | null> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string }, { config: YouTubeIntegrationConfig | null }>(
      fns,
      'manageYouTubeIntegration'
    );
    const res = await callable({ action: 'getConfig' });
    return res.data?.config ?? null;
  },

  async updateConfig(params: { channelId: string; enabled: boolean; version: number }): Promise<YouTubeIntegrationConfig> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<
      { action: string; channelId: string; enabled: boolean; version: number },
      { config: YouTubeIntegrationConfig }
    >(fns, 'manageYouTubeIntegration');
    const res = await callable({
      action: 'updateConfig',
      channelId: params.channelId,
      enabled: params.enabled,
      version: params.version,
    });
    return res.data.config;
  },

  async listCandidates(status: CandidateLifecycleStatus = 'PendingReview'): Promise<YouTubeImportCandidate[]> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<
      { action: string; status?: CandidateLifecycleStatus },
      { candidates: YouTubeImportCandidate[] }
    >(fns, 'manageYouTubeIntegration');
    const res = await callable({ action: 'listCandidates', status });
    return res.data?.candidates ?? [];
  },

  async syncUploads(pageToken?: string): Promise<YouTubeFetchResult> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ pageToken?: string }, YouTubeFetchResult>(
      fns,
      'syncYouTubeUploads'
    );
    const res = await callable({ pageToken });
    return res.data;
  },

  async updateEditorialDraft(
    candidateId: string,
    editorialDraft: Partial<CandidateEditorialDraft>
  ): Promise<YouTubeImportCandidate> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<
      { action: string; candidateId: string; editorialDraft: Partial<CandidateEditorialDraft> },
      { candidate: YouTubeImportCandidate }
    >(fns, 'reviewYouTubeCandidate');
    const res = await callable({
      action: 'updateDraft',
      candidateId,
      editorialDraft,
    });
    return res.data.candidate;
  },

  async rejectCandidate(
    candidateId: string,
    reviewedVersion: number
  ): Promise<YouTubeImportCandidate> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<
      { action: string; candidateId: string; reviewedVersion: number },
      { candidate: YouTubeImportCandidate }
    >(fns, 'reviewYouTubeCandidate');
    const res = await callable({
      action: 'reject',
      candidateId,
      reviewedVersion,
    });
    return res.data.candidate;
  },

  async acceptCandidate(
    candidateId: string,
    reviewedVersion: number
  ): Promise<{ candidate: YouTubeImportCandidate; video: Video }> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<
      { action: string; candidateId: string; reviewedVersion: number },
      { candidate: YouTubeImportCandidate; video: Video }
    >(fns, 'reviewYouTubeCandidate');
    const res = await callable({
      action: 'accept',
      candidateId,
      reviewedVersion,
    });
    return res.data;
  },
};
