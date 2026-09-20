import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { YoutubeApplicationService } from './youtubeApplicationService';
import { YouTubeCandidateAcceptanceService } from './candidateAcceptanceService';
import type { AdminRepository } from '../admin/adminRepository';
import { FirestoreAdminRepository } from '../admin/firestoreAdminRepository';
import { AdminAuthorizationService } from '../admin/adminAuthorizationService';
import { AdminPermission } from '../types/admin';
import type { AdminUser } from '../types/admin';
import {
  type CandidateLifecycleStatus,
  type CandidateEditorialDraft,
  CANONICAL_CATEGORIES,
  isCanonicalCategory,
} from '../types/youtube';

export interface AdminRequestContext {
  auth?: {
    uid: string;
  };
  data?: any;
}

async function authenticateAndAuthorize(
  requestContext: AdminRequestContext,
  requiredPermission: AdminPermission,
  adminRepo: AdminRepository
): Promise<AdminUser> {
  if (!requestContext.auth || !requestContext.auth.uid || requestContext.auth.uid.trim() === '') {
    throw new HttpsError('unauthenticated', 'UNAUTHENTICATED: Request missing valid Firebase Authentication token');
  }

  const uid = requestContext.auth.uid.trim();
  let admin: AdminUser | null = null;
  try {
    admin = await adminRepo.getAdminByUid(uid);
  } catch (_err) {
    throw new HttpsError('internal', 'ADMIN_LOOKUP_FAILED: Failed to verify admin identity');
  }

  if (!admin) {
    throw new HttpsError('permission-denied', 'ADMIN_NOT_REGISTERED: User identity is not registered as a canonical AdminUser');
  }

  if (!admin.isActive) {
    throw new HttpsError('permission-denied', 'ADMIN_INACTIVE: AdminUser account is inactive');
  }

  const isAuthorized = AdminAuthorizationService.hasPermission(admin, requiredPermission);
  if (!isAuthorized) {
    throw new HttpsError('permission-denied', `PERMISSION_DENIED: AdminUser lacks required ${requiredPermission} permission`);
  }

  return admin;
}

/**
 * Pure core business logic handler for YouTube Admin config and query requests.
 * Decoupled from the v2 HTTPS protocol layer to enable 100% offline security TDD.
 */
export async function executeManageYouTubeIntegrationRequest(
  requestContext: AdminRequestContext,
  adminRepo: AdminRepository = new FirestoreAdminRepository(),
  youtubeAppService: YoutubeApplicationService = new YoutubeApplicationService()
): Promise<any> {
  const data = requestContext.data || {};
  const action = data.action;

  if (action === 'getConfig') {
    await authenticateAndAuthorize(requestContext, AdminPermission.ManageSettings, adminRepo);
    try {
      const config = await youtubeAppService.getConfiguration();
      return { config };
    } catch (err: any) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', 'CONFIG_FETCH_FAILED: Unable to retrieve YouTube integration configuration');
    }
  }

  if (action === 'updateConfig') {
    await authenticateAndAuthorize(requestContext, AdminPermission.ManageSettings, adminRepo);

    if (typeof data.channelId !== 'string' || data.channelId.trim() === '') {
      throw new HttpsError('invalid-argument', 'INVALID_CONFIG: channelId must be a non-empty string');
    }
    if (typeof data.enabled !== 'boolean') {
      throw new HttpsError('invalid-argument', 'INVALID_CONFIG: enabled must be a boolean');
    }
    if (typeof data.version !== 'number') {
      throw new HttpsError('invalid-argument', 'INVALID_CONFIG: version must be a valid number');
    }

    try {
      const config = await youtubeAppService.updateConfiguration({
        channelId: data.channelId.trim(),
        enabled: data.enabled,
        version: data.version
      });
      return { config };
    } catch (err: any) {
      if (err instanceof HttpsError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Concurrency conflict')) {
        throw new HttpsError('aborted', 'CONCURRENCY_CONFLICT: YouTube configuration version mismatch. Refresh and retry.');
      }
      throw new HttpsError('internal', 'CONFIG_UPDATE_FAILED: Unable to update YouTube configuration');
    }
  }

  if (action === 'listCandidates') {
    await authenticateAndAuthorize(requestContext, AdminPermission.Review, adminRepo);

    let statusFilter: CandidateLifecycleStatus | undefined;
    if (data.status) {
      if (!['PendingReview', 'Accepted', 'Rejected'].includes(data.status)) {
        throw new HttpsError('invalid-argument', 'INVALID_STATUS: Invalid candidate lifecycle status filter');
      }
      statusFilter = data.status as CandidateLifecycleStatus;
    }

    try {
      const candidates = await youtubeAppService.listCandidates(statusFilter ? { status: statusFilter } : undefined);
      return { candidates };
    } catch (err: any) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', 'LIST_CANDIDATES_FAILED: Unable to list YouTube import candidates');
    }
  }

  if (action === 'getCandidate') {
    await authenticateAndAuthorize(requestContext, AdminPermission.Review, adminRepo);

    if (typeof data.id !== 'string' || data.id.trim() === '') {
      throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: Candidate id is required');
    }

    try {
      const candidate = await youtubeAppService.getCandidate(data.id.trim());
      return { candidate };
    } catch (err: any) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', 'GET_CANDIDATE_FAILED: Unable to retrieve YouTube import candidate');
    }
  }

  throw new HttpsError('invalid-argument', 'INVALID_ACTION: Unsupported action requested');
}

