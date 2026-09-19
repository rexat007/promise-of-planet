"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FirestoreAdminRepository = void 0;
const firestore_1 = require("firebase-admin/firestore");
const admin_1 = require("../types/admin");
class FirestoreAdminRepository {
    db = (0, firestore_1.getFirestore)();
    async getAdminByUid(uid) {
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
            if (!(0, admin_1.isValidAdminRole)(data.role)) {
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
        }
        catch (e) {
            console.error(`Error resolving AdminUser by UID (${uid}):`, e?.message || e);
            return null;
        }
    }
    async saveAdmin(admin) {
        if (!admin.id || admin.id.trim() === '') {
            throw new Error('Cannot save AdminUser: admin.id (UID) is missing');
        }
        if (!(0, admin_1.isValidAdminRole)(admin.role)) {
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
exports.FirestoreAdminRepository = FirestoreAdminRepository;
//# sourceMappingURL=firestoreAdminRepository.js.map