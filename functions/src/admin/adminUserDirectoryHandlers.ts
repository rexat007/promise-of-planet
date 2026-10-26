import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {
  AdminDirectoryRepositoryError,
  DEFAULT_MAX_ADMIN_DIRECTORY_RESULTS,
  MAX_ADMIN_DIRECTORY_LIMIT,
  type AdminRepository,
  type SanitizedAdminDirectoryEntry,
} from './adminRepository';
import {
  compareAdminDirectoryEntries,
  FirestoreAdminRepository,
} from './firestoreAdminRepository';
import { AdminAuthorizationService } from './adminAuthorizationService';
import { AdminPermission, AdminRole, isValidAdminRole } from '../types/admin';

export interface AdminDirectoryRequestContext {
  auth?: {
    uid: string;
    token?: Record<string, unknown>;
  };
  data?: unknown;
}

export interface ListAdminUsersResponse {
  readonly admins: ReadonlyArray<SanitizedAdminDirectoryEntry>;
}

export interface AdminUserDirectoryDependencies {
  readonly adminRepo?: AdminRepository;
  readonly maxResults?: number;
}

function sanitizeAndValidateDirectoryEntry(
  rawEntry: unknown,
  seenIds: Set<string>
): SanitizedAdminDirectoryEntry {
  if (!rawEntry || typeof rawEntry !== 'object') {
    throw new AdminDirectoryRepositoryError(
      'INVALID_ADMIN_RECORD',
      'Directory entry must be a non-null object.'
    );
  }

  const record = rawEntry as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!id) {
    throw new AdminDirectoryRepositoryError(
      'INVALID_ADMIN_RECORD',
      'Directory entry is missing a canonical Firebase UID (id).'
    );
  }

  if (seenIds.has(id)) {
    throw new AdminDirectoryRepositoryError(
      'INVALID_ADMIN_RECORD',
      `Duplicate administrative UID (${id}) encountered in directory listing.`
    );
  }

  if (!isValidAdminRole(record.role)) {
    throw new AdminDirectoryRepositoryError(
      'INVALID_ADMIN_RECORD',
      `Invalid or non-canonical AdminRole (${String(record.role)}) encountered for UID (${id}).`
    );
  }

  if (typeof record.isActive !== 'boolean') {
    throw new AdminDirectoryRepositoryError(
      'INVALID_ADMIN_RECORD',
      `Invalid or non-boolean isActive flag encountered for UID (${id}).`
    );
  }

  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const email = typeof record.email === 'string' ? record.email.trim() : '';
  if (!name || !email) {
    throw new AdminDirectoryRepositoryError(
      'INVALID_ADMIN_RECORD',
      `Directory entry for UID (${id}) is missing a valid name or email.`
    );
  }

  seenIds.add(id);

  return {
    id,
    name,
    email,
    role: record.role,
    isActive: record.isActive,
  };
}

export async function executeListAdminUsers(
  request: AdminDirectoryRequestContext,
  deps?: AdminUserDirectoryDependencies
): Promise<ListAdminUsersResponse> {
  const rawCallerUid = request?.auth?.uid;
  const callerUid = typeof rawCallerUid === 'string' ? rawCallerUid.trim() : '';

  if (!callerUid) {
    throw new HttpsError(
      'unauthenticated',
      'Authentication is required to access the administrative user directory.'
    );
  }

  const adminRepo = deps?.adminRepo ?? new FirestoreAdminRepository();

  const caller = await adminRepo.getAdminByUid(callerUid);
  if (!caller) {
    throw new HttpsError(
      'permission-denied',
      'Caller does not hold a canonical administrative identity.'
    );
  }

  const resolvedCallerId = typeof caller.id === 'string' ? caller.id.trim() : '';
  if (!resolvedCallerId || resolvedCallerId !== callerUid) {
    throw new HttpsError(
      'permission-denied',
      'Caller administrative identity UID mismatch.'
    );
  }

  if (!isValidAdminRole(caller.role)) {
    throw new HttpsError(
      'permission-denied',
      'Caller administrative role is invalid or non-canonical.'
    );
  }

  if (typeof caller.isActive !== 'boolean' || caller.isActive !== true) {
    throw new HttpsError(
      'permission-denied',
      'Inactive administrative accounts cannot access the administrative user directory.'
    );
  }

  if (
    caller.role !== AdminRole.Owner ||
    !AdminAuthorizationService.hasPermission(caller, AdminPermission.ManageUsers)
  ) {
    throw new HttpsError(
      'permission-denied',
      'Only an active Owner with ManageUsers permission may list administrative users.'
    );
  }

  if (typeof adminRepo.listAdmins !== 'function') {
    throw new HttpsError(
      'internal',
      'Administrative directory listing is not supported by the configured repository.'
    );
  }

  const maxResults = deps?.maxResults ?? DEFAULT_MAX_ADMIN_DIRECTORY_RESULTS;
  if (
    typeof maxResults !== 'number' ||
    !Number.isInteger(maxResults) ||
    maxResults < 1 ||
    maxResults > MAX_ADMIN_DIRECTORY_LIMIT
  ) {
    throw new HttpsError(
      'invalid-argument',
      `Invalid directory limit (${String(maxResults)}).`
    );
  }

  try {
    const rawAdmins = await adminRepo.listAdmins({ maxResults });

    if (!Array.isArray(rawAdmins)) {
      throw new AdminDirectoryRepositoryError(
        'DIRECTORY_READ_FAILED',
        'Repository returned a non-array directory result.'
      );
    }

    if (rawAdmins.length > maxResults) {
      throw new AdminDirectoryRepositoryError(
        'DIRECTORY_SIZE_LIMIT_EXCEEDED',
        `Admin directory exceeds bounded limit of ${maxResults} records; refusing to return truncated results.`
      );
    }

    const seenIds = new Set<string>();
    const sanitizedAdmins = rawAdmins.map((entry) =>
      sanitizeAndValidateDirectoryEntry(entry, seenIds)
    );

    sanitizedAdmins.sort(compareAdminDirectoryEntries);

    return {
      admins: sanitizedAdmins,
    };
  } catch (error: unknown) {
    if (error instanceof HttpsError) {
      throw error;
    }

    if (error instanceof AdminDirectoryRepositoryError) {
      if (error.code === 'DIRECTORY_SIZE_LIMIT_EXCEEDED') {
        throw new HttpsError('resource-exhausted', error.message);
      }
      if (error.code === 'INVALID_ADMIN_RECORD') {
        throw new HttpsError('failed-precondition', error.message);
      }
      if (error.code === 'INVALID_LIST_OPTIONS') {
        throw new HttpsError('invalid-argument', error.message);
      }
      throw new HttpsError('internal', error.message);
    }

    throw new HttpsError(
      'internal',
      'Failed to retrieve administrative user directory.'
    );
  }
}

export const listAdminUsers = onCall({ cors: true }, async (request) => {
  return executeListAdminUsers(request);
});
