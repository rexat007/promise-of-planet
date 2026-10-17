"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isContentPublished = isContentPublished;
exports.isArticleVisible = isArticleVisible;
exports.isVideoVisibleInMediaHub = isVideoVisibleInMediaHub;
exports.isVideoVisibleInArticle = isVideoVisibleInArticle;
exports.isContentFeatured = isContentFeatured;
const contentLanguage_1 = require("./contentLanguage");
/**
 * 1. Published Content
 * Determines whether a ContentItem is published and approved for public consumption.
 * Rejects Draft, PendingReview, InReview, Archived, Rejected, and unapproved items.
 */
function isContentPublished(item) {
    if (item.status !== 'Published') {
        return { visible: false, reason: 'NOT_PUBLISHED' };
    }
    if (item.approvalStatus !== 'Approved') {
        return { visible: false, reason: 'NOT_APPROVED' };
    }
    return { visible: true };
}
/**
 * 2. News / Report Visibility
 * Validates public visibility eligibility for News or Report.
 * - status === 'Published'
 * - approvalStatus === 'Approved'
 * - Mandatory structural completeness (e.g. Report featuredImage)
 * - If targetLanguage is provided, strictly requires complete text fields for that language.
 */
function isArticleVisible(article, targetLanguage) {
    const publishCheck = isContentPublished(article);
    if (!publishCheck.visible) {
        return publishCheck;
    }
    // Mandatory fields check: Report requires featuredImage
    if (article.contentType === 'Report') {
        if (!article.featuredImage || !article.featuredImage.url) {
            return { visible: false, reason: 'MISSING_MANDATORY_FIELDS' };
        }
    }
    // Language completeness check
    if (targetLanguage) {
        if (!(0, contentLanguage_1.isLanguageAvailable)(article, targetLanguage)) {
            return { visible: false, reason: 'MISSING_REQUIRED_LANGUAGE_FIELDS' };
        }
    }
    else {
        // If no specific language requested, ensure at least one language is fully available
        const hasAr = (0, contentLanguage_1.isLanguageAvailable)(article, 'ar');
        const hasEn = (0, contentLanguage_1.isLanguageAvailable)(article, 'en');
        if (!hasAr && !hasEn) {
            return { visible: false, reason: 'MISSING_REQUIRED_LANGUAGE_FIELDS' };
        }
    }
    return { visible: true };
}
/**
 * 3 & 4. Video Visibility — Media Hub
 * Validates public visibility for a Video in the Media Hub.
 * - contentType === 'Video'
 * - status === 'Published'
 * - approvalStatus === 'Approved'
 * - rightsStatus === 'Cleared'
 * - availabilityStatus === 'Available'
 * - visibilityDecision !== 'Hidden'
 *
 * CRITICAL SYNC RULE:
 * syncStatus belongs to YouTubeSyncLog and is NOT an availability status.
 * SyncError !== Unavailable.
 * A syncStatus of 'SyncError' in sync logs DOES NOT automatically hide the video
 * as long as the video's last verified availabilityStatus is 'Available'.
 * optionalSyncLogs parameter allows inspecting sync logs without violating this rule.
 */
function isVideoVisibleInMediaHub(video, targetLanguage, _recentSyncLogs) {
    // 1. Content publication and editorial approval
    const publishCheck = isContentPublished(video);
    if (!publishCheck.visible) {
        return publishCheck;
    }
    // 2. Rights clearance
    if (video.rightsStatus !== 'Cleared') {
        return { visible: false, reason: 'RIGHTS_NOT_CLEARED' };
    }
    // 3. Platform availability (governed by youtubeSource.availabilityStatus)
    // 'Private', 'Deleted', and 'Unavailable' prevent public playback/display.
    if (video.youtubeSource.availabilityStatus !== 'Available') {
        return { visible: false, reason: 'VIDEO_NOT_AVAILABLE' };
    }
    // 4. Editorial visibility scope
    // 'Featured', 'NewsEligible', and 'MediaHubOnly' are eligible for Media Hub.
    // 'Hidden' is strictly barred from Media Hub.
    if (video.visibilityDecision === 'Hidden') {
        return { visible: false, reason: 'HIDDEN_BY_EDITORIAL_DECISION' };
    }
    // 5. Language completeness
    if (targetLanguage) {
        if (!(0, contentLanguage_1.isLanguageAvailable)(video, targetLanguage)) {
            return { visible: false, reason: 'MISSING_REQUIRED_LANGUAGE_FIELDS' };
        }
    }
    else {
        const hasAr = (0, contentLanguage_1.isLanguageAvailable)(video, 'ar');
        const hasEn = (0, contentLanguage_1.isLanguageAvailable)(video, 'en');
        if (!hasAr && !hasEn) {
            return { visible: false, reason: 'MISSING_REQUIRED_LANGUAGE_FIELDS' };
        }
    }
    return { visible: true };
}
/**
 * 5. Video inside News / Report Article
 * Validates whether a Video can be displayed inside a host News or Report article
 * based on the host article state, video state, and ContentVideoRelation.
 *
 * Requirements:
 * Host Article:
 *   - status === 'Published'
 *   - approvalStatus === 'Approved'
 * Video:
 *   - status === 'Published'
 *   - approvalStatus === 'Approved'
 *   - rightsStatus === 'Cleared'
 *   - availabilityStatus === 'Available'
 * Video Editorial Decision:
 *   - visibilityDecision === 'NewsEligible' OR 'Featured'
 *   (MediaHubOnly and Hidden are NOT eligible for article embedding)
 * Relation:
 *   - isActive === true
 *   - Matching contentId and videoId
 *   - Has valid relationType, placement, and displayOrder
 */
