import { getFirestore } from 'firebase-admin/firestore';
import type { Video, CanonicalPlaylist } from '../types/media';

export class PublicMediaRepository {
  private get db() {
    return getFirestore();
  }

  /**
   * Retrieves canonically eligible public videos.
   * Strictly enforces:
   * - status === 'Published'
   * - approvalStatus === 'Approved'
   * - rightsStatus === 'Cleared'
   * - visibilityDecision in ['Featured', 'NewsEligible', 'MediaHubOnly'] (non-Hidden)
   * - availabilityStatus === 'Available' (or undefined if not yet flagged unavailable)
   */
  async listPublicVideos(): Promise<Video[]> {
    const snapshot = await this.db
      .collection('media')
      .where('status', '==', 'Published')
      .where('rightsStatus', '==', 'Cleared')
      .get();
      
    return snapshot.docs
      .map(doc => doc.data() as Video)
      .filter(video => 
        video.approvalStatus === 'Approved' &&
        video.visibilityDecision !== 'Hidden' &&
        (video.youtubeSource?.availabilityStatus === 'Available' || !video.youtubeSource?.availabilityStatus)
      );
  }

  /**
   * Retrieves canonical public playlists.
   */
  async listPublicPlaylists(): Promise<CanonicalPlaylist[]> {
    const snapshot = await this.db
      .collection('playlists')
      .where('status', '==', 'Published')
      .get();

    return snapshot.docs.map(doc => doc.data() as CanonicalPlaylist);
  }
}

