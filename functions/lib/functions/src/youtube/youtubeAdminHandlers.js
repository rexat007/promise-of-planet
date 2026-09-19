"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewYouTubeCandidate = exports.manageYouTubeIntegration = void 0;
exports.executeManageYouTubeIntegrationRequest = executeManageYouTubeIntegrationRequest;
exports.executeReviewYouTubeCandidateRequest = executeReviewYouTubeCandidateRequest;
const https_1 = require("firebase-functions/v2/https");
const youtubeApplicationService_1 = require("./youtubeApplicationService");
const firestoreAdminRepository_1 = require("../admin/firestoreAdminRepository");
const adminAuthorizationService_1 = require("../admin/adminAuthorizationService");
const admin_1 = require("../types/admin");
const CANONICAL_CATEGORIES = [
    'Climate',
    'Water',
    'Biodiversity',
    'Pollution',
    'Energy',
    'Agriculture',
    'EnvironmentalPolicy'
];
async function authenticateAndAuthorize(requestContext, requiredPermission, adminRepo) {
    if (!requestContext.auth || !requestContext.auth.uid || requestContext.auth.uid.trim() === '') {
        throw new https_1.HttpsError('unauthenticated', 'UNAUTHENTICATED: Request missing valid Firebase Authentication token');
    }
    const uid = requestContext.auth.uid.trim();
    const admin = await adminRepo.getAdminByUid(uid);
    if (!admin) {
        throw new https_1.HttpsError('permission-denied', 'ADMIN_NOT_REGISTERED: User identity is not registered as a canonical AdminUser');
    }
    if (!admin.isActive) {
        throw new https_1.HttpsError('permission-denied', 'ADMIN_INACTIVE: AdminUser account is inactive');
    }
    const isAuthorized = adminAuthorizationService_1.AdminAuthorizationService.hasPermission(admin, requiredPermission);
    if (!isAuthorized) {
        throw new https_1.HttpsError('permission-denied', `PERMISSION_DENIED: AdminUser lacks required ${requiredPermission} permission`);
    }
    return admin;
}
/**
 * Pure core business logic handler for YouTube Admin config and query requests.
 * Decoupled from the v2 HTTPS protocol layer to enable 100% offline security TDD.
 */
async function executeManageYouTubeIntegrationRequest(requestContext, adminRepo = new firestoreAdminRepository_1.FirestoreAdminRepository(), youtubeAppService = new youtubeApplicationService_1.YoutubeApplicationService()) {
    const data = requestContext.data || {};
    const action = data.action;
    if (action === 'getConfig') {
        await authenticateAndAuthorize(requestContext, admin_1.AdminPermission.ManageSettings, adminRepo);
        const config = await youtubeAppService.getConfiguration();
        return { config };
    }
    if (action === 'updateConfig') {
        await authenticateAndAuthorize(requestContext, admin_1.AdminPermission.ManageSettings, adminRepo);
        if (typeof data.channelId !== 'string' || data.channelId.trim() === '') {
            throw new https_1.HttpsError('invalid-argument', 'INVALID_CONFIG: channelId must be a non-empty string');
        }
        if (typeof data.enabled !== 'boolean') {
            throw new https_1.HttpsError('invalid-argument', 'INVALID_CONFIG: enabled must be a boolean');
        }
        if (typeof data.version !== 'number') {
            throw new https_1.HttpsError('invalid-argument', 'INVALID_CONFIG: version must be a valid number');
        }
        try {
            const config = await youtubeAppService.updateConfiguration({
                channelId: data.channelId.trim(),
                enabled: data.enabled,
                version: data.version
            });
            return { config };
        }
        catch (err) {
            if (err instanceof https_1.HttpsError)
                throw err;
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('Concurrency conflict')) {
                throw new https_1.HttpsError('aborted', `CONCURRENCY_CONFLICT: ${msg}`);
            }
            throw new https_1.HttpsError('internal', `CONFIG_UPDATE_FAILED: ${msg}`);
        }
    }
    if (action === 'listCandidates') {
        await authenticateAndAuthorize(requestContext, admin_1.AdminPermission.Review, adminRepo);
        let statusFilter;
        if (data.status) {
            if (!['PendingReview', 'Accepted', 'Rejected'].includes(data.status)) {
                throw new https_1.HttpsError('invalid-argument', 'INVALID_STATUS: Invalid candidate lifecycle status filter');
            }
            statusFilter = data.status;
        }
        const candidates = await youtubeAppService.listCandidates(statusFilter ? { status: statusFilter } : undefined);
        return { candidates };
    }
    if (action === 'getCandidate') {
        await authenticateAndAuthorize(requestContext, admin_1.AdminPermission.Review, adminRepo);
        if (typeof data.id !== 'string' || data.id.trim() === '') {
            throw new https_1.HttpsError('invalid-argument', 'INVALID_ARGUMENT: Candidate id is required');
        }
        const candidate = await youtubeAppService.getCandidate(data.id.trim());
        return { candidate };
    }
    throw new https_1.HttpsError('invalid-argument', 'INVALID_ACTION: Unsupported action requested');
}
/**
 * Pure core business logic handler for YouTube Candidate review mutations.
 * Decoupled from the v2 HTTPS protocol layer to enable 100% offline security TDD.
 */
