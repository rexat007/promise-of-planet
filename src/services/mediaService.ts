import type { Video, ContentVideoRelation, ContentType, RelationType, Placement, RightsStatus, VisibilityDecision } from "../types";
import { AdminAccessService } from "./adminAccess";
import { AdminPermission } from "../types/admin";
import type { AdminUser } from "../types/admin";
import { v4 as uuidv4 } from "uuid";
import { AdminAuditService } from "./adminAuditService";
import { AuditTargetType, AuditAction } from "../types/audit";
import { mockNewsList, mockReportsList, mockVideosList, mockContentVideoRelations } from "../data/mockContent";

// Mock store to be replaced by durable storage later
let videos: Video[] = [...mockVideosList];
let relations: ContentVideoRelation[] = [...mockContentVideoRelations];

export const MediaService = {
  listAll: (): Video[] => [...videos],
  
  getById: (id: string): Video | undefined => videos.find(v => v.id === id),
  
  getByYoutubeId: (provider: string, externalVideoId: string): Video | undefined => {
    // Only 'YouTube' is currently supported per requirements
    if (provider !== 'YouTube') return undefined;
    return videos.find(v => v.youtubeSource.youtubeVideoId === externalVideoId);
  },

  register: (data: Omit<Video, 'id' | 'createdAt' | 'updatedAt'>, user: AdminUser): Video => {
    if (!AdminAccessService.hasPermission(user, AdminPermission.Create)) throw new Error("Unauthorized");
    
    const existing = MediaService.getByYoutubeId('YouTube', data.youtubeSource.youtubeVideoId);
    if (existing) throw new Error("Video already registered");

    const now = new Date().toISOString();
    const newVideo: Video = {
      ...data,
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
    };
    
    // Atomicity: Only commit if audit succeeds. 
    // Since audit throws on failure, this pattern is consistent.
    const prevVideos = [...videos];
    videos.push(newVideo);
    
    try {
      AdminAuditService.recordEvent({
        actorUserId: user.id,
        actorName: user.name,
        actorRole: user.role,
        targetType: AuditTargetType.Media,
        targetId: newVideo.id,
        action: AuditAction.Created,
        metadata: { videoId: newVideo.id },
      });
    } catch (e) {
      videos = prevVideos;
      throw e;
    }
    
    return newVideo;
  },

  updateMetadata: (id: string, updates: Pick<Video, 'editorialDescriptionAr' | 'editorialDescriptionEn' | 'editorialThumbnail' | 'tags'>, user: AdminUser): Video => {
    if (!AdminAccessService.hasPermission(user, AdminPermission.Edit)) throw new Error("Unauthorized");
    
    const index = videos.findIndex(v => v.id === id);
    if (index === -1) throw new Error("Video not found");
    
    const prevVideo = { ...videos[index] };
    videos[index] = { ...videos[index], ...updates, updatedAt: new Date().toISOString() };
    
    try {
      AdminAuditService.recordEvent({
        actorUserId: user.id,
        actorName: user.name,
        actorRole: user.role,
        targetType: AuditTargetType.Media,
        targetId: id,
        action: AuditAction.Updated,
        metadata: { changes: JSON.stringify(updates) },
      });
    } catch (e) {
      videos[index] = prevVideo;
      throw e;
    }
    
    return videos[index];
  },

  updateRightsStatus: (id: string, rightsStatus: RightsStatus, notes: string | undefined, user: AdminUser): Video => {
    if (!AdminAccessService.hasPermission(user, AdminPermission.ManageRights)) {
      throw new Error("Unauthorized: Requires ManageRights permission");
    }
    const validStatuses: RightsStatus[] = ['NotStarted', 'InReview', 'Cleared', 'NeedsChanges', 'Rejected'];
    if (!validStatuses.includes(rightsStatus)) {
      throw new Error(`Invalid rights status: ${rightsStatus}`);
    }
    const index = videos.findIndex(v => v.id === id);
    if (index === -1) throw new Error("Video not found");

    const prevVideo = { ...videos[index] };
    if (prevVideo.rightsStatus === rightsStatus && prevVideo.rightsNotes === notes) {
      // No-op: Perform no mutation or audit logging
      return videos[index];
    }

    videos[index] = {
      ...videos[index],
      rightsStatus,
      rightsNotes: notes,
      updatedAt: new Date().toISOString()
    };

    try {
      AdminAuditService.recordEvent({
        actorUserId: user.id,
        actorName: user.name,
        actorRole: user.role,
        targetType: AuditTargetType.Media,
        targetId: id,
        action: AuditAction.RightsChanged,
        targetTitle: videos[index].titleAr,
        changes: [
          { field: 'rightsStatus', previousValue: prevVideo.rightsStatus, newValue: rightsStatus }
        ],
        metadata: { notes: notes || null }
      });
    } catch (e) {
      videos[index] = prevVideo;
      throw new Error(`Audit log failure: ${e instanceof Error ? e.message : String(e)}`);
    }

    return videos[index];
  },

  updateVisibilityDecision: (id: string, visibilityDecision: VisibilityDecision, user: AdminUser): Video => {
    if (!AdminAccessService.hasPermission(user, AdminPermission.Review)) {
      throw new Error("Unauthorized: Requires Review permission");
    }
    const validDecisions: VisibilityDecision[] = ['Hidden', 'MediaHubOnly', 'NewsEligible', 'Featured'];
    if (!validDecisions.includes(visibilityDecision)) {
      throw new Error(`Invalid visibility decision: ${visibilityDecision}`);
    }
    const index = videos.findIndex(v => v.id === id);
    if (index === -1) throw new Error("Video not found");

    const prevVideo = { ...videos[index] };
    if (prevVideo.visibilityDecision === visibilityDecision) {
      // No-op: Perform no mutation or audit logging
      return videos[index];
    }

    videos[index] = {
      ...videos[index],
      visibilityDecision,
      updatedAt: new Date().toISOString()
    };

    try {
      AdminAuditService.recordEvent({
        actorUserId: user.id,
        actorName: user.name,
        actorRole: user.role,
        targetType: AuditTargetType.Media,
        targetId: id,
        action: AuditAction.StatusChanged,
        targetTitle: videos[index].titleAr,
        changes: [
          { field: 'visibilityDecision', previousValue: prevVideo.visibilityDecision, newValue: visibilityDecision }
        ]
      });
    } catch (e) {
      videos[index] = prevVideo;
      throw new Error(`Audit log failure: ${e instanceof Error ? e.message : String(e)}`);
    }

    return videos[index];
  },

  linkVideoToContent: (videoId: string, contentId: string, contentType: ContentType, relationType: RelationType, placement: Placement, user: AdminUser): ContentVideoRelation => {
    if (!AdminAccessService.hasPermission(user, AdminPermission.Edit)) throw new Error("Unauthorized");
    
    const video = MediaService.getById(videoId);
    if (!video) throw new Error("Video not found");
    
    // Validate Content Endpoint using the supplied contentType
    let contentExists = false;
    if (contentType === 'News') {
      contentExists = mockNewsList.some(c => c.id === contentId);
    } else if (contentType === 'Report') {
      contentExists = mockReportsList.some(c => c.id === contentId);
    }
    
    if (!contentExists) throw new Error("Content item not found");

    if (relations.some(r => r.videoId === videoId && r.contentId === contentId)) throw new Error("Relation already exists");

    const relation: ContentVideoRelation = {
      id: uuidv4(),
      videoId,
      contentId,
      relationType,
      placement,
      displayOrder: 0,
      isPrimary: false,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    const prevRelations = [...relations];
    relations.push(relation);
    
    try {
      AdminAuditService.recordEvent({
        actorUserId: user.id,
        actorName: user.name,
        actorRole: user.role,
        targetType: AuditTargetType.Media,
        targetId: videoId,
        action: AuditAction.Updated,
        metadata: { action: 'Link', contentId, contentType },
      });
    } catch (e) {
      relations = prevRelations;
      throw e;
    }
    
    return relation;
  },

  unlinkVideoFromContent: (videoId: string, contentId: string, user: AdminUser): void => {
    if (!AdminAccessService.hasPermission(user, AdminPermission.Edit)) throw new Error("Unauthorized");
    
    const index = relations.findIndex(r => r.videoId === videoId && r.contentId === contentId);
    if (index === -1) throw new Error("Relation not found");
    
    const prevRelations = [...relations];
    relations.splice(index, 1);
    
    try {
      AdminAuditService.recordEvent({
        actorUserId: user.id,
        actorName: user.name,
        actorRole: user.role,
        targetType: AuditTargetType.Media,
        targetId: videoId,
        action: AuditAction.Updated,
        metadata: { action: 'Unlink', contentId },
      });
    } catch (e) {
      relations = prevRelations;
      throw e;
    }
  },

  getVideosForContent: (contentId: string): Video[] => {
    const videoIds = relations.filter(r => r.contentId === contentId).map(r => r.videoId);
    return videos.filter(v => videoIds.includes(v.id));
  },
  
  getRelationsForVideo: (videoId: string): ContentVideoRelation[] => {
    return relations.filter(r => r.videoId === videoId);
  }
};

/**
 * Pure service-level decision for public eligibility.
 * Based on editorial visibility and rights clearance.
 */
export const isVideoPubliclyEligible = (video: Video): boolean => {
  return (
    video.visibilityDecision !== 'Hidden' &&
    video.rightsStatus === 'Cleared'
  );
};
