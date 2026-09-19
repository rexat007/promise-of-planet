import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { youtubeApiKeySecret } from './youtubeSecrets';
import { YoutubeApplicationService } from './youtubeApplicationService';
import type { AdminRepository } from '../admin/adminRepository';
import { FirestoreAdminRepository } from '../admin/firestoreAdminRepository';
import { AdminAuthorizationService } from '../admin/adminAuthorizationService';
import { AdminPermission } from '../types/admin';
import type { YouTubeFetchResult } from '../types/youtube';

export interface ManualSyncRequestContext {
  auth?: {
    uid: string;
  };
  data?: any;
}

/**
 * Pure core business logic handler for manual YouTube synchronization.
 * Decoupled from the v2 HTTPS protocol layer to enable 100% offline security TDD.
 */
export async function executeManualYouTubeSyncRequest(
  requestContext: ManualSyncRequestContext,
  adminRepo: AdminRepository = new FirestoreAdminRepository(),
  youtubeAppService: YoutubeApplicationService = new YoutubeApplicationService()
): Promise<YouTubeFetchResult> {
  // 1. Authenticate Identity
  if (!requestContext.auth || !requestContext.auth.uid || requestContext.auth.uid.trim() === '') {
    throw new HttpsError('unauthenticated', 'UNAUTHENTICATED: Request missing valid Firebase Authentication token');
  }

  const uid = requestContext.auth.uid.trim();

  // 2. Resolve Canonical AdminUser
  const admin = await adminRepo.getAdminByUid(uid);
  if (!admin) {
    throw new HttpsError('permission-denied', 'ADMIN_NOT_REGISTERED: User identity is not registered as a canonical AdminUser');
  }

  // 3. Verify Active State
  if (!admin.isActive) {
    throw new HttpsError('permission-denied', 'ADMIN_INACTIVE: AdminUser account is inactive');
  }

  // 4. Evaluate Canonical Admin RBAC (Requires ManageSettings permission)
  const isAuthorized = AdminAuthorizationService.hasPermission(admin, AdminPermission.ManageSettings);
  if (!isAuthorized) {
    throw new HttpsError('permission-denied', 'PERMISSION_DENIED: AdminUser lacks required ManageSettings permission');
  }

  // 5. Execute Manual YouTube Synchronization
  const pageToken =
    requestContext.data && typeof requestContext.data.pageToken === 'string' && requestContext.data.pageToken.trim() !== ''
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
  } catch (err: any) {
    if (err instanceof HttpsError) {
      throw err;
    }

    const rawMsg = err instanceof Error ? err.message : String(err);

    if (rawMsg.toLowerCase().includes('disabled')) {
      throw new HttpsError('failed-precondition', `INTEGRATION_DISABLED: ${rawMsg}`);
    }

    if (rawMsg.toLowerCase().includes('missing')) {
      throw new HttpsError('failed-precondition', `CONFIGURATION_MISSING: ${rawMsg}`);
    }

    throw new HttpsError('unavailable', `UPSTREAM_YOUTUBE_ERROR: ${rawMsg}`);
  }
}

/**
 * Authenticated 2nd-Gen Firebase Callable Function for manual YouTube synchronization.
 * Bound strictly to the YOUTUBE_API_KEY Secret parameter.
 */
export const syncYouTubeUploads = onCall(
  {
    secrets: [youtubeApiKeySecret],
  },
  async (request) => {
    const requestContext: ManualSyncRequestContext = {
      auth: request.auth ? { uid: request.auth.uid } : undefined,
      data: request.data,
    };
    return executeManualYouTubeSyncRequest(requestContext);
  }
);