/**
 * Pure core business logic handler for YouTube Candidate review mutations.
 * Decoupled from the v2 HTTPS protocol layer to enable 100% offline security TDD.
 */
export async function executeReviewYouTubeCandidateRequest(
  requestContext: AdminRequestContext,
  adminRepo: AdminRepository = new FirestoreAdminRepository(),
  youtubeAppService: YoutubeApplicationService = new YoutubeApplicationService(),
  acceptanceService: YouTubeCandidateAcceptanceService = new YouTubeCandidateAcceptanceService()
): Promise<any> {
  const data = requestContext.data || {};
  const action = data.action;

  if (action === 'updateDraft') {
    await authenticateAndAuthorize(requestContext, AdminPermission.Edit, adminRepo);

    if (typeof data.candidateId !== 'string' || data.candidateId.trim() === '') {
      throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: candidateId is required');
    }
    if (!data.editorialDraft || typeof data.editorialDraft !== 'object') {
      throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: editorialDraft must be an object');
    }

    // Only allow human-controlled editorial fields to be modified
    const sanitizedDraft: Partial<CandidateEditorialDraft> = {};
    if (typeof data.editorialDraft.titleAr === 'string') sanitizedDraft.titleAr = data.editorialDraft.titleAr;
    if (typeof data.editorialDraft.titleEn === 'string') sanitizedDraft.titleEn = data.editorialDraft.titleEn;
    if (typeof data.editorialDraft.excerptAr === 'string') sanitizedDraft.excerptAr = data.editorialDraft.excerptAr;
    if (typeof data.editorialDraft.excerptEn === 'string') sanitizedDraft.excerptEn = data.editorialDraft.excerptEn;
    if (typeof data.editorialDraft.editorialDescriptionAr === 'string') sanitizedDraft.editorialDescriptionAr = data.editorialDraft.editorialDescriptionAr;
    if (typeof data.editorialDraft.editorialDescriptionEn === 'string') sanitizedDraft.editorialDescriptionEn = data.editorialDraft.editorialDescriptionEn;
    if (Array.isArray(data.editorialDraft.tags)) {
      sanitizedDraft.tags = data.editorialDraft.tags.map((t: any) => String(t).trim()).filter((t: string) => t !== '');
    }

    if (data.editorialDraft.category !== undefined) {
      if (data.editorialDraft.category === null || data.editorialDraft.category === '') {
        sanitizedDraft.category = undefined;
      } else if (isCanonicalCategory(data.editorialDraft.category)) {
        sanitizedDraft.category = data.editorialDraft.category;
      } else {
        throw new HttpsError('invalid-argument', `INVALID_CATEGORY: Category must be one of: ${CANONICAL_CATEGORIES.join(', ')}`);
      }
    }

    try {
      const updated = await youtubeAppService.updateEditorialDraft(data.candidateId.trim(), sanitizedDraft);
      return { candidate: updated };
    } catch (err: any) {
      if (err instanceof HttpsError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('terminal')) {
        throw new HttpsError('failed-precondition', 'INVALID_TRANSITION: Candidate is in a terminal state and cannot be edited');
      }
      if (msg.includes('not found')) {
        throw new HttpsError('not-found', 'NOT_FOUND: YouTube candidate was not found');
      }
      throw new HttpsError('internal', 'UPDATE_DRAFT_FAILED: Unable to update editorial draft');
    }
  }

  if (action === 'reject') {
    await authenticateAndAuthorize(requestContext, AdminPermission.Review, adminRepo);

    if (typeof data.candidateId !== 'string' || data.candidateId.trim() === '') {
      throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: candidateId is required');
    }
    if (typeof data.reviewedVersion !== 'number') {
      throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: reviewedVersion must be a number');
    }

    try {
      const rejected = await youtubeAppService.rejectCandidate(data.candidateId.trim(), data.reviewedVersion);
      return { candidate: rejected };
    } catch (err: any) {
      if (err instanceof HttpsError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Stale Review')) {
        throw new HttpsError('failed-precondition', 'STALE_REVIEW: Candidate material was updated since review began. Please refresh and review latest changes.');
      }
      if (msg.includes('terminal')) {
        throw new HttpsError('failed-precondition', 'INVALID_TRANSITION: Candidate is already in a terminal state');
      }
      if (msg.includes('not found')) {
        throw new HttpsError('not-found', 'NOT_FOUND: YouTube candidate was not found');
      }
      throw new HttpsError('internal', 'REJECT_FAILED: Unable to reject candidate');
    }
  }

  if (action === 'accept') {
    await authenticateAndAuthorize(requestContext, AdminPermission.Review, adminRepo);

    if (typeof data.candidateId !== 'string' || data.candidateId.trim() === '') {
      throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: candidateId is required');
    }
    if (typeof data.reviewedVersion !== 'number') {
      throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: reviewedVersion must be a number');
    }

    try {
      const result = await acceptanceService.acceptCandidate(data.candidateId.trim(), data.reviewedVersion);
      return {
        candidate: result.candidate,
        video: result.video,
      };
    } catch (err: any) {
      if (err instanceof HttpsError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('STALE_REVIEW')) {
        throw new HttpsError('failed-precondition', 'STALE_REVIEW: Candidate material was updated since review began. Please refresh and review latest changes.');
      }
      if (msg.includes('INVALID_TRANSITION')) {
        throw new HttpsError('failed-precondition', 'INVALID_TRANSITION: Candidate is already in a terminal state');
      }
      if (msg.includes('NOT_FOUND')) {
        throw new HttpsError('not-found', 'NOT_FOUND: YouTube candidate was not found');
      }
      if (msg.includes('INVALID_CATEGORY')) {
        throw new HttpsError('failed-precondition', 'INVALID_CATEGORY: Canonical Category must be assigned by a human editor before acceptance');
      }
      if (msg.includes('DUPLICATE_MEDIA')) {
        throw new HttpsError('already-exists', 'DUPLICATE_MEDIA: Canonical Media already exists for this video');
      }
      throw new HttpsError('internal', 'ACCEPT_FAILED: Unable to atomically accept candidate into canonical Media');
    }
  }

  throw new HttpsError('invalid-argument', 'INVALID_ACTION: Unsupported action requested');
}

/**
 * Authenticated YouTube Admin Query / Config Callable Function.
 * Reuses canonical ManageSettings and Review permissions.
 */
export const manageYouTubeIntegration = onCall(
  {
    enforceAppCheck: false,
  },
  async (request) => {
    return executeManageYouTubeIntegrationRequest(
      { auth: request.auth, data: request.data }
    );
  }
);

/**
 * Authenticated YouTube Review Mutation Callable Function.
 * Reuses canonical Edit and Review permissions.
 */
export const reviewYouTubeCandidate = onCall(
  {
    enforceAppCheck: false,
  },
  async (request) => {
    return executeReviewYouTubeCandidateRequest(
      { auth: request.auth, data: request.data }
    );
  }
);
