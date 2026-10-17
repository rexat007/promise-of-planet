import type { Video, ContentVideoRelation, CanonicalPlaylist } from '../types/media';

export interface MediaRepository {
  getVideoById(id: string): Promise<Video | null>;
  getVideoByYoutubeId(externalVideoId: string): Promise<Video | null>;
  createVideo(video: Video): Promise<Video>;
  updateVideo(video: Video): Promise<Video>;
  listVideos(): Promise<Video[]>;
  saveRelation(relation: ContentVideoRelation): Promise<ContentVideoRelation>;
  deleteRelation(relationId: string): Promise<boolean>;
  getRelationsForVideo(videoId: string): Promise<ContentVideoRelation[]>;
  getRelationsForContent(contentId: string): Promise<ContentVideoRelation[]>;
  getPlaylistById(id: string): Promise<CanonicalPlaylist | null>;
  createPlaylist(playlist: CanonicalPlaylist): Promise<CanonicalPlaylist>;
  updatePlaylist(playlist: CanonicalPlaylist): Promise<CanonicalPlaylist>;
  listPlaylists(): Promise<CanonicalPlaylist[]>;
}

