import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { NewsApplicationService } from './newsApplicationService';
import { PublicNewsRepository } from './publicNewsRepository';
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

export async function executeManageNewsRequest(
  requestContext: AdminRequestContext,
  adminRepo: AdminRepository = new FirestoreAdminRepository(),
  newsService: NewsApplicationService = new NewsApplicationService()
): Promise<any> {
  const data = requestContext.data || {};
  const action = data.action;

  if (!action || typeof action !== 'string') {
    throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: Action parameter is required');
  }

  try {
    if (action === 'listAll') {
      await authenticateAndAuthorize(requestContext, AdminPermission.View, adminRepo);
      const items = await newsService.listAll();
      return { items };
    }

    if (action === 'getById') {
      await authenticateAndAuthorize(requestContext, AdminPermission.View, adminRepo);
      if (!data.id || typeof data.id !== 'string') {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: Item id is required');
      }
      const item = await newsService.getById(data.id.trim());
      return { item };
    }

    if (action === 'saveDraft') {
      const payload = data.item;
      if (!payload) {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: item payload is required');
      }

      const isUpdate = Boolean(payload.id);
      const requiredPermission = isUpdate ? AdminPermission.Edit : AdminPermission.Create;
      const admin = await authenticateAndAuthorize(requestContext, requiredPermission, adminRepo);

      const actor = {
        uid: admin.id,
        name: admin.name,
        role: admin.role,
      };

      if (payload.id) {
        const updated = await newsService.updateDraft(payload.id, payload, actor);
        return { item: updated };
      } else {
        const created = await newsService.createDraft(payload, actor);
        return { item: created };
      }
    }

    if (action === 'transitionWorkflow') {
      const { id, targetState, comment } = data;
      if (!id || !targetState) {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: id and targetState are required');
      }

      // Check required permission based on target state
      let requiredPermission: AdminPermission = AdminPermission.Edit;
      if (targetState === 'Approved') {
        requiredPermission = AdminPermission.Approve;
      } else if (targetState === 'Published') {
        requiredPermission = AdminPermission.Publish;
      }

      const admin = await authenticateAndAuthorize(requestContext, requiredPermission, adminRepo);
      const actor = {
        uid: admin.id,
        name: admin.name,
        role: admin.role,
      };

      const transitioned = await newsService.transitionWorkflow(id, targetState, actor, comment);
      return { item: transitioned };
    }

    throw new HttpsError('invalid-argument', `INVALID_ARGUMENT: Unrecognized action '${action}'`);
  } catch (err: any) {
    if (err instanceof HttpsError) throw err;
    throw new HttpsError('internal', err.message || 'Operation failed');
  }
}

/**
 * Callable Firebase Cloud Function for Newsroom administration.
 */
export const manageNews = onCall({ cors: true }, async (request) => {
  return executeManageNewsRequest({
    auth: request.auth ? { uid: request.auth.uid } : undefined,
    data: request.data,
  });
});

/**
 * Public Callable Cloud Function to retrieve sanitized, published news.
 */
export const getPublicNews = onCall({ cors: true }, async (request) => {
  try {
    const language = request.data?.lang === 'en' ? 'en' : 'ar';
    const repo = new PublicNewsRepository();
    const articles = await repo.listPublicNews(language);
    return { articles };
  } catch (error: any) {
    throw new HttpsError('internal', error.message || 'Failed to retrieve public news');
  }
});
