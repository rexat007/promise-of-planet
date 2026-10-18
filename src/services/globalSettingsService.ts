import type { AdminUser } from '../types/admin';
import { AdminPermission } from '../types/admin';
import type { AuditChange } from '../types/audit';
import { AuditAction, AuditTargetType } from '../types/audit';
import {
  DEFAULT_GLOBAL_SETTINGS,
  type PlatformGlobalSettings,
  type SettingsMutationResult,
  type SettingsValidationResult,
  type UpdateGlobalSettingsInput,
} from '../types/settings';
import { AdminAccessService } from './adminAccess';
import { AdminAuditService } from './adminAuditService';

export { DEFAULT_GLOBAL_SETTINGS };


/**
 * Allowed top-level canonical setting keys.
 */
const ALLOWED_TOP_LEVEL_KEYS = new Set<string>([
  'identity',
  'institutional',
  'channels',
  'contact',
  'footer',
  'legal',
  'metadata',
  'behavior',
  'climateClockEnabled',
  'defaultLanguage',
]);

/**
 * Global Settings Service
 *
 * Provides in-memory state, subscriber reactivity, and validation.
 */
export class GlobalSettingsService {
  private static currentSettings: PlatformGlobalSettings = { ...DEFAULT_GLOBAL_SETTINGS };
  private static listeners: Set<(settings: PlatformGlobalSettings) => void> = new Set();

  /**
   * Retrieves the current active global settings.
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
   */
  public static validateSettings(input: Record<string, unknown>): SettingsValidationResult {
    const errors: string[] = [];

    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { isValid: false, errors: ['Settings input must be a valid non-null object.'] };
    }

