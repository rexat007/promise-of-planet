import type { YouTubeRepository } from './youtubeRepository';
import type { YouTubeIntegrationConfig, YouTubeImportCandidate, CandidateLifecycleStatus } from '../types/youtube';

export class InMemoryYouTubeRepository implements YouTubeRepository {
  private configs: Record<string, YouTubeIntegrationConfig> = {};
  private candidates: Record<string, YouTubeImportCandidate> = {};

  public clear(): void {
    this.configs = {};
    this.candidates = {};
  }

  public takeSnapshot(): { configs: Record<string, YouTubeIntegrationConfig>; candidates: Record<string, YouTubeImportCandidate> } {
    return {
      configs: JSON.parse(JSON.stringify(this.configs)),
      candidates: JSON.parse(JSON.stringify(this.candidates)),
    };
  }

  public restoreSnapshot(snapshot: { configs: Record<string, YouTubeIntegrationConfig>; candidates: Record<string, YouTubeImportCandidate> }): void {
    this.configs = JSON.parse(JSON.stringify(snapshot.configs));
    this.candidates = JSON.parse(JSON.stringify(snapshot.candidates));
  }

  async getConfiguration(id: string = 'youtube-primary'): Promise<YouTubeIntegrationConfig | null> {
    return this.configs[id] ? { ...this.configs[id] } : null;
  }

  async saveConfiguration(config: YouTubeIntegrationConfig): Promise<YouTubeIntegrationConfig> {
    this.configs[config.id] = { ...config };
    return { ...config };
  }

  async getCandidate(id: string): Promise<YouTubeImportCandidate | null> {
    return this.candidates[id] ? { ...this.candidates[id] } : null;
  }

  async saveCandidate(candidate: YouTubeImportCandidate): Promise<YouTubeImportCandidate> {
    this.candidates[candidate.id] = { ...candidate };
    return { ...candidate };
  }

  async listCandidates(filter?: { status?: CandidateLifecycleStatus }): Promise<YouTubeImportCandidate[]> {
    const all = Object.values(this.candidates).map(c => ({ ...c }));
    if (filter?.status) {
      return all.filter(c => c.status === filter.status);
    }
    return all;
  }
}

