import { doc, getDoc } from 'firebase/firestore';
import { db, isFirebaseConfigured } from './firebase';
import type { PlatformGlobalSettings } from '../types/settings';

export interface PublicSettingsResult {
  readonly isBackendConfigured: boolean;
  readonly isInitialized: boolean;
  readonly settings: PlatformGlobalSettings | null;
  readonly error?: string;
}

export class PlatformSettingsPublicClient {
  private static readonly COLLECTION_NAME = 'platform_settings';
  private static readonly DOCUMENT_ID = 'global';

  /**
   * Retrieves canonical public platform settings from Firestore.
   * If Firestore is not configured or document does not exist, returns isInitialized: false.
   */
  public static async getSettings(): Promise<PublicSettingsResult> {
    if (!isFirebaseConfigured || !db) {
      return {
        isBackendConfigured: false,
        isInitialized: false,
        settings: null,
      };
    }

    try {
      const docRef = doc(db, this.COLLECTION_NAME, this.DOCUMENT_ID);
      const snap = await getDoc(docRef);

      if (!snap.exists()) {
        return {
          isBackendConfigured: true,
          isInitialized: false,
          settings: null,
        };
      }

      const data = snap.data();
      if (!data || typeof data !== 'object') {
        return {
          isBackendConfigured: true,
          isInitialized: false,
          settings: null,
          error: 'Persisted settings document is empty or malformed.',
        };
      }

      return {
        isBackendConfigured: true,
        isInitialized: true,
        settings: data as PlatformGlobalSettings,
      };
    } catch (e: any) {
      console.error('PlatformSettingsPublicClient: Error fetching public settings:', e?.message || e);
      return {
        isBackendConfigured: true,
        isInitialized: false,
        settings: null,
        error: e?.message || String(e),
      };
    }
  }
}
