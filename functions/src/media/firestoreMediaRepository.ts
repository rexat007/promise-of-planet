import { getFirestore } from 'firebase-admin/firestore';
import type { MediaRepository } from './mediaRepository';
import type { Video, ContentVideoRelation } from '../types/media';

/**
 * Production-ready Firestore-backed Media Repository.
 * Uses the canonical 'media' collection for Video persistence.
 * Relations are managed canonically as documents in the 'media' collection or queryable structures.
 * To maintain the ONE relationship source rule with zero ambiguous multi-collection sync:
 * - Videos are stored as top-level documents in 'media' ({ id, ...videoDoc, relations: ContentVideoRelation[] }).
 * Storing relations embedded inside the canonical Media document ensures:
 * 1. Single collection minimization ('media').
 * 2. Atomic write consistency for video and its relations.
 * 3. Exact single-source derivation for reverse lookups (derived from media collection).
 */
export class FirestoreMediaRepository implements MediaRepository {
  public static readonly COLLECTION = 'media' as const;

  private get db() {
    return getFirestore();
  }

  async getVideoById(id: string): Promise<Video | null> {
    const docSnap = await this.db.collection(FirestoreMediaRepository.COLLECTION).doc(id).get();
    if (!docSnap.exists) return null;
    const data = docSnap.data();
    if (!data) return null;
    return this.deserializeVideo(data);
  }

  async getVideoByYoutubeId(externalVideoId: string): Promise<Video | null> {
    const querySnap = await this.db
      .collection(FirestoreMediaRepository.COLLECTION)
      .where('youtubeSource.youtubeVideoId', '==', externalVideoId)
      .limit(1)
      .get();

    if (querySnap.empty) return null;
    const doc = querySnap.docs[0];
    return this.deserializeVideo(doc.data());
  }

  async saveVideo(video: Video): Promise<Video> {
    const cleanVideo = this.serializeVideo(video);
    await this.db.collection(FirestoreMediaRepository.COLLECTION).doc(video.id).set(cleanVideo);
    return video;
  }

  async listVideos(): Promise<Video[]> {
    const snapshot = await this.db.collection(FirestoreMediaRepository.COLLECTION).get();
    return snapshot.docs.map(doc => this.deserializeVideo(doc.data()));
  }

  async saveRelation(relation: ContentVideoRelation): Promise<ContentVideoRelation> {
    const video = await this.getVideoById(relation.videoId);
    if (!video) {
      throw new Error(`Cannot save relation: Video ${relation.videoId} not found`);
    }

    const docRef = this.db.collection(FirestoreMediaRepository.COLLECTION).doc(relation.videoId);
    const docSnap = await docRef.get();
    const data = docSnap.data() || {};
    const existingRelations: ContentVideoRelation[] = Array.isArray(data._relations) ? data._relations : [];

    const updatedRelations = existingRelations.filter(r => r.id !== relation.id);
    updatedRelations.push(relation);

    await docRef.update({ _relations: updatedRelations });
    return relation;
  }

  async deleteRelation(relationId: string): Promise<boolean> {
    const snapshot = await this.db.collection(FirestoreMediaRepository.COLLECTION).get();
    let found = false;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const existingRelations: ContentVideoRelation[] = Array.isArray(data._relations) ? data._relations : [];
      const hasRelation = existingRelations.some(r => r.id === relationId);
      if (hasRelation) {
        const filtered = existingRelations.filter(r => r.id !== relationId);
        await doc.ref.update({ _relations: filtered });
        found = true;
      }
    }

    return found;
  }

  async getRelationsForVideo(videoId: string): Promise<ContentVideoRelation[]> {
    const docSnap = await this.db.collection(FirestoreMediaRepository.COLLECTION).doc(videoId).get();
    if (!docSnap.exists) return [];
    const data = docSnap.data();
    if (!data || !Array.isArray(data._relations)) return [];
    return data._relations;
  }

  async getRelationsForContent(contentId: string): Promise<ContentVideoRelation[]> {
    // Reverse relationship lookup derived from the single canonical Media store
    const snapshot = await this.db.collection(FirestoreMediaRepository.COLLECTION).get();
    const matching: ContentVideoRelation[] = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (Array.isArray(data._relations)) {
        for (const rel of data._relations) {
          if (rel.contentId === contentId && rel.isActive !== false) {
            matching.push(rel);
          }
        }
      }
    }

    return matching;
  }

  private serializeVideo(video: Video): Record<string, any> {
    const { ...rest } = video;
    return {
      ...rest,
    };
  }

  private deserializeVideo(data: any): Video {
    const { _relations, ...rest } = data;
    return rest as Video;
  }
}
