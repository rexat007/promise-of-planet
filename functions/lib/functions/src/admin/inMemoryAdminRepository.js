"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryAdminRepository = void 0;
const admin_1 = require("../types/admin");
class InMemoryAdminRepository {
    admins = new Map();
    async getAdminByUid(uid) {
        if (!uid || uid.trim() === '') {
            return null;
        }
        const admin = this.admins.get(uid.trim());
        if (!admin) {
            return null;
        }
        if (!(0, admin_1.isValidAdminRole)(admin.role)) {
            return null;
        }
        return { ...admin };
    }
    async saveAdmin(admin) {
        const targetUid = admin.id;
        if (!targetUid || targetUid.trim() === '') {
            throw new Error('Cannot save AdminUser in memory: missing admin.id (UID)');
        }
        if (!(0, admin_1.isValidAdminRole)(admin.role)) {
            throw new Error(`Cannot save AdminUser in memory: invalid AdminRole '${admin.role}'`);
        }
        const record = {
            id: targetUid.trim(),
            name: admin.name,
            email: admin.email,
            role: admin.role,
            isActive: Boolean(admin.isActive),
        };
        this.admins.set(record.id, record);
        return { ...record };
    }
    setRawAdmin(uid, raw) {
        this.admins.set(uid.trim(), raw);
    }
    clear() {
        this.admins.clear();
    }
}
exports.InMemoryAdminRepository = InMemoryAdminRepository;
//# sourceMappingURL=inMemoryAdminRepository.js.map