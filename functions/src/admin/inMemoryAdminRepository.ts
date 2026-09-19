import type { AdminRepository } from './adminRepository';
import type { AdminUser } from '../types/admin';

export class InMemoryAdminRepository implements AdminRepository {
  private admins: Map<string, AdminUser> = new Map();

  public async getAdminByUid(uid: string): Promise<AdminUser | null> {
    if (!uid || uid.trim() === '') {
      return null;
    }
    const admin = this.admins.get(uid.trim());
    return admin ? { ...admin } : null;
  }

  public async saveAdmin(admin: AdminUser): Promise<AdminUser> {
    const targetUid = admin.firebaseUid || admin.id;
    if (!targetUid || targetUid.trim() === '') {
      throw new Error('Cannot save AdminUser in memory: missing UID');
    }

    const record: AdminUser = {
      ...admin,
      id: targetUid,
      firebaseUid: targetUid,
    };

    this.admins.set(targetUid, record);
    return { ...record };
  }

  public clear(): void {
    this.admins.clear();
  }
}