    for (const key of Object.keys(input)) {
      if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
        errors.push(`Unknown setting key '${key}' is rejected. Global Settings does not permit unmanaged keys.`);
      }
    }

    // Top-level or nested behavior checks
    if ('climateClockEnabled' in input && typeof input.climateClockEnabled !== 'boolean') {
      errors.push("Invalid value for 'climateClockEnabled': must be a boolean.");
    }

    if ('defaultLanguage' in input && input.defaultLanguage !== 'ar' && input.defaultLanguage !== 'en') {
      errors.push("Invalid value for 'defaultLanguage': must be either 'ar' or 'en'.");
    }

    if ('behavior' in input && input.behavior && typeof input.behavior === 'object') {
      const b = input.behavior as Record<string, unknown>;
      if ('climateClockEnabled' in b && typeof b.climateClockEnabled !== 'boolean') {
        errors.push("Invalid value for 'behavior.climateClockEnabled': must be a boolean.");
      }
      if ('defaultLanguage' in b && b.defaultLanguage !== 'ar' && b.defaultLanguage !== 'en') {
        errors.push("Invalid value for 'behavior.defaultLanguage': must be either 'ar' or 'en'.");
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
   */
  public static updateSettings(
    input: UpdateGlobalSettingsInput,
    actor?: AdminUser | null
  ): SettingsMutationResult {
    if (!actor || !AdminAccessService.hasPermission(actor, AdminPermission.ManageSettings)) {
      throw new Error('ACCESS_DENIED: User lacks permission to manage platform settings.');
    }

    const validation = this.validateSettings(input as Record<string, unknown>);
    if (!validation.isValid) {
      throw new Error(`VALIDATION_FAILED: ${validation.errors.join('; ')}`);
    }

    const prev = this.currentSettings;
    const next: PlatformGlobalSettings = {
      ...prev,
      identity: input.identity ? { ...prev.identity, ...input.identity } : prev.identity,
      institutional: input.institutional ? { ...prev.institutional, ...input.institutional } : prev.institutional,
      channels: input.channels ? {
        youtube: input.channels.youtube ? { ...prev.channels.youtube, ...input.channels.youtube } : prev.channels.youtube,
        facebook: input.channels.facebook ? { ...prev.channels.facebook, ...input.channels.facebook } : prev.channels.facebook,
        instagram: input.channels.instagram ? { ...prev.channels.instagram, ...input.channels.instagram } : prev.channels.instagram,
        whatsapp: input.channels.whatsapp ? { ...prev.channels.whatsapp, ...input.channels.whatsapp } : prev.channels.whatsapp,
      } : prev.channels,
      contact: input.contact ? { ...prev.contact, ...input.contact } : prev.contact,
      footer: input.footer ? { ...prev.footer, ...input.footer } : prev.footer,
      legal: input.legal ? {
        privacy: input.legal.privacy ? { ...prev.legal.privacy, ...input.legal.privacy } : prev.legal.privacy,
        terms: input.legal.terms ? { ...prev.legal.terms, ...input.legal.terms } : prev.legal.terms,
      } : prev.legal,
      metadata: input.metadata ? { ...prev.metadata, ...input.metadata } : prev.metadata,
      behavior: {
        climateClockEnabled: input.behavior?.climateClockEnabled ?? input.climateClockEnabled ?? prev.behavior.climateClockEnabled,
        defaultLanguage: input.behavior?.defaultLanguage ?? input.defaultLanguage ?? prev.behavior.defaultLanguage,
      },
      climateClockEnabled: input.behavior?.climateClockEnabled ?? input.climateClockEnabled ?? prev.behavior.climateClockEnabled,
      defaultLanguage: input.behavior?.defaultLanguage ?? input.defaultLanguage ?? prev.behavior.defaultLanguage,
      updatedAt: new Date().toISOString(),
      updatedBy: actor.id,
    };

    // Calculate changes
    const changes: AuditChange[] = [];
    if (prev.behavior.climateClockEnabled !== next.behavior.climateClockEnabled) {
      changes.push({
        field: 'behavior.climateClockEnabled',
        previousValue: prev.behavior.climateClockEnabled,
        newValue: next.behavior.climateClockEnabled,
      });
    }
    if (prev.behavior.defaultLanguage !== next.behavior.defaultLanguage) {
      changes.push({
        field: 'behavior.defaultLanguage',
        previousValue: prev.behavior.defaultLanguage,
        newValue: next.behavior.defaultLanguage,
      });
    }

    if (changes.length > 0) {
      this.currentSettings = next;
      this.notifyListeners(next);

      const auditEvent = AdminAuditService.recordEvent({
        actorUserId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        action: AuditAction.Updated,
        targetType: AuditTargetType.GlobalSettings,
        targetId: 'platform_global_settings',
        targetTitle: 'Global Platform Settings',
        changes,
        metadata: { note: `Updated settings fields: ${changes.map((c) => c.field).join(', ')}` },
      });

      return {
        settings: this.getSettings(),
        changes,
        auditEvent,
      };
    }

    return {
      settings: this.getSettings(),
      changes: [],
    };
  }

  /**
   * Resets settings to canonical defaults.
   */
  public static resetToDefaults(actor: AdminUser): SettingsMutationResult {
    if (!AdminAccessService.hasPermission(actor, AdminPermission.ManageSettings)) {
      throw new Error('ACCESS_DENIED: User lacks permission to manage platform settings.');
    }

    const prev = this.currentSettings;
    const defaults = DEFAULT_GLOBAL_SETTINGS;

    const changes: AuditChange[] = [];
    if (prev.behavior.climateClockEnabled !== defaults.behavior.climateClockEnabled) {
      changes.push({
        field: 'behavior.climateClockEnabled',
        previousValue: prev.behavior.climateClockEnabled,
        newValue: defaults.behavior.climateClockEnabled,
      });
    }
    if (prev.behavior.defaultLanguage !== defaults.behavior.defaultLanguage) {
      changes.push({
        field: 'behavior.defaultLanguage',
        previousValue: prev.behavior.defaultLanguage,
        newValue: defaults.behavior.defaultLanguage,
      });
    }

    this.currentSettings = { ...defaults, updatedAt: new Date().toISOString(), updatedBy: actor.id };
    this.notifyListeners(this.currentSettings);

    const auditEvent = AdminAuditService.recordEvent({
      actorUserId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: AuditAction.Updated,
      targetType: AuditTargetType.GlobalSettings,
      targetId: 'platform_global_settings',
      targetTitle: 'Global Platform Settings',
      changes: changes.length > 0 ? changes : [{ field: 'all', previousValue: 'custom', newValue: 'defaults' }],
      metadata: { note: 'Global platform settings were reset to baseline defaults.' },
    });

    return {
      settings: this.getSettings(),
      changes,
      auditEvent,
    };
  }

  /**
   * Subscribes a listener callback to settings changes.
   */
  public static subscribe(listener: (settings: PlatformGlobalSettings) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private static notifyListeners(settings: PlatformGlobalSettings): void {
    const frozen = Object.freeze({ ...settings });
    this.listeners.forEach((listener) => {
      try {
        listener(frozen);
      } catch (e) {
        console.error('Error executing GlobalSettingsService subscriber listener:', e);
      }
    });
  }
}
