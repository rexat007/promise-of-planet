import type { Video, ContentVideoRelation } from '../types/media';

export interface MediaRepository {
  getVideoById(id: string): Promise<Video | null>;
  getVideoByYoutubeId(externalVideoId: string): Promise<Video | null>;
  saveVideo(video: Video): Promise<Video>;
  listVideos(): Promise<Video[]>;
  saveRelation(relation: ContentVideoRelation): Promise<ContentVideoRelation>;
  deleteRelation(relationId: string): Promise<boolean>;
  getRelationsForVideo(videoId: string): Promise<ContentVideoRelation[]>;
  getRelationsForContent(contentId: string): Promise<ContentVideoRelation[]>;
}
