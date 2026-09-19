import type { MediaRepository } from './mediaRepository';
import { FirestoreMediaRepository } from './firestoreMediaRepository';
import {
  type Video,
  type ContentVideoRelation,
  type RightsStatus,
  type VisibilityDecision,
  type RelationType,
  type Placement,
  isCanonicalCategory,
  isCanonicalRightsStatus,
  isCanonicalVisibilityDecision,
} from '../types/media';

export interface RegisterMediaInput {
  contentType: 'Video';
  status?: Video['status'];
  category: Video['category'];
  titleAr: string;
  titleEn?: string;
  excerptAr: string;
  excerptEn?: string;
  originalLanguage?: Video['originalLanguage'];
  availableLanguages?: Video['availableLanguages'];
  translationStatus?: Video['translationStatus'];
  author?: string;
  editor: string;
  approvalStatus?: Video['approvalStatus'];
  editorialDescriptionAr: string;
  editorialDescriptionEn?: string;
  editorialThumbnail?: Video['editorialThumbnail'];
  visibilityDecision?: VisibilityDecision;
  rightsStatus?: RightsStatus;
  tags?: string[];
  youtubeSource: Video['youtubeSource'];
  sources?: Video['sources'];
  rightsNotes?: string;
}

export interface UpdateMediaMetadataInput {
  editorialDescriptionAr?: string;
  editorialDescriptionEn?: string;
  editorialThumbnail?: Video['editorialThumbnail'];
  tags?: string[];
  titleAr?: string;
  titleEn?: string;
  excerptAr?: string;
  excerptEn?: string;
}

export class MediaApplicationService {
  private mediaRepo: MediaRepository;

  constructor(mediaRepo?: MediaRepository) {
    this.mediaRepo = mediaRepo || new FirestoreMediaRepository();
  }

  async listAll(): Promise<Video[]> {
    return this.mediaRepo.listVideos();
  }

  async getById(id: string): Promise<Video | null> {
    if (!id || typeof id !== 'string' || id.trim() === '') {
      return null;
    }
    return this.mediaRepo.getVideoById(id.trim());
  }

  /**
   * Resolves a canonical Media record by provider and external ID.
   * YouTube is the single canonical provider supported by the canonical Video schema.
   */
  async getByYoutubeId(provider: string, externalVideoId: string): Promise<Video | null> {
    if (provider !== 'YouTube') {
      return null;
    }
    if (!externalVideoId || typeof externalVideoId !== 'string' || externalVideoId.trim() === '') {
      return null;
    }
    return this.mediaRepo.getVideoByYoutubeId(externalVideoId.trim());
  }

  /**
   * Registers a new canonical Media document atomically.
   * Uses repository createVideo with create-if-absent / transactional semantics
   * to guarantee that concurrent registrations for the same deterministic ID cannot overwrite existing media.
   */
  async register(input: RegisterMediaInput): Promise<Video> {
    // 1. Enforce canonical provider and external identity
    if (!input.youtubeSource || !input.youtubeSource.youtubeVideoId || input.youtubeSource.youtubeVideoId.trim() === '') {
      throw new Error('VALIDATION_ERROR: youtubeSource with valid youtubeVideoId is required');
    }

    const externalVideoId = input.youtubeSource.youtubeVideoId.trim();

    // 2. Prevent duplicate provider + externalVideoId before persistence
    const existing = await this.mediaRepo.getVideoByYoutubeId(externalVideoId);
    if (existing) {
      throw new Error(`DUPLICATE_MEDIA: Video with YouTube ID ${externalVideoId} is already registered`);
    }

    // 3. Category validation using canonical validator
    if (!input.category || !isCanonicalCategory(input.category)) {
      throw new Error(`INVALID_CATEGORY: Category must be one of the canonical categories`);
    }

    // 4. RightsStatus validation if provided
    if (input.rightsStatus !== undefined && !isCanonicalRightsStatus(input.rightsStatus)) {
      throw new Error(`INVALID_RIGHTS_STATUS: Invalid rights status: ${input.rightsStatus}`);
    }

    // 5. VisibilityDecision validation if provided
    if (input.visibilityDecision !== undefined && !isCanonicalVisibilityDecision(input.visibilityDecision)) {
      throw new Error(`INVALID_VISIBILITY_DECISION: Invalid visibility decision: ${input.visibilityDecision}`);
    }

    // 6. Require essential localized text
    if (!input.titleAr || input.titleAr.trim() === '') {
      throw new Error('VALIDATION_ERROR: titleAr is required');
    }
    if (!input.excerptAr || input.excerptAr.trim() === '') {
      throw new Error('VALIDATION_ERROR: excerptAr is required');
    }
    if (!input.editorialDescriptionAr || input.editorialDescriptionAr.trim() === '') {
      throw new Error('VALIDATION_ERROR: editorialDescriptionAr is required');
    }

    const now = new Date().toISOString();
    const videoId = `video_yt_${externalVideoId}`;

    const newVideo: Video = {
      id: videoId,
      contentType: 'Video',
      status: input.status || 'Draft',
      category: input.category,
      titleAr: input.titleAr.trim(),
      titleEn: input.titleEn?.trim(),
      excerptAr: input.excerptAr.trim(),
      excerptEn: input.excerptEn?.trim(),
      originalLanguage: input.originalLanguage || 'ar',
      availableLanguages: input.availableLanguages || ['ar'],
      translationStatus: input.translationStatus || 'NotRequired',
      author: input.author?.trim() || '',
      producer: '',
      editor: input.editor?.trim() || 'Editor',
      approvalStatus: input.approvalStatus || 'Pending',
      editorialDescriptionAr: input.editorialDescriptionAr.trim(),
      editorialDescriptionEn: input.editorialDescriptionEn?.trim(),
      editorialThumbnail: input.editorialThumbnail,
      // Fail-closed defaults if not provided
      visibilityDecision: input.visibilityDecision || 'Hidden',
      rightsStatus: input.rightsStatus || 'NotStarted',
      tags: Array.isArray(input.tags) ? input.tags : [],
      sources: Array.isArray(input.sources) ? input.sources : [],
      rightsNotes: input.rightsNotes,
      youtubeSource: {
        ...input.youtubeSource,
        youtubeVideoId: externalVideoId,
      },
      createdAt: now,
      updatedAt: now,
    };

    // Atomic create: repository rejects if document already exists
    return this.mediaRepo.createVideo(newVideo);
  }

