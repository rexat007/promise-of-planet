import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

// Initialize admin SDK automatically inside functions
import { initializeApp } from "firebase-admin/app";
initializeApp();

/**
 * Basic HTTPS onRequest skeleton conforming to 2nd-gen specifications.
 * This can act as a secure gateway for future administrative triggers.
 */
export const helloWorld = onRequest({ cors: true }, (request, response) => {
  logger.info("Firebase functions 2nd gen initialized safely.", { structuredData: true });
  response.send("Hello from Promise of Planet 2nd-Gen Backend!");
});
