import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, isFirebaseConfigured } from './firebase';
import type { Video, CanonicalPlaylist, Language } from '../types';
import { isVideoVisibleInMediaHub } from './contentVisibility';

export interface PublicMultimediaData {
  videos: Video[];
  playlists: CanonicalPlaylist[];
}

export class PublicMediaClient {
  /**
   * Retrieves canonically eligible public multimedia items and playlists via
   * the secure server-side Firebase v2 HTTPS function `getPublicMultimedia`.
   * Enforces fail-closed behavior on failure or unconfigured environments.
   */
  public static async fetchPublicMultimedia(currentLanguage?: Language): Promise<PublicMultimediaData> {
    if (!isFirebaseConfigured || !app) {
      throw new Error('BACKEND_UNCONFIGURED: Firebase backend is not configured. Public multimedia requires active backend connectivity.');
    }

    try {
      const fns = getFunctions(app);
      const callable = httpsCallable<void, { videos: Video[]; playlists: CanonicalPlaylist[] }>(
        fns,
        'getPublicMultimedia'
      );
      const res = await callable();
      const data = res.data;

      const rawVideos = Array.isArray(data?.videos) ? data.videos : [];
      const rawPlaylists = Array.isArray(data?.playlists) ? data.playlists : [];

      // Double-sanitize on client side as an extra governance layer
      const eligibleVideos = rawVideos.filter(video => {
        const check = isVideoVisibleInMediaHub(video, currentLanguage);
        return check.visible;
      });

      const eligibleVideoIds = new Set(eligibleVideos.map(v => v.id));
      const eligiblePlaylists = rawPlaylists
        .map(pl => ({
          ...pl,
          videoIds: (pl.videoIds || []).filter(id => eligibleVideoIds.has(id)),
        }))
        .filter(pl => pl.status === 'Published' && pl.videoIds.length > 0);

      return {
        videos: eligibleVideos,
        playlists: eligiblePlaylists,
      };
    } catch (err: any) {
      console.error('PublicMediaClient: Failed to fetch public multimedia from server function:', err);
      throw err; // Fail-closed: Never fallback to local mock fixtures
    }
  }
}

