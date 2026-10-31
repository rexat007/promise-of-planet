import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { youtubeApiKeySecret } from './youtubeSecrets';
import {
  YoutubeApplicationService,
  YOUTUBE_SYNC_DIAGNOSTIC_STAGES,
  extractYouTubeSyncStage,
  isYouTubeSyncDiagnosticStage,
  type YouTubeSyncDiagnosticStage,
} from './youtubeApplicationService';
import type { AdminRepository } from '../admin/adminRepository';
import { FirestoreAdminRepository } from '../admin/firestoreAdminRepository';
import { AdminAuthorizationService } from '../admin/adminAuthorizationService';
import { AdminPermission } from '../types/admin';
import type { YouTubeFetchResult } from '../types/youtube';

export { YOUTUBE_SYNC_DIAGNOSTIC_STAGES, type YouTubeSyncDiagnosticStage };

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

export type YouTubeSyncBackendErrorCode =
  | 'FIRESTORE_CANCELLED'
  | 'FIRESTORE_UNKNOWN'
  | 'FIRESTORE_INVALID_ARGUMENT'
  | 'FIRESTORE_DEADLINE_EXCEEDED'
  | 'FIRESTORE_NOT_FOUND'
  | 'FIRESTORE_ALREADY_EXISTS'
  | 'FIRESTORE_PERMISSION_DENIED'
  | 'FIRESTORE_RESOURCE_EXHAUSTED'
  | 'FIRESTORE_FAILED_PRECONDITION'
  | 'FIRESTORE_ABORTED'
  | 'FIRESTORE_UNIMPLEMENTED'
  | 'FIRESTORE_INTERNAL'
  | 'FIRESTORE_UNAVAILABLE'
  | 'FIRESTORE_UNAUTHENTICATED'
  | 'FIREBASE_APP_NOT_INITIALIZED'
  | 'ABORT_ERROR'
  | 'TIMEOUT_ERROR'
  | 'ETIMEDOUT'
  | 'ECONNRESET'
  | 'ECONNREFUSED'
  | 'ENOTFOUND'
  | 'EAI_AGAIN'
  | 'UND_ERR_CONNECT_TIMEOUT'
  | 'FETCH_FAILED'
  | 'UPSTREAM_HTTP_400'
  | 'UPSTREAM_HTTP_401'
  | 'UPSTREAM_HTTP_403'
  | 'UPSTREAM_HTTP_404'
  | 'UPSTREAM_HTTP_429'
  | 'UPSTREAM_HTTP_500'
  | 'UPSTREAM_HTTP_502'
  | 'UPSTREAM_HTTP_503'
  | 'UPSTREAM_HTTP_504';

export interface YouTubeSyncFailureDiagnosticEvent {
  event: typeof YOUTUBE_SYNC_FAILURE_DIAGNOSTIC;
  stage: YouTubeSyncDiagnosticStage;
  category: YouTubeSyncDiagnosticCategory;
  httpStatus: number | null;
  reasonCode: YouTubeSyncDiagnosticReasonCode;
  backendErrorCode: YouTubeSyncBackendErrorCode | null;
}

function unwrapUnderlyingError(err: unknown): unknown {
  if (
    err &&
    typeof err === 'object' &&
    (err as Record<string, unknown>).name === 'YouTubeSyncStageError' &&
    (err as Record<string, unknown>).cause !== undefined
  ) {
    return (err as Record<string, unknown>).cause;
  }
  return err;
}

