import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { app } from './firebase';
import { isFirebaseStorageConfigured } from './firebase';

export interface BrandingStorageResult {
  storagePath: string;
  downloadUrl: string;
}

export const validateLogoFile = (file: File): { isValid: boolean; error?: string } => {
  if (file.size > 2 * 1024 * 1024) return { isValid: false, error: 'File size exceeds 2MB limit.' };
  if (file.type !== 'image/png' && file.type !== 'image/webp') return { isValid: false, error: 'Only PNG and WEBP images are supported.' };
  
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (file.type === 'image/png' && ext !== 'png') return { isValid: false, error: 'MIME type and extension (png) mismatch.' };
  if (file.type === 'image/webp' && ext !== 'webp') return { isValid: false, error: 'MIME type and extension (webp) mismatch.' };
  
  return { isValid: true };
};

export const uploadLogo = async (file: File): Promise<BrandingStorageResult> => {
  if (!isFirebaseStorageConfigured) throw new Error('Storage is not configured.');
  
  const storage = getStorage(app);
  const ext = file.name.split('.').pop();
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  const storagePath = `branding/platform-logo/${timestamp}-${random}.${ext}`;
  
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, file, { contentType: file.type });
  const downloadUrl = await getDownloadURL(storageRef);
  
  return { storagePath, downloadUrl };
};

export const deleteManagedLogo = async (storagePath: string): Promise<void> => {
  if (!isFirebaseStorageConfigured) throw new Error('Storage is not configured.');
  if (!storagePath || !storagePath.startsWith('branding/platform-logo/')) throw new Error('Invalid storage path.');
  if (storagePath.includes('..') || storagePath.includes('\\')) throw new Error('Invalid path traversal.');
  
  const storage = getStorage(app);
  const storageRef = ref(storage, storagePath);
  await deleteObject(storageRef);
};
