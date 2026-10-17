"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isVideoPubliclyEligible = exports.MediaService = void 0;
const adminAccess_1 = require("./adminAccess");
const admin_1 = require("../types/admin");
const uuid_1 = require("uuid");
const adminAuditService_1 = require("./adminAuditService");
const audit_1 = require("../types/audit");
const mockContent_1 = require("../data/mockContent");
// Mock store to be replaced by durable storage later
let videos = [...mockContent_1.mockVideosList];
let relations = [...mockContent_1.mockContentVideoRelations];
let playlists = [];
exports.MediaService = {
    listAll: () => [...videos],
    getById: (id) => videos.find(v => v.id === id),
    getByYoutubeId: (provider, externalVideoId) => {
        // Only 'YouTube' is currently supported per requirements
        if (provider !== 'YouTube')
            return undefined;
        return videos.find(v => v.youtubeSource.youtubeVideoId === externalVideoId);
    },
    register: (data, user) => {
        if (!adminAccess_1.AdminAccessService.hasPermission(user, admin_1.AdminPermission.Create))
            throw new Error("Unauthorized");
        const existing = exports.MediaService.getByYoutubeId('YouTube', data.youtubeSource.youtubeVideoId);
        if (existing)
            throw new Error("Video already registered");
        const now = new Date().toISOString();
        const newVideo = {
            ...data,
            id: (0, uuid_1.v4)(),
            createdAt: now,
            updatedAt: now,
        };
        // Atomicity: Only commit if audit succeeds. 
        // Since audit throws on failure, this pattern is consistent.
        const prevVideos = [...videos];
        videos.push(newVideo);
        try {
            adminAuditService_1.AdminAuditService.recordEvent({
                actorUserId: user.id,
                actorName: user.name,
                actorRole: user.role,
                targetType: audit_1.AuditTargetType.Media,
                targetId: newVideo.id,
                action: audit_1.AuditAction.Created,
                metadata: { videoId: newVideo.id },
            });
        }
        catch (e) {
            videos = prevVideos;
            throw e;
        }
        return newVideo;
    },
    updateMetadata: (id, updates, user) => {
        if (!adminAccess_1.AdminAccessService.hasPermission(user, admin_1.AdminPermission.Edit))
            throw new Error("Unauthorized");
        const index = videos.findIndex(v => v.id === id);
        if (index === -1)
            throw new Error("Video not found");
        const prevVideo = { ...videos[index] };
        videos[index] = { ...videos[index], ...updates, updatedAt: new Date().toISOString() };
        try {
            adminAuditService_1.AdminAuditService.recordEvent({
                actorUserId: user.id,
                actorName: user.name,
                actorRole: user.role,
                targetType: audit_1.AuditTargetType.Media,
                targetId: id,
                action: audit_1.AuditAction.Updated,
                metadata: { changes: JSON.stringify(updates) },
            });
        }
        catch (e) {
            videos[index] = prevVideo;
            throw e;
        }
        return videos[index];
    },
    updateRightsStatus: (id, rightsStatus, notes, user) => {
        if (!adminAccess_1.AdminAccessService.hasPermission(user, admin_1.AdminPermission.ManageRights)) {
            throw new Error("Unauthorized: Requires ManageRights permission");
        }
        const validStatuses = ['NotStarted', 'InReview', 'Cleared', 'NeedsChanges', 'Rejected'];
        if (!validStatuses.includes(rightsStatus)) {
            throw new Error(`Invalid rights status: ${rightsStatus}`);
        }
        const index = videos.findIndex(v => v.id === id);
        if (index === -1)
            throw new Error("Video not found");
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
            adminAuditService_1.AdminAuditService.recordEvent({
                actorUserId: user.id,
                actorName: user.name,
                actorRole: user.role,
                targetType: audit_1.AuditTargetType.Media,
                targetId: id,
                action: audit_1.AuditAction.RightsChanged,
                targetTitle: videos[index].titleAr,
                changes: [
                    { field: 'rightsStatus', previousValue: prevVideo.rightsStatus, newValue: rightsStatus }
                ],
                metadata: { notes: notes || null }
            });
        }
        catch (e) {
            videos[index] = prevVideo;
            throw new Error(`Audit log failure: ${e instanceof Error ? e.message : String(e)}`);
        }
        return videos[index];
    },
    updateVisibilityDecision: (id, visibilityDecision, user) => {
        if (!adminAccess_1.AdminAccessService.hasPermission(user, admin_1.AdminPermission.Review)) {
            throw new Error("Unauthorized: Requires Review permission");
        }
        const validDecisions = ['Hidden', 'MediaHubOnly', 'NewsEligible', 'Featured'];
        if (!validDecisions.includes(visibilityDecision)) {
            throw new Error(`Invalid visibility decision: ${visibilityDecision}`);
        }
        const index = videos.findIndex(v => v.id === id);
        if (index === -1)
            throw new Error("Video not found");
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
            adminAuditService_1.AdminAuditService.recordEvent({
                actorUserId: user.id,
                actorName: user.name,
                actorRole: user.role,
                targetType: audit_1.AuditTargetType.Media,
                targetId: id,
                action: audit_1.AuditAction.StatusChanged,
                targetTitle: videos[index].titleAr,
                changes: [
                    { field: 'visibilityDecision', previousValue: prevVideo.visibilityDecision, newValue: visibilityDecision }
                ]
            });
        }
        catch (e) {
            videos[index] = prevVideo;
            throw new Error(`Audit log failure: ${e instanceof Error ? e.message : String(e)}`);
        }
        return videos[index];
    },
    linkVideoToContent: (videoId, contentId, contentType, relationType, placement, user) => {
        if (!adminAccess_1.AdminAccessService.hasPermission(user, admin_1.AdminPermission.Edit))
            throw new Error("Unauthorized");
        const video = exports.MediaService.getById(videoId);
        if (!video)
            throw new Error("Video not found");
        // Validate Content Endpoint using the supplied contentType
        let contentExists = false;
        if (contentType === 'News') {
            contentExists = mockContent_1.mockNewsList.some(c => c.id === contentId);
        }
        else if (contentType === 'Report') {
            contentExists = mockContent_1.mockReportsList.some(c => c.id === contentId);
        }
        if (!contentExists)
            throw new Error("Content item not found");
        if (relations.some(r => r.videoId === videoId && r.contentId === contentId))
            throw new Error("Relation already exists");
        const relation = {
            id: (0, uuid_1.v4)(),
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
            adminAuditService_1.AdminAuditService.recordEvent({
                actorUserId: user.id,
                actorName: user.name,
                actorRole: user.role,
                targetType: audit_1.AuditTargetType.Media,
                targetId: videoId,
                action: audit_1.AuditAction.Updated,
                metadata: { action: 'Link', contentId, contentType },
            });
        }
        catch (e) {
            relations = prevRelations;
            throw e;
        }
        return relation;
    },
    unlinkVideoFromContent: (videoId, contentId, user) => {
        if (!adminAccess_1.AdminAccessService.hasPermission(user, admin_1.AdminPermission.Edit))
            throw new Error("Unauthorized");
        const index = relations.findIndex(r => r.videoId === videoId && r.contentId === contentId);
        if (index === -1)
            throw new Error("Relation not found");
        const prevRelations = [...relations];
        relations.splice(index, 1);
        try {
            adminAuditService_1.AdminAuditService.recordEvent({
                actorUserId: user.id,
                actorName: user.name,
                actorRole: user.role,
                targetType: audit_1.AuditTargetType.Media,
                targetId: videoId,
                action: audit_1.AuditAction.Updated,
                metadata: { action: 'Unlink', contentId },
            });
        }
        catch (e) {
            relations = prevRelations;
            throw e;
        }
    },
    getVideosForContent: (contentId) => {
        const videoIds = relations.filter(r => r.contentId === contentId).map(r => r.videoId);
        return videos.filter(v => videoIds.includes(v.id));
    },
    getRelationsForVideo: (videoId) => {
        return relations.filter(r => r.videoId === videoId);
    },
    listPlaylists: () => [...playlists],
    getPlaylistById: (id) => playlists.find(p => p.id === id),
    createPlaylist: (data) => {
        playlists = playlists.filter(p => p.id !== data.id);
        playlists.push(data);
        return data;
    },
    updatePlaylist: (data) => {
        const idx = playlists.findIndex(p => p.id === data.id);
        if (idx !== -1) {
            playlists[idx] = data;
        }
        else {
            playlists.push(data);
        }
        return data;
    },
    getVideosForPlaylist: (playlistId) => {
        const pl = playlists.find(p => p.id === playlistId);
        if (!pl)
            return [];
        return videos.filter(v => pl.videoIds.includes(v.id));
    }
};
/**
 * Pure service-level decision for public eligibility.
 * Based on editorial visibility and rights clearance.
 */
const isVideoPubliclyEligible = (video) => {
    return (video.visibilityDecision !== 'Hidden' &&
        video.rightsStatus === 'Cleared');
};
exports.isVideoPubliclyEligible = isVideoPubliclyEligible;
//# sourceMappingURL=mediaService.js.map