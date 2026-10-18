import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { CommunityApplicationService } from './communityApplicationService';
import type { AdminRepository } from '../admin/adminRepository';
import { FirestoreAdminRepository } from '../admin/firestoreAdminRepository';
import { AdminAuthorizationService } from '../admin/adminAuthorizationService';
import { AdminPermission } from '../types/admin';
import type { AdminUser } from '../types/admin';

export interface CommunityRequestContext {
  auth?: {
    uid: string;
  };
  data?: any;
}

export interface AccountLookupVerifier {
  hasCanonicalAccount(uid: string): Promise<boolean>;
}

export class FirestoreAccountLookupVerifier implements AccountLookupVerifier {
  async hasCanonicalAccount(uid: string): Promise<boolean> {
    if (!uid || !uid.trim()) return false;
    const snap = await getFirestore().collection('accounts').doc(uid.trim()).get();
    if (!snap.exists) return false;
    const data = snap.data();
    return Boolean(data && data.id === uid.trim() && typeof data.email === 'string');
  }
}

async function authenticateAndAuthorizeAdmin(
  requestContext: CommunityRequestContext,
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
    throw new HttpsError(
      'permission-denied',
      `PERMISSION_DENIED: AdminUser lacks required ${requiredPermission} permission`
    );
  }

  return admin;
}

export async function executeSubmitCitizenReport(
  requestContext: CommunityRequestContext,
  accountVerifier: AccountLookupVerifier = new FirestoreAccountLookupVerifier(),
  communityService: CommunityApplicationService = new CommunityApplicationService()
): Promise<{ submission: any }> {
  if (!requestContext.auth || !requestContext.auth.uid || !requestContext.auth.uid.trim()) {
    throw new HttpsError('unauthenticated', 'UNAUTHENTICATED: You must be signed in to submit a field report.');
  }

  const uid = requestContext.auth.uid.trim();

  let hasAccount = false;
  try {
    hasAccount = await accountVerifier.hasCanonicalAccount(uid);
  } catch (_err) {
    throw new HttpsError('internal', 'ACCOUNT_LOOKUP_FAILED: Unable to verify canonical platform account.');
  }

  if (!hasAccount) {
    throw new HttpsError(
      'failed-precondition',
      'ACCOUNT_PROVISIONING_REQUIRED: A provisioned canonical platform account is required before submitting reports.'
    );
  }

  try {
    const payload = requestContext.data?.submission || requestContext.data || {};
    const created = await communityService.submitReport(payload, uid);
    return { submission: created };
  } catch (err: any) {
    if (err instanceof HttpsError) throw err;
    const msg = err?.message || 'Submission failed';
    if (msg.startsWith('VALIDATION_ERROR') || msg.startsWith('ATTACHMENT_INVALID')) {
      throw new HttpsError('invalid-argument', msg);
    }
    throw new HttpsError('internal', msg);
  }
}

export async function executeManageCitizenSubmissions(
  requestContext: CommunityRequestContext,
  adminRepo: AdminRepository = new FirestoreAdminRepository(),
  communityService: CommunityApplicationService = new CommunityApplicationService()
): Promise<any> {
  const data = requestContext.data || {};
  const action = data.action;

  if (!action || typeof action !== 'string') {
    throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: Action parameter is required');
  }

  try {
    if (action === 'listAll') {
      await authenticateAndAuthorizeAdmin(requestContext, AdminPermission.View, adminRepo);
      const submissions = await communityService.listAllForAdmin();
      return { submissions };
    }

    if (action === 'getById') {
      await authenticateAndAuthorizeAdmin(requestContext, AdminPermission.View, adminRepo);
      if (!data.id || typeof data.id !== 'string') {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: Submission id is required');
      }
      const submission = await communityService.getByIdForAdmin(data.id);
      return { submission };
    }

    if (action === 'moderate') {
      const admin = await authenticateAndAuthorizeAdmin(requestContext, AdminPermission.Review, adminRepo);
      if (!data.id || typeof data.id !== 'string') {
        throw new HttpsError('invalid-argument', 'INVALID_ARGUMENT: Submission id is required');
      }
      const updated = await communityService.moderateSubmission(
        data.id,
        {
          status: data.status,
          moderatorNotes: data.moderatorNotes,
          editorialReferenceId: data.editorialReferenceId,
        },
        {
          uid: admin.id,
          name: admin.name,
          role: admin.role,
        }
      );
      return { submission: updated };
    }

    throw new HttpsError('invalid-argument', `INVALID_ARGUMENT: Unrecognized action '${action}'`);
  } catch (err: any) {
    if (err instanceof HttpsError) throw err;
    const msg = err?.message || 'Moderation operation failed';
    if (msg.startsWith('VALIDATION_ERROR')) {
      throw new HttpsError('invalid-argument', msg);
    }
    if (msg.startsWith('NOT_FOUND')) {
      throw new HttpsError('not-found', msg);
    }
    throw new HttpsError('internal', msg);
  }
}

export const submitCitizenReport = onCall({ cors: true }, async (request) => {
  return executeSubmitCitizenReport({
    auth: request.auth ? { uid: request.auth.uid } : undefined,
    data: request.data,
  });
});

export const manageCitizenSubmissions = onCall({ cors: true }, async (request) => {
  return executeManageCitizenSubmissions({
    auth: request.auth ? { uid: request.auth.uid } : undefined,
    data: request.data,
  });
});
