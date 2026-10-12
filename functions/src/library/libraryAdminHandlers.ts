import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { LibraryApplicationService } from './libraryApplicationService';
import { FirestoreLibraryRepository } from './firestoreLibraryRepository';
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

function mapLibraryError(err: any): HttpsError {
  if (err instanceof HttpsError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('NOT_FOUND') || msg.includes('not found')) {
    return new HttpsError('not-found', msg);
  }
  if (msg.includes('DUPLICATE_DOCUMENT') || msg.includes('already exists')) {
    return new HttpsError('already-exists', msg);
  }
  if (msg.includes('PERMISSION_DENIED')) {
    return new HttpsError('permission-denied', msg);
  }
  if (msg.includes('VALIDATION_ERROR') || msg.includes('INVALID_ARGUMENT') || msg.includes('INVALID_TRANSITION')) {
    return new HttpsError('invalid-argument', msg);
  }
  return new HttpsError('internal', `LIBRARY_OPERATION_FAILED: ${msg}`);
}

export async function executeManageLibraryRequest(
  requestContext: AdminRequestContext,
  adminRepo: AdminRepository = new FirestoreAdminRepository(),
  libraryAppService: LibraryApplicationService = new LibraryApplicationService(new FirestoreLibraryRepository())
): Promise<any> {
  const data = requestContext.data || {};
  const action = data.action;

  if (!action || typeof action !== 'string') {
    throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: Action parameter is required');
  }

  try {
    if (action === 'listAll') {
      await authenticateAndAuthorize(requestContext, AdminPermission.View, adminRepo);
      const documents = await libraryAppService.listAll();
      return { documents };
    }

    if (action === 'getById') {
      await authenticateAndAuthorize(requestContext, AdminPermission.View, adminRepo);
      if (!data.id || typeof data.id !== 'string' || data.id.trim() === '') {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: Document id is required');
      }
      const document = await libraryAppService.getById(data.id.trim());
      if (!document) {
        throw new HttpsError('not-found', `NOT_FOUND: Document ${data.id} not found`);
      }
      return { document };
    }

    if (action === 'create') {
      const admin = await authenticateAndAuthorize(requestContext, AdminPermission.Create, adminRepo);
      const input = data.input;
      if (!input || typeof input !== 'object') {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: Document input object is required');
      }
      const document = await libraryAppService.create(input, admin);
      return { document };
    }

    if (action === 'updateMetadata') {
      const admin = await authenticateAndAuthorize(requestContext, AdminPermission.Edit, adminRepo);
      if (!data.id || typeof data.id !== 'string' || data.id.trim() === '') {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: Document id is required');
      }
      const updates = data.updates;
      if (!updates || typeof updates !== 'object') {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: Updates object is required');
      }
      const document = await libraryAppService.updateMetadata(data.id.trim(), updates, admin);
      return { document };
    }

    if (action === 'updateRights') {
      const admin = await authenticateAndAuthorize(requestContext, AdminPermission.ManageRights, adminRepo);
      if (!data.id || typeof data.id !== 'string' || data.id.trim() === '') {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: Document id is required');
      }
      if (!data.rightsStatus || typeof data.rightsStatus !== 'string') {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: RightsStatus is required');
      }
      const document = await libraryAppService.updateRights(
        data.id.trim(),
        data.rightsStatus,
        data.notesAr,
        data.notesEn,
        admin
      );
      return { document };
    }

    if (action === 'transitionWorkflow') {
      const admin = await authenticateAndAuthorize(requestContext, AdminPermission.Edit, adminRepo);
      if (!data.id || typeof data.id !== 'string' || data.id.trim() === '') {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: Document id is required');
      }
      if (!data.targetState || typeof data.targetState !== 'string') {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: TargetState is required');
      }
      const document = await libraryAppService.transitionWorkflow(
        data.id.trim(),
        data.targetState,
        data.comment,
        admin
      );
      return { document };
    }

    if (action === 'addVersion') {
      const admin = await authenticateAndAuthorize(requestContext, AdminPermission.Edit, adminRepo);
      if (!data.id || typeof data.id !== 'string' || data.id.trim() === '') {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: Document id is required');
      }
      const versionInput = data.versionInput;
      if (!versionInput || typeof versionInput !== 'object') {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: VersionInput object is required');
      }
      const document = await libraryAppService.addVersion(data.id.trim(), versionInput, admin);
      return { document };
    }

    throw new HttpsError('invalid-argument', 'INVALID_ACTION: Unsupported library action requested');
  } catch (err: any) {
    throw mapLibraryError(err);
  }
}

export const manageLibraryDocuments = onCall({ cors: true }, async (request) => {
  return executeManageLibraryRequest(request);
});
