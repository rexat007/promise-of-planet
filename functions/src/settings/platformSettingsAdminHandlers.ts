import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FirestoreAdminRepository } from '../admin/firestoreAdminRepository';
import { AdminAuthorizationService } from '../admin/adminAuthorizationService';
import { AdminPermission } from '../types/admin';
import { FirestorePlatformSettingsRepository } from './platformSettingsRepository';
import { PlatformSettingsService } from './platformSettingsService';

export const managePlatformSettings = onCall(async (request) => {
  const { data, auth } = request;

  if (!auth) {
    throw new HttpsError('unauthenticated', 'User not authenticated');
  }

  const adminRepo = new FirestoreAdminRepository();
  const adminUser = await adminRepo.getAdminByUid(auth.uid);

  if (!adminUser || !adminUser.isActive) {
    throw new HttpsError('permission-denied', 'Admin user not found or inactive');
  }

  const service = new PlatformSettingsService(new FirestorePlatformSettingsRepository());

  try {
    switch (data?.action) {
      case 'get': {
        // Authenticated admin can inspect canonical settings
        const settings = await service.getSettings();
        return { settings };
      }

      case 'initializeFromDefaults': {
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.ManageSettings)) {
          throw new HttpsError('permission-denied', 'Missing required permission: manageSettings');
        }
        const result = await service.initializeFromDefaults(adminUser);
        return result;
      }

      case 'update': {
        if (!AdminAuthorizationService.hasPermission(adminUser, AdminPermission.ManageSettings)) {
          throw new HttpsError('permission-denied', 'Missing required permission: manageSettings');
        }
        if (!data.input || typeof data.input !== 'object') {
          throw new HttpsError('invalid-argument', 'Missing or invalid input payload for settings update');
        }
        const result = await service.updateSettings(data.input, adminUser);
        return result;
      }

      default:
        throw new HttpsError('invalid-argument', `Unknown or unsupported action: ${data?.action}`);
    }
  } catch (error: any) {
    if (error instanceof HttpsError) {
      throw error;
    }
    const msg = error?.message || String(error);
    if (msg.startsWith('VALIDATION_ERROR') || msg.startsWith('INVALID_ARGUMENT')) {
      throw new HttpsError('invalid-argument', msg);
    }
    if (msg.startsWith('PERMISSION_DENIED') || msg.startsWith('ACCESS_DENIED')) {
      throw new HttpsError('permission-denied', msg);
    }
    if (msg.startsWith('NOT_INITIALIZED')) {
      throw new HttpsError('failed-precondition', msg);
    }
    throw new HttpsError('internal', msg);
  }
});
