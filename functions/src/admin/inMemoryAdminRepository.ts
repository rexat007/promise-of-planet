import type { AdminRepository } from './adminRepository';
import { isValidAdminRole, type AdminUser } from '../types/admin';

export class InMemoryAdminRepository implements AdminRepository {
  private admins: Map<string, AdminUser> = new Map();

  public async getAdminByUid(uid: string): Promise<AdminUser | null> {
    if (!uid || uid.trim() === '') {
      return null;
    }
    const admin = this.admins.get(uid.trim());
    if (!admin) {
      return null;
    }
    if (!isValidAdminRole(admin.role)) {
      return null;
    }
    return { ...admin };
  }

  public async saveAdmin(admin: AdminUser): Promise<AdminUser> {
    const targetUid = admin.id;
    if (!targetUid || targetUid.trim() === '') {
      throw new Error('Cannot save AdminUser in memory: missing admin.id (UID)');
    }

    if (!isValidAdminRole(admin.role)) {
      throw new Error(`Cannot save AdminUser in memory: invalid AdminRole '${admin.role}'`);
    }

    const record: AdminUser = {
      id: targetUid.trim(),
      name: admin.name,
      email: admin.email,
      role: admin.role,
      isActive: Boolean(admin.isActive),
    };

    this.admins.set(record.id, record);
    return { ...record };
  }

  public setRawAdmin(uid: string, raw: any): void {
    this.admins.set(uid.trim(), raw);
  }

  public clear(): void {
    this.admins.clear();
  }
}
