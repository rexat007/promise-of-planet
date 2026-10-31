import type { MediaRepository } from './mediaRepository';
import { FirestoreMediaRepository } from './firestoreMediaRepository';
import {
  type Video,
  type ContentVideoRelation,
  type RightsStatus,
  type VisibilityDecision,
  type RelationType,
  type Placement,
  type ContentStatus,
  type ApprovalStatus,
  type AvailabilityStatus,
  isCanonicalCategory,
  isCanonicalRightsStatus,
  isCanonicalVisibilityDecision,
} from '../types/media';
import type { YouTubeClient } from '../youtube/youtubeClient';

export const CANONICAL_APPROVAL_STATUSES: readonly ApprovalStatus[] = [
  'Draft',
  'Pending',
  'InReview',
  'Approved',
  'ChangesRequested',
  'Rejected',
] as const;

export function isCanonicalApprovalStatus(value: unknown): value is ApprovalStatus {
  return typeof value === 'string' && (CANONICAL_APPROVAL_STATUSES as readonly string[]).includes(value);
}

export const CANONICAL_CONTENT_STATUSES: readonly ContentStatus[] = [
  'Draft',
  'PendingReview',
  'InReview',
  'Published',
  'Archived',
  'Rejected',
] as const;

export function isCanonicalContentStatus(value: unknown): value is ContentStatus {
  return typeof value === 'string' && (CANONICAL_CONTENT_STATUSES as readonly string[]).includes(value);
}

export const CANONICAL_AVAILABILITY_STATUSES: readonly AvailabilityStatus[] = [
  'Available',
  'Private',
  'Deleted',
  'Unavailable',
] as const;

