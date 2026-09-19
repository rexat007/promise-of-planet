"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.helloWorld = exports.reviewYouTubeCandidate = exports.manageYouTubeIntegration = exports.syncYouTubeUploads = void 0;
const https_1 = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
// Initialize admin SDK automatically inside functions
const app_1 = require("firebase-admin/app");
(0, app_1.initializeApp)();
var manualSyncHandler_1 = require("./youtube/manualSyncHandler");
Object.defineProperty(exports, "syncYouTubeUploads", { enumerable: true, get: function () { return manualSyncHandler_1.syncYouTubeUploads; } });
var youtubeAdminHandlers_1 = require("./youtube/youtubeAdminHandlers");
Object.defineProperty(exports, "manageYouTubeIntegration", { enumerable: true, get: function () { return youtubeAdminHandlers_1.manageYouTubeIntegration; } });
Object.defineProperty(exports, "reviewYouTubeCandidate", { enumerable: true, get: function () { return youtubeAdminHandlers_1.reviewYouTubeCandidate; } });
/**
 * Basic HTTPS onRequest skeleton conforming to 2nd-gen specifications.
 * This can act as a secure gateway for future administrative triggers.
 */
exports.helloWorld = (0, https_1.onRequest)({ cors: true }, (request, response) => {
    logger.info("Firebase functions 2nd gen initialized safely.", { structuredData: true });
    response.send("Hello from Promise of Planet 2nd-Gen Backend!");
});
//# sourceMappingURL=index.js.map