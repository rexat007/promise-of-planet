import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { youtubeApiKeySecret } from './youtubeSecrets';
import { YoutubeApplicationService } from './youtubeApplicationService';
import type { AdminRepository } from '../admin/adminRepository';
import { FirestoreAdminRepository } from '../admin/firestoreAdminRepository';
import { AdminAuthorizationService } from '../admin/adminAuthorizationService';
import { AdminPermission } from '../types/admin';
import type { YouTubeFetchResult } from '../types/youtube';

export const YOUTUBE_SYNC_FAILURE_DIAGNOSTIC = 'YOUTUBE_SYNC_FAILURE_DIAGNOSTIC' as const;

export type YouTubeSyncDiagnosticCategory =
  | 'MISSING_CONFIGURATION'
  | 'AUTH_OR_API_KEY_REJECTED'
  | 'QUOTA_OR_RATE_LIMITED'
  | 'UPSTREAM_SERVICE_FAILURE'
  | 'NETWORK_TIMEOUT'
  | 'UNKNOWN_UPSTREAM_FAILURE';

export type YouTubeSyncDiagnosticReasonCode =
  | 'API_KEY_SECRET_MISSING'
  | 'INTEGRATION_DISABLED'
  | 'CONFIG_DOCUMENT_MISSING'
  | 'UPLOADS_PLAYLIST_MISSING'
  | 'CHANNEL_ID_MISSING_OR_INVALID'
  | 'CONFIGURATION_INCOMPLETE'
  | 'UPSTREAM_REQUEST_TIMEOUT'
  | 'UPSTREAM_RATE_LIMITED_429'
  | 'UPSTREAM_QUOTA_OR_RATE_LIMIT'
  | 'UPSTREAM_UNAUTHORIZED_401'
  | 'UPSTREAM_FORBIDDEN_OR_AUTH_403'
  | 'API_KEY_OR_AUTH_REJECTED'
  | 'UPSTREAM_RESOURCE_NOT_FOUND_404'
  | 'CHANNEL_NOT_FOUND_OR_INVALID'
  | 'UPSTREAM_MALFORMED_RESPONSE'
  | 'UPSTREAM_BAD_REQUEST_400'
  | 'UPSTREAM_CLIENT_ERROR_4XX'
  | 'UPSTREAM_SERVER_ERROR_5XX'
  | 'UPSTREAM_HTTP_OR_NETWORK_ERROR'
  | 'UNCLASSIFIED_SYNC_ERROR';

export interface YouTubeSyncFailureDiagnosticEvent {
  event: typeof YOUTUBE_SYNC_FAILURE_DIAGNOSTIC;
  category: YouTubeSyncDiagnosticCategory;
  httpStatus: number | null;
  reasonCode: YouTubeSyncDiagnosticReasonCode;
}

function extractSafeHttpStatus(err: unknown, rawMsg: string): number | null {
  if (err && typeof err === 'object') {
    const candidate =
      (err as Record<string, unknown>).httpStatus ??
      (err as Record<string, unknown>).status ??
      (err as Record<string, unknown>).statusCode;
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 100 && candidate <= 599) {
      return candidate;
    }
  }

  const parenMatch = rawMsg.match(/\((403|404)\)/);
  if (parenMatch) {
    return Number(parenMatch[1]);
  }

  const httpErrorMatch = rawMsg.match(/youtube api http error:\s*(\d{3})\b/i);
  if (httpErrorMatch) {
    const parsed = Number(httpErrorMatch[1]);
    if (parsed >= 100 && parsed <= 599) {
      return parsed;
    }
  }

  return null;
}

/**
 * Classifies a YouTube synchronization failure into an allowlisted diagnostic event
 * without exposing API keys, URLs, headers, raw upstream bodies, or stack traces.
 */