export function isCanonicalAvailabilityStatus(value: unknown): value is AvailabilityStatus {
  return typeof value === 'string' && (CANONICAL_AVAILABILITY_STATUSES as readonly string[]).includes(value);
}

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
  private youtubeClient?: Pick<YouTubeClient, 'getVideoDetailsBatch'>;

  constructor(
    mediaRepo?: MediaRepository,
    youtubeClient?: Pick<YouTubeClient, 'getVideoDetailsBatch'>
  ) {
    this.mediaRepo = mediaRepo || new FirestoreMediaRepository();
    this.youtubeClient = youtubeClient;
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

    const titleEn = input.titleEn?.trim();
    const excerptEn = input.excerptEn?.trim();
    const editorialDescriptionEn = input.editorialDescriptionEn?.trim();

    const newVideo: Video = {
      id: videoId,
      contentType: 'Video',
      status: input.status || 'Draft',
      category: input.category,
      titleAr: input.titleAr.trim(),
      ...(titleEn ? { titleEn } : {}),
      excerptAr: input.excerptAr.trim(),
      ...(excerptEn ? { excerptEn } : {}),
      originalLanguage: input.originalLanguage || 'ar',
      availableLanguages: input.availableLanguages || ['ar'],
      translationStatus: input.translationStatus || 'NotRequired',
      author: input.author?.trim() || '',
      producer: '',
      editor: input.editor?.trim() || 'Editor',
      approvalStatus: input.approvalStatus || 'Pending',
      editorialDescriptionAr: input.editorialDescriptionAr.trim(),
      ...(editorialDescriptionEn ? { editorialDescriptionEn } : {}),
      ...(input.editorialThumbnail !== undefined ? { editorialThumbnail: input.editorialThumbnail } : {}),
      // Fail-closed defaults if not provided
      visibilityDecision: input.visibilityDecision || 'Hidden',
      rightsStatus: input.rightsStatus || 'NotStarted',
      tags: Array.isArray(input.tags) ? input.tags : [],
      sources: Array.isArray(input.sources) ? input.sources : [],
      ...(input.rightsNotes !== undefined ? { rightsNotes: input.rightsNotes } : {}),
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

    if (video.status === 'Published' && rightsStatus !== 'Cleared') {
      throw new Error(
        `INVALID_TRANSITION: Cannot change rightsStatus from Cleared to ${rightsStatus} while video status is Published. Unpublish or archive the video first.`
      );
    }

    const resolvedNotes = notes !== undefined ? notes : video.rightsNotes;
    const { rightsNotes: _oldRightsNotes, ...videoBase } = video;

    const updatedVideo: Video = {
      ...videoBase,
      rightsStatus,
      ...(resolvedNotes !== undefined ? { rightsNotes: resolvedNotes } : {}),
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

    if (video.status === 'Published' && visibilityDecision === 'Hidden') {
      throw new Error(
        'INVALID_TRANSITION: Cannot change visibilityDecision to Hidden while video status is Published. Unpublish or archive the video first.'
      );
    }

    const updatedVideo: Video = {
      ...video,
      visibilityDecision,
      updatedAt: new Date().toISOString(),
    };

    return this.mediaRepo.updateVideo(updatedVideo);
  }

  async updateApprovalStatus(
    id: string,
    approvalStatus: ApprovalStatus,
    reviewNotes?: string,
    editor?: string
  ): Promise<Video> {
    if (!isCanonicalApprovalStatus(approvalStatus)) {
      throw new Error(`INVALID_APPROVAL_STATUS: Invalid approval status: ${String(approvalStatus)}`);
    }

    const video = await this.getById(id);
    if (!video) {
      throw new Error(`NOT_FOUND: Video ${id} not found`);
    }

    if (video.status === 'Published' && approvalStatus !== 'Approved') {
      throw new Error(
        `INVALID_TRANSITION: Cannot change approvalStatus from Approved to ${approvalStatus} while video status is Published. Unpublish or archive the video first.`
      );
    }

    if (video.status === 'Rejected' && approvalStatus === 'Approved') {
      throw new Error(
        'INVALID_TRANSITION: Cannot approve a video while its publication status is Rejected.'
      );
    }

    if (approvalStatus === 'Approved') {
      if (!isCanonicalCategory(video.category)) {
        throw new Error('APPROVAL_PREREQUISITE_FAILED: Video must have a valid canonical category before approval');
      }
      if (typeof video.titleAr !== 'string' || video.titleAr.trim() === '') {
        throw new Error('APPROVAL_PREREQUISITE_FAILED: Video titleAr is required before approval');
      }
      if (typeof video.excerptAr !== 'string' || video.excerptAr.trim() === '') {
        throw new Error('APPROVAL_PREREQUISITE_FAILED: Video excerptAr is required before approval');
      }
      if (typeof video.editorialDescriptionAr !== 'string' || video.editorialDescriptionAr.trim() === '') {
        throw new Error('APPROVAL_PREREQUISITE_FAILED: Video editorialDescriptionAr is required before approval');
      }
    }

    const resolvedReviewNotes =
      reviewNotes !== undefined
        ? reviewNotes.trim() !== ''
          ? reviewNotes.trim()
          : undefined
        : video.reviewNotes;
    const resolvedEditor =
      typeof editor === 'string' && editor.trim() !== '' ? editor.trim() : video.editor;

    const { reviewNotes: _oldNotes, editor: _oldEditor, ...videoBase } = video;
    const updatedVideo: Video = {
      ...videoBase,
      approvalStatus,
      ...(resolvedReviewNotes !== undefined ? { reviewNotes: resolvedReviewNotes } : {}),
      ...(resolvedEditor !== undefined ? { editor: resolvedEditor } : {}),
      updatedAt: new Date().toISOString(),
    };

    return this.mediaRepo.updateVideo(updatedVideo);
  }

  async verifyYouTubeAvailability(id: string): Promise<Video> {
    const video = await this.getById(id);
    if (!video) {
      throw new Error(`NOT_FOUND: Video ${id} not found`);
    }

    const externalVideoId =
      typeof video.youtubeSource?.youtubeVideoId === 'string'
        ? video.youtubeSource.youtubeVideoId.trim()
        : '';
    if (!externalVideoId || !/^[A-Za-z0-9_-]{3,64}$/.test(externalVideoId)) {
      throw new Error('VALIDATION_ERROR: Video is missing a valid YouTube video ID');
    }

    let client = this.youtubeClient;
    if (!client) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { RealYouTubeClient } = require('../youtube/realYouTubeClient') as typeof import('../youtube/realYouTubeClient');
      client = new RealYouTubeClient();
    }

    let fetchedVideos: Awaited<ReturnType<Pick<YouTubeClient, 'getVideoDetailsBatch'>['getVideoDetailsBatch']>>;
    try {
      fetchedVideos = await client.getVideoDetailsBatch([externalVideoId]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `AVAILABILITY_VERIFICATION_FAILED: Unable to verify technical YouTube availability from authoritative source (${msg})`
      );
    }

    if (!Array.isArray(fetchedVideos)) {
      throw new Error('AVAILABILITY_VERIFICATION_FAILED: Invalid response from YouTube verification client');
    }

    const matched = fetchedVideos.find(v => v && v.externalVideoId === externalVideoId);
    let verifiedStatus: AvailabilityStatus = 'Unavailable';
    if (matched) {
      const candidateStatus = (matched as { availabilityStatus?: unknown }).availabilityStatus;
      if (isCanonicalAvailabilityStatus(candidateStatus)) {
        verifiedStatus = candidateStatus;
      } else {
        verifiedStatus = 'Available';
      }
    }

    const nowIso = new Date().toISOString();
    const updatedVideo: Video = {
      ...video,
      youtubeSource: {
        ...video.youtubeSource,
        availabilityStatus: verifiedStatus,
        lastSyncedAt: nowIso,
      },
      updatedAt: nowIso,
    };

    return this.mediaRepo.updateVideo(updatedVideo);
  }

  async updatePublicationStatus(
    id: string,
    status: ContentStatus,
    reviewNotes?: string,
    editor?: string
  ): Promise<Video> {
    if (!isCanonicalContentStatus(status)) {
      throw new Error(`INVALID_CONTENT_STATUS: Invalid publication status: ${String(status)}`);
    }

    const video = await this.getById(id);
    if (!video) {
      throw new Error(`NOT_FOUND: Video ${id} not found`);
    }

    if (status === 'Published') {
      if (video.approvalStatus !== 'Approved') {
        throw new Error(
          `PUBLICATION_PREREQUISITE_FAILED: Video cannot be published until approvalStatus is Approved (current: ${video.approvalStatus})`
        );
      }
      if (video.rightsStatus !== 'Cleared') {
        throw new Error(
          `PUBLICATION_PREREQUISITE_FAILED: Video cannot be published until rightsStatus is Cleared (current: ${video.rightsStatus})`
        );
      }
      if (!video.youtubeSource || typeof video.youtubeSource.youtubeVideoId !== 'string' || !video.youtubeSource.youtubeVideoId.trim()) {
        throw new Error(
          'PUBLICATION_PREREQUISITE_FAILED: Video cannot be published without a valid YouTube source video ID'
        );
      }
      if (video.youtubeSource.availabilityStatus !== 'Available') {
        throw new Error(
          `PUBLICATION_PREREQUISITE_FAILED: Video cannot be published until technical YouTube availabilityStatus is verified as Available (current: ${video.youtubeSource.availabilityStatus || 'Unverified'})`
        );
      }
      if (!isCanonicalVisibilityDecision(video.visibilityDecision) || video.visibilityDecision === 'Hidden') {
        throw new Error(
          `PUBLICATION_PREREQUISITE_FAILED: Video cannot be published while visibilityDecision is Hidden (current: ${video.visibilityDecision})`
        );
      }
      if (!isCanonicalCategory(video.category)) {
        throw new Error(
          'PUBLICATION_PREREQUISITE_FAILED: Video must have a valid canonical category before publication'
        );
      }
      if (
        typeof video.titleAr !== 'string' ||
        !video.titleAr.trim() ||
        typeof video.excerptAr !== 'string' ||
        !video.excerptAr.trim() ||
        typeof video.editorialDescriptionAr !== 'string' ||
        !video.editorialDescriptionAr.trim()
      ) {
        throw new Error(
          'PUBLICATION_PREREQUISITE_FAILED: Video is missing required Arabic editorial fields (titleAr, excerptAr, editorialDescriptionAr)'
        );
      }
    }

    if (status === 'Rejected' && video.approvalStatus === 'Approved') {
      throw new Error(
        'INVALID_TRANSITION: Cannot set publication status to Rejected while approvalStatus is Approved.'
      );
    }

    const nowIso = new Date().toISOString();
    const resolvedReviewNotes =
      reviewNotes !== undefined
        ? reviewNotes.trim() !== ''
          ? reviewNotes.trim()
          : undefined
        : video.reviewNotes;
    const resolvedEditor =
      typeof editor === 'string' && editor.trim() !== '' ? editor.trim() : video.editor;
    const resolvedPublishedAt =
      status === 'Published' ? video.publishedAt || nowIso : video.publishedAt;

    const {
      reviewNotes: _oldNotes,
      editor: _oldEditor,
      publishedAt: _oldPublishedAt,
      ...videoBase
    } = video;

    const updatedVideo: Video = {
      ...videoBase,
      status,
      ...(resolvedReviewNotes !== undefined ? { reviewNotes: resolvedReviewNotes } : {}),
      ...(resolvedEditor !== undefined ? { editor: resolvedEditor } : {}),
      ...(resolvedPublishedAt !== undefined ? { publishedAt: resolvedPublishedAt } : {}),
      updatedAt: nowIso,
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
      ...(options?.caption !== undefined ? { caption: options.caption } : {}),
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
    return (
      video.status === 'Published' &&
      video.approvalStatus === 'Approved' &&
      video.rightsStatus === 'Cleared' &&
      video.visibilityDecision !== 'Hidden' &&
      video.youtubeSource?.availabilityStatus === 'Available'
    );
  }
}
