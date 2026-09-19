import { getFirestore } from 'firebase-admin/firestore';
import type { AdminRepository } from './adminRepository';
import type { AdminUser, AdminRole } from '../types/admin';

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

      return {
        id: snapshot.id,
        name: data.name || '',
        email: data.email || '',
        role: (data.role as AdminRole) || 'Viewer',
        isActive: Boolean(data.isActive),
        firebaseUid: snapshot.id,
      };
    } catch (e: any) {
      console.error(`Error resolving AdminUser by UID (${uid}):`, e?.message || e);
      return null;
    }
  }

  public async saveAdmin(admin: AdminUser): Promise<AdminUser> {
    const targetUid = admin.firebaseUid || admin.id;
    if (!targetUid || targetUid.trim() === '') {
      throw new Error('Cannot save AdminUser: UID is missing');
    }

    const docRef = this.db.collection('admins').doc(targetUid.trim());
    const payload = {
      name: admin.name,
      email: admin.email,
      role: admin.role,
      isActive: admin.isActive,
      updatedAt: new Date().toISOString(),
    };

    await docRef.set(payload, { merge: true });

    return {
      ...admin,
      id: targetUid,
      firebaseUid: targetUid,
    };
  }
}
