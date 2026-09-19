import { getFirestore } from 'firebase-admin/firestore';
import type { AdminRepository } from './adminRepository';
import { isValidAdminRole, type AdminUser } from '../types/admin';

export class FirestoreAdminRepository implements AdminRepository {
  private db = getFirestore();

  public async getAdminByUid(uid: string): Promise<AdminUser | null> {
    if (!uid || uid.trim() === '') {
      return null;
    }

    try {
      const docRef = this.db.collection('admins').doc(uid.trim());
      const snapshot = await docRef.get();

      if (!snapshot.exists) {
        return null;
      }

      const data = snapshot.data();
      if (!data) {
        return null;
      }

      if (!isValidAdminRole(data.role)) {
        console.error(`Invalid or non-canonical AdminRole (${data.role}) encountered for UID (${uid}). Failing closed.`);
        return null;
      }

      return {
        id: snapshot.id,
        name: data.name || '',
        email: data.email || '',
        role: data.role,
        isActive: Boolean(data.isActive),
      };
    } catch (e: any) {
      console.error(`Error resolving AdminUser by UID (${uid}):`, e?.message || e);
      return null;
    }
  }

  public async saveAdmin(admin: AdminUser): Promise<AdminUser> {
    if (!admin.id || admin.id.trim() === '') {
      throw new Error('Cannot save AdminUser: admin.id (UID) is missing');
    }

    if (!isValidAdminRole(admin.role)) {
      throw new Error(`Cannot save AdminUser: invalid AdminRole '${admin.role}'`);
    }

    const targetUid = admin.id.trim();
    const docRef = this.db.collection('admins').doc(targetUid);
    const payload = {
      name: admin.name,
      email: admin.email,
      role: admin.role,
      isActive: Boolean(admin.isActive),
      updatedAt: new Date().toISOString(),
    };

    await docRef.set(payload, { merge: true });

    return {
      id: targetUid,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      isActive: Boolean(admin.isActive),
    };
  }
}
