import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

// Initialize admin SDK automatically inside functions
import { initializeApp } from "firebase-admin/app";
initializeApp();

export { syncYouTubeUploads } from "./youtube/manualSyncHandler";
export { manageYouTubeIntegration, reviewYouTubeCandidate } from "./youtube/youtubeAdminHandlers";
export { manageMedia } from "./media/mediaAdminHandlers";
export { manageLibraryDocuments, getPublicLibrary } from "./library/libraryAdminHandlers";
export { managePlatformSettings } from "./settings/platformSettingsAdminHandlers";
export { peiaPendingTaskGateway } from "./peia/firebasePendingTaskHttpEndpoint";
export { peiaAdvisoryResultSubmission } from "./peia/firebaseAdvisoryResultSubmissionEndpoint";
export { peiaNonAdvisoryOutcomeSubmission } from "./peia/firebaseNonAdvisoryOutcomeSubmissionEndpoint";
export { PublicMediaRepository } from "./media/publicMediaRepository";
export { manageNews, getPublicNews } from "./news/newsAdminHandlers";
export { editorialNewsImageUpload } from "./news/editorialNewsImageUploadEndpoint";
export { editorialImagePreviewEndpoint } from "./news/editorialImagePreviewEndpoint";
export { submitCitizenReport, manageCitizenSubmissions } from "./community/communityHandlers";
export { listAdminUsers } from "./admin/adminUserDirectoryHandlers";
export { manageAdminInvitations } from "./admin/adminInvitationHandlers";

/**
 * Public Multimedia Gateway conforming to Firebase v2 onCall callable protocol.
 * Returns strictly filtered and DTO-sanitized public videos and canonical playlists.
 */
export const getPublicMultimedia = onCall({ cors: true }, async (_request) => {
  try {
    const { PublicMediaRepository } = await import("./media/publicMediaRepository");
    const repo = new PublicMediaRepository();
    const videos = await repo.listPublicVideos();
    const playlists = await repo.listPublicPlaylists(videos.map((v) => v.id));
    return { videos, playlists };
  } catch (error: any) {
    logger.error("Failed to retrieve public multimedia", error);
    throw new HttpsError("internal", "Failed to retrieve public multimedia");
  }
});

/**
 * Basic HTTPS onRequest skeleton conforming to 2nd-gen specifications.
 * This can act as a secure gateway for future administrative triggers.
 */
export const helloWorld = onRequest({ cors: true }, (request, response) => {
  logger.info("Firebase functions 2nd gen initialized safely.", { structuredData: true });
  response.send("Hello from Promise of Planet 2nd-Gen Backend!");
});