function isVideoVisibleInArticle(article, video, relation, targetLanguage) {
    // 1. Host article eligibility
    const articleCheck = isContentPublished(article);
    if (!articleCheck.visible) {
        return {
            visible: false,
            reason: articleCheck.reason === 'NOT_PUBLISHED'
                ? 'HOST_ARTICLE_NOT_PUBLISHED'
                : 'HOST_ARTICLE_NOT_APPROVED',
        };
    }
    // 2. Relation validity
    if (!relation.isActive) {
        return { visible: false, reason: 'RELATION_INACTIVE' };
    }
    if (relation.contentId !== article.id || relation.videoId !== video.id) {
        return { visible: false, reason: 'RELATION_TARGET_MISMATCH' };
    }
    // 3. Video publication & approval
    const videoPublishCheck = isContentPublished(video);
    if (!videoPublishCheck.visible) {
        return videoPublishCheck;
    }
    // 4. Video media rights
    if (video.rightsStatus !== 'Cleared') {
        return { visible: false, reason: 'RIGHTS_NOT_CLEARED' };
    }
    // 5. Video platform availability
    if (video.youtubeSource.availabilityStatus !== 'Available') {
        return { visible: false, reason: 'VIDEO_NOT_AVAILABLE' };
    }
    // 6. Editorial decision for article embedding:
    // Must be 'NewsEligible' or 'Featured'.
    // 'MediaHubOnly' is exclusive to Media Hub; 'Hidden' is barred everywhere.
    if (video.visibilityDecision !== 'NewsEligible' &&
        video.visibilityDecision !== 'Featured') {
        return { visible: false, reason: 'VIDEO_NOT_NEWS_ELIGIBLE' };
    }
    // 7. Language completeness for the article context
    if (targetLanguage) {
        if (!(0, contentLanguage_1.isLanguageAvailable)(video, targetLanguage)) {
            return { visible: false, reason: 'MISSING_REQUIRED_LANGUAGE_FIELDS' };
        }
    }
    return { visible: true };
}
/**
 * 6. Featured Content
 * Validates whether an item qualifies as Featured for prominent editorial placement.
 * 'Featured' is strictly an additional editorial priority/placement flag and NEVER overrides:
 * - status (must be 'Published')
 * - approvalStatus (must be 'Approved')
 * - rightsStatus (must be 'Cleared' for Video)
 * - availabilityStatus (must be 'Available' for Video)
 */
function isContentFeatured(item, targetLanguage) {
    // First, verify baseline public visibility
    if (item.contentType === 'Video') {
        const mediaHubCheck = isVideoVisibleInMediaHub(item, targetLanguage);
        if (!mediaHubCheck.visible) {
            return mediaHubCheck;
        }
        if (item.visibilityDecision !== 'Featured') {
            return { visible: false, reason: 'NOT_MEDIA_HUB_ELIGIBLE' };
        }
        return { visible: true };
    }
    // For News and Report
    const articleCheck = isArticleVisible(item, targetLanguage);
    if (!articleCheck.visible) {
        return articleCheck;
    }
    return { visible: true };
}
//# sourceMappingURL=contentVisibility.js.map