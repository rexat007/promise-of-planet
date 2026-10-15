import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth, isFirebaseConfigured } from './firebase';
import type { PlatformGlobalSettings, UpdateGlobalSettingsInput } from '../types/settings';

function getFunctionsInstance() {
  if (!isFirebaseConfigured || !app) {
    throw new Error('BACKEND_UNCONFIGURED: Firebase backend is not configured in client environment.');
  }
  if (!auth?.currentUser) {
    throw new Error('UNAUTHENTICATED: Authentication required. Platform settings management requires an authenticated Admin user session.');
  }
  return getFunctions(app);
}

export interface SettingsAdminMutationResponse {
  settings: PlatformGlobalSettings;
  changes?: Array<{ field: string; oldValue: unknown; newValue: unknown }>;
  initialized?: boolean;
}

export const PlatformSettingsAdminClient = {
  isBackendAvailable(): boolean {
    return isFirebaseConfigured && !!app;
  },

  isAuthenticated(): boolean {
    return !!(isFirebaseConfigured && auth?.currentUser);
  },

  /**
   * Retrieves canonical settings document from server.
   */
  async get(): Promise<PlatformGlobalSettings | null> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string }, { settings: PlatformGlobalSettings | null }>(
      fns,
      'managePlatformSettings'
    );
    const res = await callable({ action: 'get' });
    return res.data?.settings ?? null;
  },

  /**
   * Initializes settings from defaults if not already present.
   * Requires ManageSettings permission.
   */
  async initializeFromDefaults(): Promise<{ settings: PlatformGlobalSettings; initialized: boolean }> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string }, { settings: PlatformGlobalSettings; initialized: boolean }>(
      fns,
      'managePlatformSettings'
    );
    const res = await callable({ action: 'initializeFromDefaults' });
    return res.data;
  },

  /**
   * Applies partial updates to canonical platform settings.
   * Requires ManageSettings permission.
   */
  async update(
    input: UpdateGlobalSettingsInput
  ): Promise<{ settings: PlatformGlobalSettings; changes: Array<{ field: string; oldValue: unknown; newValue: unknown }> }> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<
      { action: string; input: UpdateGlobalSettingsInput },
      { settings: PlatformGlobalSettings; changes: Array<{ field: string; oldValue: unknown; newValue: unknown }> }
    >(fns, 'managePlatformSettings');
    const res = await callable({ action: 'update', input });
    return res.data;
  },
};
