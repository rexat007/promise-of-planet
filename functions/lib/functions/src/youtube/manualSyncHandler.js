"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncYouTubeUploads = void 0;
exports.executeManualYouTubeSyncRequest = executeManualYouTubeSyncRequest;
const https_1 = require("firebase-functions/v2/https");
const youtubeSecrets_1 = require("./youtubeSecrets");
const youtubeApplicationService_1 = require("./youtubeApplicationService");
const firestoreAdminRepository_1 = require("../admin/firestoreAdminRepository");
const adminAuthorizationService_1 = require("../admin/adminAuthorizationService");
const admin_1 = require("../types/admin");
/**
 * Pure core business logic handler for manual YouTube synchronization.
 * Decoupled from the v2 HTTPS protocol layer to enable 100% offline security TDD.
 */
async function executeManualYouTubeSyncRequest(requestContext, adminRepo = new firestoreAdminRepository_1.FirestoreAdminRepository(), youtubeAppService = new youtubeApplicationService_1.YoutubeApplicationService()) {
    // 1. Authenticate Identity
    if (!requestContext.auth || !requestContext.auth.uid || requestContext.auth.uid.trim() === '') {
        throw new https_1.HttpsError('unauthenticated', 'UNAUTHENTICATED: Request missing valid Firebase Authentication token');
    }
    const uid = requestContext.auth.uid.trim();
    // 2. Resolve Canonical AdminUser
    const admin = await adminRepo.getAdminByUid(uid);
    if (!admin) {
        throw new https_1.HttpsError('permission-denied', 'ADMIN_NOT_REGISTERED: User identity is not registered as a canonical AdminUser');
    }
    // 3. Verify Active State
    if (!admin.isActive) {
        throw new https_1.HttpsError('permission-denied', 'ADMIN_INACTIVE: AdminUser account is inactive');
    }
    // 4. Evaluate Canonical Admin RBAC (Requires ManageSettings permission)
    const isAuthorized = adminAuthorizationService_1.AdminAuthorizationService.hasPermission(admin, admin_1.AdminPermission.ManageSettings);
    if (!isAuthorized) {
        throw new https_1.HttpsError('permission-denied', 'PERMISSION_DENIED: AdminUser lacks required ManageSettings permission');
    }
    // 5. Execute Manual YouTube Synchronization
    const pageToken = requestContext.data && typeof requestContext.data.pageToken === 'string' && requestContext.data.pageToken.trim() !== ''
        ? requestContext.data.pageToken.trim()
        : undefined;
    try {
        const result = await youtubeAppService.fetchChannelUploads({ pageToken });
        return {
            fetched: result.fetched,
            created: result.created,
            updated: result.updated,
            unchanged: result.unchanged,
            skippedTerminal: result.skippedTerminal,
            nextPageToken: result.nextPageToken,
        };
    }
    catch (err) {
        if (err instanceof https_1.HttpsError) {
            throw err;
        }
        const rawMsg = err instanceof Error ? err.message : String(err);
        if (rawMsg.toLowerCase().includes('disabled')) {
            throw new https_1.HttpsError('failed-precondition', `INTEGRATION_DISABLED: ${rawMsg}`);
        }
        if (rawMsg.toLowerCase().includes('missing')) {
            throw new https_1.HttpsError('failed-precondition', `CONFIGURATION_MISSING: ${rawMsg}`);
        }
        throw new https_1.HttpsError('unavailable', `UPSTREAM_YOUTUBE_ERROR: ${rawMsg}`);
    }
}
/**
 * Authenticated 2nd-Gen Firebase Callable Function for manual YouTube synchronization.
 * Bound strictly to the YOUTUBE_API_KEY Secret parameter.
 */
exports.syncYouTubeUploads = (0, https_1.onCall)({
    secrets: [youtubeSecrets_1.youtubeApiKeySecret],
}, async (request) => {
    const requestContext = {
        auth: request.auth ? { uid: request.auth.uid } : undefined,
        data: request.data,
    };
    return executeManualYouTubeSyncRequest(requestContext);
});
//# sourceMappingURL=manualSyncHandler.js.map