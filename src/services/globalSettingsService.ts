import type { AdminUser } from '../types/admin';
import { AdminPermission } from '../types/admin';
import type { AuditChange, AuditEvent } from '../types/audit';
import { AuditAction, AuditTargetType } from '../types/audit';
import type {
  PlatformGlobalSettings,
  SettingsMutationResult,
  SettingsValidationResult,
  UpdateGlobalSettingsInput,
} from '../types/settings';
import { AdminAccessService } from './adminAccess';
import { AdminAuditService } from './adminAuditService';

/**
 * Canonical Default Settings for Promise of Planet
 */
export const DEFAULT_GLOBAL_SETTINGS: Readonly<PlatformGlobalSettings> = Object.freeze({
  climateClockEnabled: true,
  defaultLanguage: 'ar',
});

/**
 * Allowed canonical setting keys.
 * Updates containing keys outside this set are strictly rejected.
 */
const ALLOWED_SETTING_KEYS = new Set<string>(['climateClockEnabled', 'defaultLanguage']);

/**
 * Global Settings Service
 *
 * Minimal canonical configuration service for existing platform-wide capabilities.
 *
 * Architecture Principles:
 * 1. Manages existing configurable platform behavior only (no speculative features).
 * 2. Does NOT store secrets, tokens, or private credentials.
 * 3. Reuses canonical RBAC authority (AdminPermission.ManageSettings).
 * 4. Transparent about in-memory persistence reality (no fake database abstraction).
 * 5. Provides read-only immutable access, atomic updates, and reactive subscriptions.
 */
export class GlobalSettingsService {
  private static currentSettings: PlatformGlobalSettings = { ...DEFAULT_GLOBAL_SETTINGS };
  private static listeners: Set<(settings: PlatformGlobalSettings) => void> = new Set();

  /**
   * Retrieves the current active global settings.
   * Returns an immutable frozen copy to prevent direct external mutation.
   */
  public static getSettings(): Readonly<PlatformGlobalSettings> {
    return Object.freeze({ ...this.currentSettings });
  }

  /**
   * Retrieves canonical default settings.
   */
  public static getDefaultSettings(): Readonly<PlatformGlobalSettings> {
    return DEFAULT_GLOBAL_SETTINGS;
  }

  /**
   * Validates a settings update payload.
   * Rejects unknown keys and validates value types.
   */
  public static validateSettings(input: Record<string, unknown>): SettingsValidationResult {
    const errors: string[] = [];

    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { isValid: false, errors: ['Settings input must be a valid non-null object.'] };
    }

    // 1. Strict key containment check (Anti-dumping ground rule)
    for (const key of Object.keys(input)) {
      if (!ALLOWED_SETTING_KEYS.has(key)) {
        errors.push(`Unknown setting key '${key}' is rejected. Global Settings does not permit unmanaged keys.`);
      }
    }

    // 2. Value validation: climateClockEnabled
    if ('climateClockEnabled' in input) {
      if (typeof input.climateClockEnabled !== 'boolean') {
        errors.push("Invalid value for 'climateClockEnabled': must be a boolean.");
      }
    }

    // 3. Value validation: defaultLanguage
    if ('defaultLanguage' in input) {
      const val = input.defaultLanguage;
      if (val !== 'ar' && val !== 'en') {
        errors.push("Invalid value for 'defaultLanguage': must be either 'ar' or 'en'.");
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Applies an atomic partial update to global settings.
   * Requires AdminPermission.ManageSettings.
   * Returns the updated settings and the structured AuditChange deltas.
   */
  public static updateSettings(
    input: UpdateGlobalSettingsInput & Record<string, unknown>,
    actor?: AdminUser
  ): SettingsMutationResult {
    // 1. Authorization check via canonical RBAC
    if (!actor || !AdminAccessService.hasPermission(actor, AdminPermission.ManageSettings)) {
      throw new Error(
        `Unauthorized: Action requires permission '${AdminPermission.ManageSettings}'.`
      );
    }

    // 2. Validation check
    const validation = this.validateSettings(input);
    if (!validation.isValid) {
      throw new Error(`Settings validation failed: ${validation.errors.join('; ')}`);
    }

    // 3. Calculate structured AuditChange deltas
    const changes: AuditChange[] = [];
    const prev = this.currentSettings;
    const next: PlatformGlobalSettings = { ...prev };

    if ('climateClockEnabled' in input && input.climateClockEnabled !== undefined) {
      if (input.climateClockEnabled !== prev.climateClockEnabled) {
        changes.push({
          field: 'climateClockEnabled',
          previousValue: prev.climateClockEnabled,
          newValue: input.climateClockEnabled,
        });
        (next as { climateClockEnabled: boolean }).climateClockEnabled = input.climateClockEnabled;
      }
    }

    if ('defaultLanguage' in input && input.defaultLanguage !== undefined) {
      if (input.defaultLanguage !== prev.defaultLanguage) {
        changes.push({
          field: 'defaultLanguage',
          previousValue: prev.defaultLanguage,
          newValue: input.defaultLanguage,
        });
        (next as { defaultLanguage: 'ar' | 'en' }).defaultLanguage = input.defaultLanguage;
      }
    }

    // 4. No-Op Protection: If no effective state changes, do not mutate, notify, or create misleading audit events
    if (changes.length === 0) {
      return {
        settings: this.getSettings(),
        changes: [],
      };
    }

    // 5. Commit update in memory
    this.currentSettings = next;

    // 6. Record canonical AuditEvent with defensive in-memory rollback guard
    let auditEvent: AuditEvent;
    try {
      auditEvent = AdminAuditService.recordEvent({
        actorUserId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        action: AuditAction.Updated,
        targetType: AuditTargetType.GlobalSettings,
        targetId: 'platform-global-settings',
        targetTitle: 'Platform Global Settings',
        changes,
      });
    } catch (auditErr) {
      // In-memory rollback to prevent settings-audit divergence
      this.currentSettings = prev;
      throw auditErr;
    }

    // 7. Notify reactive subscribers only after state and audit consistency
    const frozen = this.getSettings();
    this.listeners.forEach((listener) => {
      try {
        listener(frozen);
      } catch (err) {
        console.error('Error in GlobalSettingsService subscriber:', err);
      }
    });

    return {
      settings: frozen,
      changes,
      auditEvent,
    };
  }

  /**
   * Resets global settings to canonical defaults.
   * Requires AdminPermission.ManageSettings.
   */
  public static resetToDefaults(actor?: AdminUser): SettingsMutationResult {
    return this.updateSettings(
      {
        climateClockEnabled: DEFAULT_GLOBAL_SETTINGS.climateClockEnabled,
        defaultLanguage: DEFAULT_GLOBAL_SETTINGS.defaultLanguage,
      },
      actor
    );
  }

  /**
   * Subscribes to settings change events.
   * Returns an unsubscribe function.
   */
  public static subscribe(listener: (settings: PlatformGlobalSettings) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
