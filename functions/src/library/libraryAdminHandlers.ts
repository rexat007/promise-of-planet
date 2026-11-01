import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { LibraryApplicationService } from './libraryApplicationService';
import { FirestoreLibraryRepository } from './firestoreLibraryRepository';
import { FirestoreAdminRepository } from '../admin/firestoreAdminRepository';
import { AdminAuthorizationService } from '../admin/adminAuthorizationService';
import { AdminPermission } from '../types/admin';
import { PublicLibraryRepository } from './publicLibraryRepository';
import type { PublicLibraryDocument } from '../shared/libraryContract';

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
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.View)) throw new HttpsError('permission-denied', 'Missing permission');
        return { documents: await service.listAll() };
      case 'getById':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.View)) throw new HttpsError('permission-denied', 'Missing permission');
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
      case 'listSources':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.View)) throw new HttpsError('permission-denied', 'Missing permission');
        return { sources: await service.listSources() };
      case 'listOrganizations':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.View)) throw new HttpsError('permission-denied', 'Missing permission');
        return { organizations: await service.listOrganizations() };
      case 'registerSource':
      case 'createSource':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.Create) &&
            !AdminAuthorizationService.hasPermission(adminUser, AdminPermission.ManageRights)) {
          throw new HttpsError('permission-denied', 'Missing permission to register source');
        }
        return { source: await service.registerSource(data.input, adminUser) };
      case 'registerOrganization':
      case 'createOrganization':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.Create) &&
            !AdminAuthorizationService.hasPermission(adminUser, AdminPermission.ManageRights)) {
          throw new HttpsError('permission-denied', 'Missing permission to register organization');
        }
        return { organization: await service.registerOrganization(data.input, adminUser) };
      case 'verifySource':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.ManageRights)) {
          throw new HttpsError('permission-denied', 'Only rights reviewers or owners may verify sources');
        }
        return { source: await service.verifySource(data.sourceId, data.status, adminUser) };
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
    if (error.message.startsWith('DUPLICATE_DOCUMENT') || error.message.startsWith('DUPLICATE_ORGANIZATION') || error.message.startsWith('DUPLICATE_SOURCE')) {
      throw new HttpsError('already-exists', error.message);
    }
    throw new HttpsError('internal', error.message);
  }
});

export const getPublicLibrary = onCall({ cors: true }, async (_request): Promise<{ documents: PublicLibraryDocument[] }> => {
  try {
    const pubRepo = new PublicLibraryRepository();
    const documents = await pubRepo.listPublicDocuments();
    return { documents };
  } catch (error: any) {
    throw new HttpsError('internal', error.message || 'Failed to retrieve public library documents');
  }
});


