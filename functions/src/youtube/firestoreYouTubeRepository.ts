import { getFirestore } from 'firebase-admin/firestore';
import type { YouTubeRepository } from './youtubeRepository';
import type { YouTubeIntegrationConfig, YouTubeImportCandidate, CandidateLifecycleStatus } from '../types/youtube';

export class FirestoreYouTubeRepository implements YouTubeRepository {
  public static readonly COLLECTIONS = ['youtubeIntegration', 'youtubeImportCandidates'] as const;

  private get db() {
    return getFirestore();
  }

  async getConfiguration(id: string = 'youtube-primary'): Promise<YouTubeIntegrationConfig | null> {
    const docSnap = await this.db.collection('youtubeIntegration').doc(id).get();
    if (!docSnap.exists) return null;
    return docSnap.data() as YouTubeIntegrationConfig;
  }

  async saveConfiguration(config: YouTubeIntegrationConfig): Promise<YouTubeIntegrationConfig> {
    await this.db.collection('youtubeIntegration').doc(config.id).set(config);
    return config;
  }

  async getCandidate(id: string): Promise<YouTubeImportCandidate | null> {
    const docSnap = await this.db.collection('youtubeImportCandidates').doc(id).get();
    if (!docSnap.exists) return null;
    return docSnap.data() as YouTubeImportCandidate;
  }

  async saveCandidate(candidate: YouTubeImportCandidate): Promise<YouTubeImportCandidate> {
    await this.db.collection('youtubeImportCandidates').doc(candidate.id).set(candidate);
    return candidate;
  }

  async listCandidates(filter?: { status?: CandidateLifecycleStatus }): Promise<YouTubeImportCandidate[]> {
    let query: FirebaseFirestore.Query = this.db.collection('youtubeImportCandidates');
    if (filter?.status) {
      query = query.where('status', '==', filter.status);
    }
    const snapshot = await query.get();
    return snapshot.docs.map(doc => doc.data() as YouTubeImportCandidate);
  }
}

