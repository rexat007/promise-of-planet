import { getFirestore } from 'firebase-admin/firestore';
import type { CommunityRepository, CitizenSubmissionBackend } from './communityRepository';

export class FirestoreCommunityRepository implements CommunityRepository {
  public static readonly COLLECTION = 'citizen_submissions' as const;

  private get db() {
    return getFirestore();
  }

  async getById(id: string): Promise<CitizenSubmissionBackend | null> {
    if (!id || typeof id !== 'string') return null;
    const docSnap = await this.db.collection(FirestoreCommunityRepository.COLLECTION).doc(id).get();
    if (!docSnap.exists) return null;
    const data = docSnap.data();
    if (!data) return null;
    return data as CitizenSubmissionBackend;
  }

  async save(submission: CitizenSubmissionBackend): Promise<void> {
    const docRef = this.db.collection(FirestoreCommunityRepository.COLLECTION).doc(submission.id);
    const cleanPayload: Record<string, any> = {};
    for (const [k, v] of Object.entries(submission)) {
      if (v !== undefined) {
        cleanPayload[k] = v;
      }
    }
    await docRef.set(cleanPayload, { merge: false });
  }

  async listAll(): Promise<CitizenSubmissionBackend[]> {
    const snapshot = await this.db.collection(FirestoreCommunityRepository.COLLECTION).get();
    return snapshot.docs
      .map(doc => doc.data() as CitizenSubmissionBackend)
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  }

  async listByContributorUid(uid: string): Promise<CitizenSubmissionBackend[]> {
    if (!uid || typeof uid !== 'string') return [];
    const snapshot = await this.db
      .collection(FirestoreCommunityRepository.COLLECTION)
      .where('submittedByUid', '==', uid)
      .get();
    return snapshot.docs
      .map(doc => doc.data() as CitizenSubmissionBackend)
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  }
}
