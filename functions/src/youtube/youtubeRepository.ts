import type { YouTubeIntegrationConfig, YouTubeImportCandidate, CandidateLifecycleStatus } from '../types/youtube';

export interface YouTubeRepository {
  getConfiguration(id?: string): Promise<YouTubeIntegrationConfig | null>;
  saveConfiguration(config: YouTubeIntegrationConfig): Promise<YouTubeIntegrationConfig>;
  getCandidate(id: string): Promise<YouTubeImportCandidate | null>;
  saveCandidate(candidate: YouTubeImportCandidate): Promise<YouTubeImportCandidate>;
  listCandidates(filter?: { status?: CandidateLifecycleStatus }): Promise<YouTubeImportCandidate[]>;
}
