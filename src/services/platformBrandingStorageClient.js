"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteManagedLogo = exports.uploadLogo = exports.validateLogoFile = void 0;
const storage_1 = require("firebase/storage");
const firebase_1 = require("./firebase");
const firebase_2 = require("./firebase");
const validateLogoFile = (file) => {
    if (file.size > 2 * 1024 * 1024)
        return { isValid: false, error: 'File size exceeds 2MB limit.' };
    if (file.type !== 'image/png' && file.type !== 'image/webp')
        return { isValid: false, error: 'Only PNG and WEBP images are supported.' };
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (file.type === 'image/png' && ext !== 'png')
        return { isValid: false, error: 'MIME type and extension (png) mismatch.' };
    if (file.type === 'image/webp' && ext !== 'webp')
        return { isValid: false, error: 'MIME type and extension (webp) mismatch.' };
    return { isValid: true };
};
exports.validateLogoFile = validateLogoFile;
const uploadLogo = async (file) => {
    if (!firebase_2.isFirebaseStorageConfigured)
        throw new Error('Storage is not configured.');
    if (!firebase_1.auth.currentUser)
        throw new Error('Unauthorized');
    const storage = (0, storage_1.getStorage)(firebase_1.app);
    const ext = file.name.split('.').pop();
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    const storagePath = `branding/platform-logo/${timestamp}-${random}.${ext}`;
    const storageRef = (0, storage_1.ref)(storage, storagePath);
    await (0, storage_1.uploadBytes)(storageRef, file, { contentType: file.type });
    const downloadUrl = await (0, storage_1.getDownloadURL)(storageRef);
    return { storagePath, downloadUrl };
};
exports.uploadLogo = uploadLogo;
const deleteManagedLogo = async (storagePath) => {
    if (!firebase_2.isFirebaseStorageConfigured)
        throw new Error('Storage is not configured.');
    if (!firebase_1.auth.currentUser)
        throw new Error('Unauthorized');
    if (!storagePath ||
        !storagePath.startsWith('branding/platform-logo/') ||
        storagePath.includes('..') ||
        storagePath.includes('\\') ||
        storagePath.includes('?') ||
        storagePath.includes('#') ||
        !(storagePath.endsWith('.png') || storagePath.endsWith('.webp'))) {
        throw new Error('Invalid storage path.');
    }
    const storage = (0, storage_1.getStorage)(firebase_1.app);
    const storageRef = (0, storage_1.ref)(storage, storagePath);
    await (0, storage_1.deleteObject)(storageRef);
};
exports.deleteManagedLogo = deleteManagedLogo;
//# sourceMappingURL=platformBrandingStorageClient.js.map