import { getFirestore } from 'firebase-admin/firestore';
import type { NewsRepository, NewsItemBackend } from './newsRepository';

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
    const cleanItem = { ...item };
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
        if (language === 'en') {
          return Boolean(item.titleEn || item.bodyEn);
        }
        return Boolean(item.titleAr);
      });
  }

  async delete(id: string): Promise<void> {
    await this.db.collection(FirestoreNewsRepository.COLLECTION).doc(id).delete();
  }
}
