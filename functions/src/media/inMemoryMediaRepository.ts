import type { MediaRepository } from './mediaRepository';
import type { Video, ContentVideoRelation } from '../types/media';

/**
 * In-memory test implementation of MediaRepository for isolated TDD test execution.
 * Explicitly injected in test suites only. Zero automatic production fallback.
 */
export class InMemoryMediaRepository implements MediaRepository {
  private videos: Record<string, Video> = {};
  private relations: Record<string, ContentVideoRelation[]> = {};

  public clear(): void {
    this.videos = {};
    this.relations = {};
  }

  async getVideoById(id: string): Promise<Video | null> {
    const v = this.videos[id];
    return v ? JSON.parse(JSON.stringify(v)) : null;
  }

  async getVideoByYoutubeId(externalVideoId: string): Promise<Video | null> {
    const v = Object.values(this.videos).find(
      video => video.youtubeSource && video.youtubeSource.youtubeVideoId === externalVideoId
    );
    return v ? JSON.parse(JSON.stringify(v)) : null;
  }

  /**
   * Atomically creates a new canonical Media document.
   * Fails with DUPLICATE_MEDIA if document already exists.
   */
  async createVideo(video: Video): Promise<Video> {
    if (this.videos[video.id]) {
      throw new Error(`DUPLICATE_MEDIA: Video with ID ${video.id} already exists`);
    }
    // Also check for duplicate externalVideoId if present
    const existingByExternal = Object.values(this.videos).find(
      v => v.youtubeSource && v.youtubeSource.youtubeVideoId === video.youtubeSource?.youtubeVideoId
    );
    if (existingByExternal) {
      throw new Error(`DUPLICATE_MEDIA: Video with YouTube ID ${video.youtubeSource?.youtubeVideoId} already exists`);
    }

    this.videos[video.id] = JSON.parse(JSON.stringify(video));
    return JSON.parse(JSON.stringify(video));
  }

  /**
   * Updates an existing canonical Media document.
   * Fails with NOT_FOUND if document does not exist.
   */
  async updateVideo(video: Video): Promise<Video> {
    if (!this.videos[video.id]) {
      throw new Error(`NOT_FOUND: Video with ID ${video.id} not found`);
    }
    this.videos[video.id] = JSON.parse(JSON.stringify(video));
    return JSON.parse(JSON.stringify(video));
  }

  async listVideos(): Promise<Video[]> {
    return Object.values(this.videos).map(v => JSON.parse(JSON.stringify(v)));
  }

  async saveRelation(relation: ContentVideoRelation): Promise<ContentVideoRelation> {
    if (!this.videos[relation.videoId]) {
      throw new Error(`Cannot save relation: Video ${relation.videoId} not found`);
    }

    const currentList = this.relations[relation.videoId] || [];
    const filtered = currentList.filter(r => r.id !== relation.id);
    filtered.push(JSON.parse(JSON.stringify(relation)));
    this.relations[relation.videoId] = filtered;

    return JSON.parse(JSON.stringify(relation));
  }

  async deleteRelation(relationId: string): Promise<boolean> {
    let found = false;
    for (const [videoId, rels] of Object.entries(this.relations)) {
      const idx = rels.findIndex(r => r.id === relationId);
      if (idx !== -1) {
        rels.splice(idx, 1);
        this.relations[videoId] = [...rels];
        found = true;
      }
    }
    return found;
  }

  async getRelationsForVideo(videoId: string): Promise<ContentVideoRelation[]> {
    const list = this.relations[videoId] || [];
    return list.map(r => JSON.parse(JSON.stringify(r)));
  }

  async getRelationsForContent(contentId: string): Promise<ContentVideoRelation[]> {
    const result: ContentVideoRelation[] = [];
    for (const rels of Object.values(this.relations)) {
      for (const r of rels) {
        if (r.contentId === contentId && r.isActive !== false) {
          result.push(JSON.parse(JSON.stringify(r)));
        }
      }
    }
    return result;
  }
}