function extractSafeHttpStatus(err: unknown, rawMsg: string): number | null {
  const target = unwrapUnderlyingError(err);
  if (target && typeof target === 'object') {
    const candidate =
      (target as Record<string, unknown>).httpStatus ??
      (target as Record<string, unknown>).status ??
      (target as Record<string, unknown>).statusCode;
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

function extractSafeBackendErrorCode(
  err: unknown,
  lowerMsg: string,
  errName: string,
  httpStatus: number | null
): YouTubeSyncBackendErrorCode | null {
  const target = unwrapUnderlyingError(err);
  const rawCode =
    target && typeof target === 'object' ? (target as Record<string, unknown>).code : undefined;

  if (typeof rawCode === 'number' && Number.isInteger(rawCode)) {
    switch (rawCode) {
      case 1:
        return 'FIRESTORE_CANCELLED';
      case 2:
        return 'FIRESTORE_UNKNOWN';
      case 3:
        return 'FIRESTORE_INVALID_ARGUMENT';
      case 4:
        return 'FIRESTORE_DEADLINE_EXCEEDED';
      case 5:
        return 'FIRESTORE_NOT_FOUND';
      case 6:
        return 'FIRESTORE_ALREADY_EXISTS';
      case 7:
        return 'FIRESTORE_PERMISSION_DENIED';
      case 8:
        return 'FIRESTORE_RESOURCE_EXHAUSTED';
      case 9:
        return 'FIRESTORE_FAILED_PRECONDITION';
      case 10:
        return 'FIRESTORE_ABORTED';
      case 12:
        return 'FIRESTORE_UNIMPLEMENTED';
      case 13:
        return 'FIRESTORE_INTERNAL';
      case 14:
        return 'FIRESTORE_UNAVAILABLE';
      case 16:
        return 'FIRESTORE_UNAUTHENTICATED';
      default:
        break;
    }
  }

  if (typeof rawCode === 'string') {
    const normalized = rawCode.trim().toLowerCase().replace(/^firestore\//, '');
    switch (normalized) {
      case 'app/no-app':
        return 'FIREBASE_APP_NOT_INITIALIZED';
      case 'cancelled':
      case 'canceled':
      case '1':
        return 'FIRESTORE_CANCELLED';
      case 'unknown':
      case '2':
        return 'FIRESTORE_UNKNOWN';
      case 'invalid-argument':
      case 'invalid_argument':
      case '3':
        return 'FIRESTORE_INVALID_ARGUMENT';
      case 'deadline-exceeded':
      case 'deadline_exceeded':
      case '4':
        return 'FIRESTORE_DEADLINE_EXCEEDED';
      case 'not-found':
      case 'not_found':
      case '5':
        return 'FIRESTORE_NOT_FOUND';
      case 'already-exists':
      case 'already_exists':
      case '6':
        return 'FIRESTORE_ALREADY_EXISTS';
      case 'permission-denied':
      case 'permission_denied':
      case '7':
        return 'FIRESTORE_PERMISSION_DENIED';
      case 'resource-exhausted':
      case 'resource_exhausted':
      case '8':
        return 'FIRESTORE_RESOURCE_EXHAUSTED';
      case 'failed-precondition':
      case 'failed_precondition':
      case '9':
        return 'FIRESTORE_FAILED_PRECONDITION';
      case 'aborted':
      case '10':
        return 'FIRESTORE_ABORTED';
      case 'unimplemented':
      case '12':
        return 'FIRESTORE_UNIMPLEMENTED';
      case 'internal':
      case '13':
        return 'FIRESTORE_INTERNAL';
      case 'unavailable':
      case '14':
        return 'FIRESTORE_UNAVAILABLE';
      case 'unauthenticated':
      case '16':
        return 'FIRESTORE_UNAUTHENTICATED';
      case 'etimedout':
        return 'ETIMEDOUT';
      case 'econnreset':
        return 'ECONNRESET';
      case 'econnrefused':
        return 'ECONNREFUSED';
      case 'enotfound':
        return 'ENOTFOUND';
      case 'eai_again':
        return 'EAI_AGAIN';
      case 'und_err_connect_timeout':
        return 'UND_ERR_CONNECT_TIMEOUT';
      case 'aborterror':
      case 'abort_err':
        return 'ABORT_ERROR';
      default:
        break;
    }
  }

  if (errName === 'aborterror') {
    return 'ABORT_ERROR';
  }
  if (errName === 'timeouterror') {
    return 'TIMEOUT_ERROR';
  }

  if (
    lowerMsg.includes('not a valid firestore document') ||
    lowerMsg.includes('cannot use "undefined" as a firestore value')
  ) {
    return 'FIRESTORE_INVALID_ARGUMENT';
  }

  if (lowerMsg.includes('default firebase app does not exist')) {
    return 'FIREBASE_APP_NOT_INITIALIZED';
  }

  if (lowerMsg.includes('fetch failed')) {
    return 'FETCH_FAILED';
  }

  switch (httpStatus) {
    case 400:
      return 'UPSTREAM_HTTP_400';
    case 401:
      return 'UPSTREAM_HTTP_401';
    case 403:
      return 'UPSTREAM_HTTP_403';
    case 404:
      return 'UPSTREAM_HTTP_404';
    case 429:
      return 'UPSTREAM_HTTP_429';
    case 500:
      return 'UPSTREAM_HTTP_500';
    case 502:
      return 'UPSTREAM_HTTP_502';
    case 503:
      return 'UPSTREAM_HTTP_503';
    case 504:
      return 'UPSTREAM_HTTP_504';
    default:
      return null;
  }
}

function resolveDiagnosticStage(
  err: unknown,
  lowerMsg: string,
  fallbackStage?: YouTubeSyncDiagnosticStage
): YouTubeSyncDiagnosticStage {
  const extracted = extractYouTubeSyncStage(err);
  if (extracted) {
    return extracted;
  }
  if (fallbackStage && isYouTubeSyncDiagnosticStage(fallbackStage)) {
    return fallbackStage;
  }
  if (
    lowerMsg.includes('configuration missing') ||
    lowerMsg.includes('not initialized') ||
    lowerMsg.includes('disabled') ||
    lowerMsg.includes('invalid configuration') ||
    lowerMsg.includes('invalid channelid') ||
    lowerMsg.includes('channelid is required')
  ) {
    return 'CONFIG_VALIDATE';
  }
  return 'UPLOADS_PLAYLIST_LOOKUP';
}

/**
 * Classifies a YouTube synchronization failure into an allowlisted diagnostic event
 * without exposing API keys, URLs, headers, raw upstream bodies, or stack traces.
 */
export function classifyYouTubeSyncFailure(
  err: unknown,
  fallbackStage?: YouTubeSyncDiagnosticStage
): YouTubeSyncFailureDiagnosticEvent {
  const underlying = unwrapUnderlyingError(err);
  const rawMsg =
    underlying instanceof Error
      ? underlying.message
      : err instanceof Error
        ? err.message
        : typeof underlying === 'string'
          ? underlying
          : '';
  const lowerMsg = rawMsg.toLowerCase();
  const errName =
    underlying instanceof Error
      ? underlying.name.toLowerCase()
      : err instanceof Error
        ? err.name.toLowerCase()
        : '';
  const errCode =
    underlying && typeof underlying === 'object' && typeof (underlying as Record<string, unknown>).code === 'string'
      ? ((underlying as Record<string, unknown>).code as string).toLowerCase()
      : '';

  const stage = resolveDiagnosticStage(err, lowerMsg, fallbackStage);
  const httpStatus = extractSafeHttpStatus(err, rawMsg);
  const backendErrorCode = extractSafeBackendErrorCode(err, lowerMsg, errName, httpStatus);

  if (lowerMsg.includes('youtube_api_key') || lowerMsg.includes('api key missing')) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      stage,
      category: 'MISSING_CONFIGURATION',
      httpStatus,
      reasonCode: 'API_KEY_SECRET_MISSING',
      backendErrorCode,
    };
  }

  if (lowerMsg.includes('disabled')) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      stage,
      category: 'MISSING_CONFIGURATION',
      httpStatus,
      reasonCode: 'INTEGRATION_DISABLED',
      backendErrorCode,
    };
  }

  if (lowerMsg.includes('configuration missing') || lowerMsg.includes('not initialized')) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      stage,
      category: 'MISSING_CONFIGURATION',
      httpStatus,
      reasonCode: 'CONFIG_DOCUMENT_MISSING',
      backendErrorCode,
    };
  }

  if (lowerMsg.includes('uploads playlist missing') || lowerMsg.includes('invalid uploadsplaylistid')) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      stage,
      category: 'MISSING_CONFIGURATION',
      httpStatus,
      reasonCode: 'UPLOADS_PLAYLIST_MISSING',
      backendErrorCode,
    };
  }

  if (
    lowerMsg.includes('invalid configuration') ||
    lowerMsg.includes('invalid channelid') ||
    lowerMsg.includes('channelid is required')
  ) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      stage,
      category: 'MISSING_CONFIGURATION',
      httpStatus,
      reasonCode: 'CHANNEL_ID_MISSING_OR_INVALID',
      backendErrorCode,
    };
  }

  if (lowerMsg.includes('missing')) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      stage,
      category: 'MISSING_CONFIGURATION',
      httpStatus,
      reasonCode: 'CONFIGURATION_INCOMPLETE',
      backendErrorCode,
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
      stage,
      category: 'NETWORK_TIMEOUT',
      httpStatus,
      reasonCode: 'UPSTREAM_REQUEST_TIMEOUT',
      backendErrorCode,
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
      stage,
      category: 'QUOTA_OR_RATE_LIMITED',
      httpStatus,
      reasonCode: httpStatus === 429 ? 'UPSTREAM_RATE_LIMITED_429' : 'UPSTREAM_QUOTA_OR_RATE_LIMIT',
      backendErrorCode,
    };
  }

  if (httpStatus === 401) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      stage,
      category: 'AUTH_OR_API_KEY_REJECTED',
      httpStatus: 401,
      reasonCode: 'UPSTREAM_UNAUTHORIZED_401',
      backendErrorCode,
    };
  }

  if (httpStatus === 403 || lowerMsg.includes('authorization or quota error (403)')) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      stage,
      category: 'AUTH_OR_API_KEY_REJECTED',
      httpStatus,
      reasonCode: 'UPSTREAM_FORBIDDEN_OR_AUTH_403',
      backendErrorCode,
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
      stage,
      category: 'AUTH_OR_API_KEY_REJECTED',
      httpStatus,
      reasonCode: 'API_KEY_OR_AUTH_REJECTED',
      backendErrorCode,
    };
  }

  if (httpStatus === 404 || lowerMsg.includes('resource not found (404)')) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      stage,
      category: 'UPSTREAM_SERVICE_FAILURE',
      httpStatus,
      reasonCode: 'UPSTREAM_RESOURCE_NOT_FOUND_404',
      backendErrorCode,
    };
  }

  if (lowerMsg.includes('channel not found or invalid')) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      stage,
      category: 'UPSTREAM_SERVICE_FAILURE',
      httpStatus,
      reasonCode: 'CHANNEL_NOT_FOUND_OR_INVALID',
      backendErrorCode,
    };
  }

  if (lowerMsg.includes('malformed youtube')) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      stage,
      category: 'UPSTREAM_SERVICE_FAILURE',
      httpStatus,
      reasonCode: 'UPSTREAM_MALFORMED_RESPONSE',
      backendErrorCode,
    };
  }

  if (httpStatus !== null && httpStatus >= 500 && httpStatus <= 599) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      stage,
      category: 'UPSTREAM_SERVICE_FAILURE',
      httpStatus,
      reasonCode: 'UPSTREAM_SERVER_ERROR_5XX',
      backendErrorCode,
    };
  }

  if (httpStatus === 400) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      stage,
      category: 'UPSTREAM_SERVICE_FAILURE',
      httpStatus: 400,
      reasonCode: 'UPSTREAM_BAD_REQUEST_400',
      backendErrorCode,
    };
  }

  if (httpStatus !== null && httpStatus >= 400 && httpStatus <= 499) {
    return {
      event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
      stage,
      category: 'UPSTREAM_SERVICE_FAILURE',
      httpStatus,
      reasonCode: 'UPSTREAM_CLIENT_ERROR_4XX',
      backendErrorCode,
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
      stage,
      category: 'UPSTREAM_SERVICE_FAILURE',
      httpStatus,
      reasonCode: 'UPSTREAM_HTTP_OR_NETWORK_ERROR',
      backendErrorCode,
    };
  }

  return {
    event: YOUTUBE_SYNC_FAILURE_DIAGNOSTIC,
    stage,
    category: 'UNKNOWN_UPSTREAM_FAILURE',
    httpStatus,
    reasonCode: 'UNCLASSIFIED_SYNC_ERROR',
    backendErrorCode,
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
