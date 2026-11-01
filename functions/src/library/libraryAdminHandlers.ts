import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { LibraryApplicationService } from './libraryApplicationService';
import { FirestoreLibraryRepository } from './firestoreLibraryRepository';
import { FirestoreAdminRepository } from '../admin/firestoreAdminRepository';
import { AdminAuthorizationService } from '../admin/adminAuthorizationService';
import { AdminPermission } from '../types/admin';
import { PublicLibraryRepository } from './publicLibraryRepository';
import type { PublicLibraryDocument } from '../shared/libraryContract';

const geminiApiKey = defineSecret('GEMINI_API_KEY');

export const manageLibraryDocuments = onCall({ secrets: [geminiApiKey] }, async (request) => {
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
      case 'listIntake':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.View)) throw new HttpsError('permission-denied', 'Missing permission');
        {
          const intakeRecords = await service.listIntake();
          return { intakeRecords, intake: intakeRecords };
        }
      case 'getIntakeById':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.View)) throw new HttpsError('permission-denied', 'Missing permission');
        return { intakeRecord: await service.getIntakeById(data.id) };
      case 'submitIntake':
      case 'createIntake':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.Create) &&
            !AdminAuthorizationService.hasPermission(adminUser, AdminPermission.Edit)) {
          throw new HttpsError('permission-denied', 'Missing permission to submit intake reference');
        }
        return { intakeRecord: await service.submitIntake(data.input, adminUser) };
      case 'updateIntakeStatus':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.Review) &&
            !AdminAuthorizationService.hasPermission(adminUser, AdminPermission.Approve) &&
            !AdminAuthorizationService.hasPermission(adminUser, AdminPermission.ManageRights)) {
          throw new HttpsError('permission-denied', 'Only reviewers or rights managers may update intake status');
        }
        return { intakeRecord: await service.updateIntakeStatus(data.intakeId || data.id, data.status, data.reviewNotes, adminUser) };
      case 'generateIntakeAISuggestions':
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.Create) &&
            !AdminAuthorizationService.hasPermission(adminUser, AdminPermission.Edit) &&
            !AdminAuthorizationService.hasPermission(adminUser, AdminPermission.Review) &&
            !AdminAuthorizationService.hasPermission(adminUser, AdminPermission.Approve) &&
            !AdminAuthorizationService.hasPermission(adminUser, AdminPermission.ManageRights)) {
          throw new HttpsError('permission-denied', 'Missing editorial or curation permission to generate AI preparation suggestions');
        }
        {
          let secretKey = '';
          try {
            secretKey = geminiApiKey.value() || '';
          } catch {
            secretKey = process.env.GEMINI_API_KEY || '';
          }
          const intakeRecord = await service.generateIntakeAISuggestions(
            {
              intakeId: data.intakeId || data.id || data.input?.intakeId,
              suppliedExcerpt: data.suppliedExcerpt ?? data.input?.suppliedExcerpt,
            },
            adminUser,
            { apiKey: secretKey }
          );
          return { intakeRecord };
        }
      default:
        throw new HttpsError('invalid-argument', 'Invalid action');
    }
  } catch (error: any) {
    if (error instanceof HttpsError) {
      throw error;
    }
    const msg = error?.message || 'Internal server error';
    if (msg.startsWith('VALIDATION_ERROR') || msg.startsWith('INVALID_ARGUMENT') || msg.startsWith('INVALID_TRANSITION')) {
      throw new HttpsError('invalid-argument', msg);
    }
    if (msg.startsWith('PERMISSION_DENIED')) {
      throw new HttpsError('permission-denied', msg);
    }
    if (msg.startsWith('NOT_FOUND')) {
      throw new HttpsError('not-found', msg);
    }
    if (msg.startsWith('DUPLICATE_INTAKE') || msg.startsWith('DUPLICATE_DOCUMENT') || msg.startsWith('DUPLICATE_ORGANIZATION') || msg.startsWith('DUPLICATE_SOURCE')) {
      throw new HttpsError('already-exists', msg);
    }
    if (msg.startsWith('CONFIG_ERROR')) {
      throw new HttpsError('failed-precondition', msg);
    }
    if (msg.startsWith('CONFLICT')) {
      throw new HttpsError('aborted', msg);
    }
    if (msg.startsWith('AI_PROVIDER_ERROR')) {
      throw new HttpsError('unavailable', msg);
    }
    throw new HttpsError('internal', msg);
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