export function classifyYouTubeSyncFailure(err: unknown): YouTubeSyncFailureDiagnosticEvent {
  const rawMsg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const lowerMsg = rawMsg.toLowerCase();
  const errName = err instanceof Error ? err.name.toLowerCase() : '';
  const errCode =
    err && typeof err === 'object' && typeof (err as Record<string, unknown>).code === 'string'
      ? ((err as Record<string, unknown>).code as string).toLowerCase()
      : '';

  const httpStatus = extractSafeHttpStatus(err, rawMsg);

  if (lowerMsg.includes('youtube_api_key') || lowerMsg.includes('api key missing')) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      category: 'MISSING_CONFIGURATION',
      httpStatus,
      reasonCode: 'API_KEY_SECRET_MISSING',
    };
  }

  if (lowerMsg.includes('disabled')) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      category: 'MISSING_CONFIGURATION',
      httpStatus,
      reasonCode: 'INTEGRATION_DISABLED',
    };
  }

  if (lowerMsg.includes('configuration missing') || lowerMsg.includes('not initialized')) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      category: 'MISSING_CONFIGURATION',
      httpStatus,
      reasonCode: 'CONFIG_DOCUMENT_MISSING',
    };
  }

  if (lowerMsg.includes('uploads playlist missing') || lowerMsg.includes('invalid uploadsplaylistid')) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      category: 'MISSING_CONFIGURATION',
      httpStatus,
      reasonCode: 'UPLOADS_PLAYLIST_MISSING',
    };
  }

  if (
    lowerMsg.includes('invalid configuration') ||
    lowerMsg.includes('invalid channelid') ||
    lowerMsg.includes('channelid is required')
  ) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      category: 'MISSING_CONFIGURATION',
      httpStatus,
      reasonCode: 'CHANNEL_ID_MISSING_OR_INVALID',
    };
  }

  if (lowerMsg.includes('missing')) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      category: 'MISSING_CONFIGURATION',
      httpStatus,
      reasonCode: 'CONFIGURATION_INCOMPLETE',
    };
  }

  if (
    errName === 'aborterror' ||
    errName === 'timeouterror' ||
    errCode === 'etimedout' ||
    errCode === 'und_err_connect_timeout' ||
    lowerMsg.includes('timed out') ||
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('etimedout') ||
    lowerMsg.includes('aborterror')
  ) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      category: 'NETWORK_TIMEOUT',
      httpStatus,
      reasonCode: 'UPSTREAM_REQUEST_TIMEOUT',
    };
  }

  if (
    httpStatus === 429 ||
    lowerMsg.includes('rate limit') ||
    lowerMsg.includes('ratelimit') ||
    lowerMsg.includes('too many requests') ||
    lowerMsg.includes('quota exceeded') ||
    lowerMsg.includes('quotaexceeded') ||
    lowerMsg.includes('dailylimitexceeded')
  ) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      category: 'QUOTA_OR_RATE_LIMITED',
      httpStatus: httpStatus ?? 429,
      reasonCode: httpStatus === 429 ? 'UPSTREAM_RATE_LIMITED_429' : 'UPSTREAM_QUOTA_OR_RATE_LIMIT',
    };
  }

  if (httpStatus === 401) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      category: 'AUTH_OR_API_KEY_REJECTED',
      httpStatus: 401,
      reasonCode: 'UPSTREAM_UNAUTHORIZED_401',
    };
  }

  if (httpStatus === 403 || lowerMsg.includes('authorization or quota error (403)')) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      category: 'AUTH_OR_API_KEY_REJECTED',
      httpStatus: httpStatus ?? 403,
      reasonCode: 'UPSTREAM_FORBIDDEN_OR_AUTH_403',
    };
  }

  if (
    lowerMsg.includes('api key not valid') ||
    lowerMsg.includes('keyinvalid') ||
    lowerMsg.includes('invalid api key') ||
    lowerMsg.includes('unauthorized') ||
    lowerMsg.includes('forbidden')
  ) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      category: 'AUTH_OR_API_KEY_REJECTED',
      httpStatus,
      reasonCode: 'API_KEY_OR_AUTH_REJECTED',
    };
  }

  if (httpStatus === 404 || lowerMsg.includes('resource not found (404)')) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      category: 'UPSTREAM_SERVICE_FAILURE',
      httpStatus: httpStatus ?? 404,
      reasonCode: 'UPSTREAM_RESOURCE_NOT_FOUND_404',
    };
  }

  if (lowerMsg.includes('channel not found or invalid')) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      category: 'UPSTREAM_SERVICE_FAILURE',
      httpStatus,
      reasonCode: 'CHANNEL_NOT_FOUND_OR_INVALID',
    };
  }

  if (lowerMsg.includes('malformed youtube')) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      category: 'UPSTREAM_SERVICE_FAILURE',
      httpStatus,
      reasonCode: 'UPSTREAM_MALFORMED_RESPONSE',
    };
  }

  if (httpStatus !== null && httpStatus >= 500 && httpStatus <= 599) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      category: 'UPSTREAM_SERVICE_FAILURE',
      httpStatus,
      reasonCode: 'UPSTREAM_SERVER_ERROR_5XX',
    };
  }

  if (httpStatus === 400) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      category: 'UPSTREAM_SERVICE_FAILURE',
      httpStatus: 400,
      reasonCode: 'UPSTREAM_BAD_REQUEST_400',
    };
  }

  if (httpStatus !== null && httpStatus >= 400 && httpStatus <= 499) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      category: 'UPSTREAM_SERVICE_FAILURE',
      httpStatus,
      reasonCode: 'UPSTREAM_CLIENT_ERROR_4XX',
    };
  }

  if (
    lowerMsg.includes('youtube api http error') ||
    lowerMsg.includes('fetch failed') ||
    errCode === 'econnreset' ||
    errCode === 'enotfound' ||
    errCode === 'econnrefused'
  ) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      category: 'UPSTREAM_SERVICE_FAILURE',
      httpStatus,
      reasonCode: 'UPSTREAM_HTTP_OR_NETWORK_ERROR',
    };
  }

  return {
    event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
    category: 'UNKNOWN_UPSTREAM_FAILURE',
    httpStatus,
    reasonCode: 'UNCLASSIFIED_SYNC_ERROR',
  };
}

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

    const diagnostic = classifyYouTubeSyncFailure(err);
    logger.error(YOUTUBE_SYNC_FAILURE_DIAGNOSTIC, diagnostic);

    const rawMsg = err instanceof Error ? err.message : String(err);

    if (rawMsg.toLowerCase().includes('disabled')) {
      throw new HttpsError('failed-precondition', 'INTEGRATION_DISABLED: YouTube integration is disabled');
    }

    if (rawMsg.toLowerCase().includes('missing')) {
      throw new HttpsError('failed-precondition', 'CONFIGURATION_MISSING: YouTube integration configuration is incomplete');
    }

    throw new HttpsError('unavailable', 'UPSTREAM_YOUTUBE_ERROR: Unable to synchronize with YouTube');
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
