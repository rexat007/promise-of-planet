import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { MediaApplicationService } from './mediaApplicationService';
import type { AdminRepository } from '../admin/adminRepository';
import { FirestoreAdminRepository } from '../admin/firestoreAdminRepository';
import { AdminAuthorizationService } from '../admin/adminAuthorizationService';
import { AdminPermission } from '../types/admin';
import type { AdminUser } from '../types/admin';

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

function mapMediaError(err: any): HttpsError {
  if (err instanceof HttpsError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('NOT_FOUND') || msg.includes('not found')) {
    return new HttpsError('not-found', msg);
  }
  if (msg.includes('DUPLICATE_MEDIA') || msg.includes('already registered')) {
    return new HttpsError('already-exists', msg);
  }
  if (msg.includes('INVALID_CATEGORY')) {
    return new HttpsError('invalid-argument', msg);
  }
  if (msg.includes('INVALID_RIGHTS_STATUS')) {
    return new HttpsError('invalid-argument', msg);
  }
  if (msg.includes('INVALID_VISIBILITY_DECISION')) {
    return new HttpsError('invalid-argument', msg);
  }
  if (msg.includes('DUPLICATE_RELATION')) {
    return new HttpsError('already-exists', msg);
  }
  if (msg.includes('VALIDATION_ERROR') || msg.includes('INVALID_ARGUMENT')) {
    return new HttpsError('invalid-argument', msg);
  }
  return new HttpsError('internal', `MEDIA_OPERATION_FAILED: ${msg}`);
}

export async function executeManageMediaRequest(
  requestContext: AdminRequestContext,
  adminRepo: AdminRepository = new FirestoreAdminRepository(),
  mediaAppService: MediaApplicationService = new MediaApplicationService()
): Promise<any> {
  const data = requestContext.data || {};
  const action = data.action;

  if (!action || typeof action !== 'string') {
    throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: Action parameter is required');
  }

  try {
    if (action === 'listAll') {
      await authenticateAndAuthorize(requestContext, AdminPermission.View, adminRepo);
      const videos = await mediaAppService.listAll();
      return { videos };
    }

    if (action === 'getById') {
      await authenticateAndAuthorize(requestContext, AdminPermission.View, adminRepo);
      if (!data.id || typeof data.id !== 'string' || data.id.trim() === '') {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: Video id is required');
      }
      const video = await mediaAppService.getById(data.id.trim());
      if (!video) {
        throw new HttpsError('not-found', `NOT_FOUND: Video ${data.id} not found`);
      }
      return { video };
    }

    if (action === 'getRelationsForVideo') {
      await authenticateAndAuthorize(requestContext, AdminPermission.View, adminRepo);
      if (!data.videoId || typeof data.videoId !== 'string' || data.videoId.trim() === '') {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: VideoId is required');
      }
      const relations = await mediaAppService.getRelationsForVideo(data.videoId.trim());
      return { relations };
    }

    if (action === 'register') {
      const admin = await authenticateAndAuthorize(requestContext, AdminPermission.Create, adminRepo);
      const input = data.input;
      if (!input || typeof input !== 'object') {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: Registration input object is required');
      }
      const videoInput = {
        ...input,
        editor: admin.name || 'Admin',
      };
      const video = await mediaAppService.register(videoInput);
      return { video };
    }

    if (action === 'updateMetadata') {
      await authenticateAndAuthorize(requestContext, AdminPermission.Edit, adminRepo);
      if (!data.id || typeof data.id !== 'string' || data.id.trim() === '') {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: Video id is required');
      }
      const updates = data.updates;
      if (!updates || typeof updates !== 'object') {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: Updates object is required');
      }
      const video = await mediaAppService.updateMetadata(data.id.trim(), updates);
      return { video };
    }

    if (action === 'updateRightsStatus') {
      await authenticateAndAuthorize(requestContext, AdminPermission.ManageRights, adminRepo);
      if (!data.id || typeof data.id !== 'string' || data.id.trim() === '') {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: Video id is required');
      }
      if (!data.rightsStatus || typeof data.rightsStatus !== 'string') {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: RightsStatus is required');
      }
      const video = await mediaAppService.updateRightsStatus(data.id.trim(), data.rightsStatus, data.notes);
      return { video };
    }

    if (action === 'updateVisibilityDecision') {
      await authenticateAndAuthorize(requestContext, AdminPermission.Review, adminRepo);
      if (!data.id || typeof data.id !== 'string' || data.id.trim() === '') {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: Video id is required');
      }
      if (!data.visibilityDecision || typeof data.visibilityDecision !== 'string') {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: VisibilityDecision is required');
      }
      const video = await mediaAppService.updateVisibilityDecision(data.id.trim(), data.visibilityDecision);
      return { video };
    }

    if (action === 'linkVideoToContent') {
      await authenticateAndAuthorize(requestContext, AdminPermission.Edit, adminRepo);
      if (!data.videoId || !data.contentId || !data.relationType || !data.placement) {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: videoId, contentId, relationType, and placement are required');
      }
      const relation = await mediaAppService.linkVideoToContent(
        data.videoId.trim(),
        data.contentId.trim(),
        data.relationType,
        data.placement,
        data.options
      );
      return { relation };
    }

    if (action === 'unlinkVideoFromContent') {
      await authenticateAndAuthorize(requestContext, AdminPermission.Edit, adminRepo);
      if (!data.videoId || !data.contentId) {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: videoId and contentId are required');
      }
      const success = await mediaAppService.unlinkVideoFromContent(data.videoId.trim(), data.contentId.trim());
      return { success };
    }

    throw new HttpsError('invalid-argument', 'INVALID_ACTION: Unsupported action requested');
  } catch (err: any) {
    throw mapMediaError(err);
  }
}

export const manageMedia = onCall({ cors: true }, async (request) => {
  return executeManageMediaRequest(request);
});
