import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

// Initialize admin SDK automatically inside functions
import { initializeApp } from "firebase-admin/app";
initializeApp();

export { syncYouTubeUploads } from "./youtube/manualSyncHandler";
export { manageYouTubeIntegration, reviewYouTubeCandidate } from "./youtube/youtubeAdminHandlers";
export { manageMedia } from "./media/mediaAdminHandlers";
export { manageLibraryDocuments } from "./library/libraryAdminHandlers";
export { managePlatformSettings } from "./settings/platformSettingsAdminHandlers";
export { peiaPendingTaskGateway } from "./peia/firebasePendingTaskHttpEndpoint";
export { peiaAdvisoryResultSubmission } from "./peia/firebaseAdvisoryResultSubmissionEndpoint";
export { peiaNonAdvisoryOutcomeSubmission } from "./peia/firebaseNonAdvisoryOutcomeSubmissionEndpoint";
export { PublicMediaRepository } from "./media/publicMediaRepository";

/**
 * Public Multimedia Gateway conforming to Firebase v2 onRequest.
 * Returns strictly filtered public videos and canonical playlists.
 */
export const getPublicMultimedia = onRequest({ cors: true }, async (_request, response) => {
  try {
    const { PublicMediaRepository } = await import("./media/publicMediaRepository");
    const repo = new PublicMediaRepository();
    const [videos, playlists] = await Promise.all([
      repo.listPublicVideos(),
      repo.listPublicPlaylists(),
    ]);
    response.json({ videos, playlists });
  } catch (error: any) {
    logger.error("Failed to retrieve public multimedia", error);
    response.status(500).json({ error: "Failed to retrieve public multimedia" });
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