  async updateMetadata(id: string, updates: UpdateMediaMetadataInput): Promise<Video> {
    const video = await this.getById(id);
    if (!video) {
      throw new Error(`NOT_FOUND: Video ${id} not found`);
    }

    const updatedVideo: Video = {
      ...video,
      ...(updates.editorialDescriptionAr !== undefined && { editorialDescriptionAr: updates.editorialDescriptionAr }),
      ...(updates.editorialDescriptionEn !== undefined && { editorialDescriptionEn: updates.editorialDescriptionEn }),
      ...(updates.editorialThumbnail !== undefined && { editorialThumbnail: updates.editorialThumbnail }),
      ...(updates.tags !== undefined && { tags: updates.tags }),
      ...(updates.titleAr !== undefined && { titleAr: updates.titleAr }),
      ...(updates.titleEn !== undefined && { titleEn: updates.titleEn }),
      ...(updates.excerptAr !== undefined && { excerptAr: updates.excerptAr }),
      ...(updates.excerptEn !== undefined && { excerptEn: updates.excerptEn }),
      updatedAt: new Date().toISOString(),
    };

    return this.mediaRepo.updateVideo(updatedVideo);
  }

  async updateRightsStatus(id: string, rightsStatus: RightsStatus, notes?: string): Promise<Video> {
    if (!isCanonicalRightsStatus(rightsStatus)) {
      throw new Error(`INVALID_RIGHTS_STATUS: Invalid rights status: ${rightsStatus}`);
    }

    const video = await this.getById(id);
    if (!video) {
      throw new Error(`NOT_FOUND: Video ${id} not found`);
    }

    const updatedVideo: Video = {
      ...video,
      rightsStatus,
      rightsNotes: notes !== undefined ? notes : video.rightsNotes,
      updatedAt: new Date().toISOString(),
    };

    return this.mediaRepo.updateVideo(updatedVideo);
  }

  async updateVisibilityDecision(id: string, visibilityDecision: VisibilityDecision): Promise<Video> {
    if (!isCanonicalVisibilityDecision(visibilityDecision)) {
      throw new Error(`INVALID_VISIBILITY_DECISION: Invalid visibility decision: ${visibilityDecision}`);
    }

    const video = await this.getById(id);
    if (!video) {
      throw new Error(`NOT_FOUND: Video ${id} not found`);
    }

    const updatedVideo: Video = {
      ...video,
      visibilityDecision,
      updatedAt: new Date().toISOString(),
    };

    return this.mediaRepo.updateVideo(updatedVideo);
  }

  async linkVideoToContent(
    videoId: string,
    contentId: string,
    relationType: RelationType,
    placement: Placement,
    options?: { isPrimary?: boolean; caption?: string; displayOrder?: number }
  ): Promise<ContentVideoRelation> {
    const video = await this.getById(videoId);
    if (!video) {
      throw new Error(`NOT_FOUND: Video ${videoId} not found`);
    }

    const existingRelations = await this.mediaRepo.getRelationsForVideo(videoId);
    const duplicate = existingRelations.find(r => r.contentId === contentId && r.isActive !== false);
    if (duplicate) {
      throw new Error(`DUPLICATE_RELATION: Video ${videoId} is already linked to content ${contentId}`);
    }

    const now = new Date().toISOString();
    const relation: ContentVideoRelation = {
      id: `rel_${videoId}_${contentId}_${Date.now()}`,
      videoId,
      contentId,
      relationType,
      placement,
      displayOrder: options?.displayOrder || 0,
      isPrimary: options?.isPrimary || false,
      caption: options?.caption,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    return this.mediaRepo.saveRelation(relation);
  }

  async unlinkVideoFromContent(videoId: string, contentId: string): Promise<boolean> {
    const existingRelations = await this.mediaRepo.getRelationsForVideo(videoId);
    const relation = existingRelations.find(r => r.contentId === contentId);
    if (!relation) {
      throw new Error(`NOT_FOUND: Relation between video ${videoId} and content ${contentId} not found`);
    }

    return this.mediaRepo.deleteRelation(relation.id);
  }

  async getVideosForContent(contentId: string): Promise<Video[]> {
    const relations = await this.mediaRepo.getRelationsForContent(contentId);
    const videos: Video[] = [];
    for (const rel of relations) {
      const v = await this.getById(rel.videoId);
      if (v) {
        videos.push(v);
      }
    }
    return videos;
  }

  async getRelationsForVideo(videoId: string): Promise<ContentVideoRelation[]> {
    return this.mediaRepo.getRelationsForVideo(videoId);
  }

  isPubliclyEligible(video: Video): boolean {
    return video.visibilityDecision !== 'Hidden' && video.rightsStatus === 'Cleared';
  }
}