async function executeReviewYouTubeCandidateRequest(requestContext, adminRepo = new firestoreAdminRepository_1.FirestoreAdminRepository(), youtubeAppService = new youtubeApplicationService_1.YoutubeApplicationService()) {
    const data = requestContext.data || {};
    const action = data.action;
    if (action === 'updateDraft') {
        await authenticateAndAuthorize(requestContext, admin_1.AdminPermission.Edit, adminRepo);
        if (typeof data.candidateId !== 'string' || data.candidateId.trim() === '') {
            throw new https_1.HttpsError('invalid-argument', 'INVALID_ARGUMENT: candidateId is required');
        }
        if (!data.editorialDraft || typeof data.editorialDraft !== 'object') {
            throw new https_1.HttpsError('invalid-argument', 'INVALID_ARGUMENT: editorialDraft must be an object');
        }
        // Only allow human-controlled editorial fields to be modified
        const sanitizedDraft = {};
        if (typeof data.editorialDraft.titleAr === 'string')
            sanitizedDraft.titleAr = data.editorialDraft.titleAr;
        if (typeof data.editorialDraft.titleEn === 'string')
            sanitizedDraft.titleEn = data.editorialDraft.titleEn;
        if (typeof data.editorialDraft.excerptAr === 'string')
            sanitizedDraft.excerptAr = data.editorialDraft.excerptAr;
        if (typeof data.editorialDraft.excerptEn === 'string')
            sanitizedDraft.excerptEn = data.editorialDraft.excerptEn;
        if (typeof data.editorialDraft.editorialDescriptionAr === 'string')
            sanitizedDraft.editorialDescriptionAr = data.editorialDraft.editorialDescriptionAr;
        if (typeof data.editorialDraft.editorialDescriptionEn === 'string')
            sanitizedDraft.editorialDescriptionEn = data.editorialDraft.editorialDescriptionEn;
        if (Array.isArray(data.editorialDraft.tags)) {
            sanitizedDraft.tags = data.editorialDraft.tags.map((t) => String(t).trim()).filter((t) => t !== '');
        }
        if (data.editorialDraft.category !== undefined) {
            if (data.editorialDraft.category === null || data.editorialDraft.category === '') {
                sanitizedDraft.category = undefined;
            }
            else if (CANONICAL_CATEGORIES.includes(data.editorialDraft.category)) {
                sanitizedDraft.category = data.editorialDraft.category;
            }
            else {
                throw new https_1.HttpsError('invalid-argument', `INVALID_CATEGORY: Category must be one of: ${CANONICAL_CATEGORIES.join(', ')}`);
            }
        }
        try {
            const updated = await youtubeAppService.updateEditorialDraft(data.candidateId.trim(), sanitizedDraft);
            return { candidate: updated };
        }
        catch (err) {
            if (err instanceof https_1.HttpsError)
                throw err;
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('terminal')) {
                throw new https_1.HttpsError('failed-precondition', `INVALID_TRANSITION: ${msg}`);
            }
            if (msg.includes('not found')) {
                throw new https_1.HttpsError('not-found', `NOT_FOUND: ${msg}`);
            }
            throw new https_1.HttpsError('internal', `UPDATE_DRAFT_FAILED: ${msg}`);
        }
    }
    if (action === 'reject') {
        await authenticateAndAuthorize(requestContext, admin_1.AdminPermission.Review, adminRepo);
        if (typeof data.candidateId !== 'string' || data.candidateId.trim() === '') {
            throw new https_1.HttpsError('invalid-argument', 'INVALID_ARGUMENT: candidateId is required');
        }
        if (typeof data.reviewedVersion !== 'number') {
            throw new https_1.HttpsError('invalid-argument', 'INVALID_ARGUMENT: reviewedVersion must be a number');
        }
        try {
            const rejected = await youtubeAppService.rejectCandidate(data.candidateId.trim(), data.reviewedVersion);
            return { candidate: rejected };
        }
        catch (err) {
            if (err instanceof https_1.HttpsError)
                throw err;
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('Stale Review')) {
                throw new https_1.HttpsError('failed-precondition', `STALE_REVIEW: ${msg}`);
            }
            if (msg.includes('terminal')) {
                throw new https_1.HttpsError('failed-precondition', `INVALID_TRANSITION: ${msg}`);
            }
            if (msg.includes('not found')) {
                throw new https_1.HttpsError('not-found', `NOT_FOUND: ${msg}`);
            }
            throw new https_1.HttpsError('internal', `REJECT_FAILED: ${msg}`);
        }
    }
    throw new https_1.HttpsError('invalid-argument', 'INVALID_ACTION: Unsupported action requested');
}
/**
 * Authenticated YouTube Admin Query / Config Callable Function.
 * Reuses canonical ManageSettings and Review permissions.
 */
exports.manageYouTubeIntegration = (0, https_1.onCall)({
    enforceAppCheck: false,
}, async (request) => {
    return executeManageYouTubeIntegrationRequest({ auth: request.auth, data: request.data });
});
/**
 * Authenticated YouTube Review Mutation Callable Function.
 * Reuses canonical Edit and Review permissions.
 */
exports.reviewYouTubeCandidate = (0, https_1.onCall)({
    enforceAppCheck: false,
}, async (request) => {
    return executeReviewYouTubeCandidateRequest({ auth: request.auth, data: request.data });
});
//# sourceMappingURL=youtubeAdminHandlers.js.map