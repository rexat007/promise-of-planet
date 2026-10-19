import { getFirestore } from 'firebase-admin/firestore';
import type { NewsRepository, NewsItemBackend } from './newsRepository';

/**
 * Deterministically sanitizes an object for Firestore by omitting any keys whose value is undefined.
 * Preserves meaningful null, false, 0, '', and valid non-undefined values.
 * Recursively cleans nested objects and objects within arrays.
 */
export function sanitizeForFirestore<T>(data: T): T {
  if (data === null || data === undefined) {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map(item => sanitizeForFirestore(item)) as unknown as T;
  }
  if (typeof data === 'object' && !(data instanceof Date)) {
    const cleaned: Record<string, any> = {};
    for (const [key, val] of Object.entries(data)) {
      if (val !== undefined) {
        cleaned[key] = sanitizeForFirestore(val);
      }
    }
    return cleaned as T;
  }
  return data;
}

export class FirestoreNewsRepository implements NewsRepository {
  public static readonly COLLECTION = 'news' as const;

  private get db() {
    return getFirestore();
  }

  async getById(id: string): Promise<NewsItemBackend | null> {
    const docSnap = await this.db.collection(FirestoreNewsRepository.COLLECTION).doc(id).get();
    if (!docSnap.exists) return null;
    const data = docSnap.data();
    if (!data) return null;
    return data as NewsItemBackend;
  }

  async save(item: NewsItemBackend): Promise<void> {
    const docRef = this.db.collection(FirestoreNewsRepository.COLLECTION).doc(item.id);
    const cleanItem = sanitizeForFirestore({ ...item });
    await docRef.set(cleanItem, { merge: true });
  }

  async listAll(): Promise<NewsItemBackend[]> {
    const snapshot = await this.db.collection(FirestoreNewsRepository.COLLECTION).get();
    return snapshot.docs.map(doc => doc.data() as NewsItemBackend);
  }

  async listPublished(language?: 'ar' | 'en'): Promise<NewsItemBackend[]> {
    const snapshot = await this.db
      .collection(FirestoreNewsRepository.COLLECTION)
      .where('workflowState', '==', 'Published')
      .get();

    return snapshot.docs
      .map(doc => doc.data() as NewsItemBackend)
      .filter(item => {
        if (item.workflowState !== 'Published') return false;
        // Arabic is primary canonical: if English is selected, allow Arabic fallback rather than excluding article
        if (language === 'en') {
          return Boolean(
            (item.titleEn && item.titleEn.trim()) ||
            (item.bodyEn && item.bodyEn.trim()) ||
            (item.titleAr && item.titleAr.trim())
          );
        }
        return Boolean(item.titleAr && item.titleAr.trim());
      });
  }

  async delete(id: string): Promise<void> {
    await this.db.collection(FirestoreNewsRepository.COLLECTION).doc(id).delete();
  }
}
