import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { LibraryApplicationService } from './libraryApplicationService';
import { FirestoreLibraryRepository } from './firestoreLibraryRepository';
import { FirestoreAdminRepository } from '../admin/firestoreAdminRepository';
import { AdminAuthorizationService } from '../admin/adminAuthorizationService';
import { AdminPermission } from '../../../src/types/admin';

export const manageLibraryDocuments = onCall(async (request) => {
  const { data, auth } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'User not authenticated');

  const adminRepo = new FirestoreAdminRepository();
  const adminUser = await adminRepo.getAdminByUid(auth.uid);

  if (!adminUser || !adminUser.isActive) {
    throw new HttpsError('permission-denied', 'Admin user not found or inactive');
  }

  const service = new LibraryApplicationService(new FirestoreLibraryRepository());

  try {
    switch (data.action) {
      case 'listAll':
        return { documents: await service.listAll() };
      case 'getById':
        return { document: await service.getById(data.id) };
      case 'create':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.Create)) throw new HttpsError('permission-denied', 'Missing permission');
        return { document: await service.create(data.input, adminUser) };
      case 'updateMetadata':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.Edit)) throw new HttpsError('permission-denied', 'Missing permission');
        return { document: await service.updateMetadata(data.id, data.updates, adminUser) };
      case 'updateRights':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.ManageRights)) throw new HttpsError('permission-denied', 'Missing permission');
        return { document: await service.updateRights(data.id, data.rightsStatus, data.notesAr, data.notesEn, adminUser) };
      case 'transitionWorkflow':
        return { document: await service.transitionWorkflow(data.id, data.targetState, data.comment, adminUser) };
      case 'addVersion':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.Edit)) throw new HttpsError('permission-denied', 'Missing permission');
        return { document: await service.addVersion(data.id, data.versionInput, adminUser) };
      default:
        throw new HttpsError('invalid-argument', 'Invalid action');
    }
  } catch (error: any) {
    if (error.message.startsWith('VALIDATION_ERROR') || error.message.startsWith('INVALID_ARGUMENT') || error.message.startsWith('INVALID_TRANSITION')) {
      throw new HttpsError('invalid-argument', error.message);
    }
    if (error.message.startsWith('PERMISSION_DENIED')) {
      throw new HttpsError('permission-denied', error.message);
    }
    if (error.message.startsWith('NOT_FOUND')) {
      throw new HttpsError('not-found', error.message);
    }
    if (error.message.startsWith('DUPLICATE_DOCUMENT')) {
      throw new HttpsError('already-exists', error.message);
    }
    throw new HttpsError('internal', error.message);
  }
});
