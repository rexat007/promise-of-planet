import { getFirestore } from 'firebase-admin/firestore';
import type { PlatformGlobalSettings } from '../../../src/types/settings';
import { PlatformSettingsValidator } from './platformSettingsValidator';

export interface IPlatformSettingsRepository {
  get(): Promise<PlatformGlobalSettings | null>;
  save(settings: PlatformGlobalSettings): Promise<PlatformGlobalSettings>;
}

export class FirestorePlatformSettingsRepository implements IPlatformSettingsRepository {
  private db = getFirestore();
  private readonly collectionName = 'platform_settings';
  private readonly documentId = 'global';

  /**
   * Reads canonical platform settings document.
   * Deserializes and validates through validator. Fails closed on malformed document.
   */
  public async get(): Promise<PlatformGlobalSettings | null> {
    const docRef = this.db.collection(this.collectionName).doc(this.documentId);
    const snap = await docRef.get();

    if (!snap.exists) {
      return null;
    }

    const data = snap.data();
    if (!data) {
      return null;
    }

    const validation = PlatformSettingsValidator.validateCompleteSettings(data);
    if (!validation.isValid) {
      console.error(
        'CRITICAL: Malformed platform_settings/global persisted document in Firestore. Failing closed.',
        validation.errors
      );
      throw new Error(`MALFORMED_SETTINGS_DOCUMENT: ${validation.errors.join('; ')}`);
    }

    return data as PlatformGlobalSettings;
  }

  /**
   * Sets/updates canonical platform settings document using Firestore transaction semantics.
   * No delete operation is provided.
   */
  public async save(settings: PlatformGlobalSettings): Promise<PlatformGlobalSettings> {
    const validation = PlatformSettingsValidator.validateCompleteSettings(settings);
    if (!validation.isValid) {
      throw new Error(`VALIDATION_ERROR: Cannot persist invalid settings: ${validation.errors.join('; ')}`);
    }

    const docRef = this.db.collection(this.collectionName).doc(this.documentId);

    await this.db.runTransaction(async (transaction) => {
      transaction.set(docRef, settings, { merge: false });
    });

    return settings;
  }
}
