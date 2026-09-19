import type { YouTubeRepository } from './youtubeRepository';
import type { YouTubeIntegrationConfig, YouTubeImportCandidate } from '../types/youtube';

export class InMemoryYouTubeRepository implements YouTubeRepository {
  private configs: Record<string, YouTubeIntegrationConfig> = {};
  private candidates: Record<string, YouTubeImportCandidate> = {};

  public clear(): void {
    this.configs = {};
    this.candidates = {};
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
}
