import type { AdminUser } from '../types/admin';
import type { PlatformGlobalSettings, UpdateGlobalSettingsInput } from '../../../src/types/settings';
import { DEFAULT_GLOBAL_SETTINGS } from '../../../src/services/globalSettingsService';
import type { IPlatformSettingsRepository } from './platformSettingsRepository';
import { PlatformSettingsValidator } from './platformSettingsValidator';

export interface FieldChange {
  field: string;
  oldValue: any;
  newValue: any;
}

export class PlatformSettingsService {
  constructor(private repository: IPlatformSettingsRepository) {}

  /**
   * Retrieves active platform settings. Returns null if uninitialized.
   */
  public async getSettings(): Promise<PlatformGlobalSettings | null> {
    return this.repository.get();
  }

  /**
   * Initializes canonical settings ONLY through explicit administrative action.
   * If document already exists, do NOT overwrite it.
   */
  public async initializeFromDefaults(
    admin: AdminUser
  ): Promise<{ settings: PlatformGlobalSettings; initialized: boolean }> {
    const existing = await this.repository.get();
    if (existing) {
      return {
        settings: existing,
        initialized: false,
      };
    }

    const now = new Date().toISOString();
    const initialSettings: PlatformGlobalSettings = {
      ...DEFAULT_GLOBAL_SETTINGS,
      updatedAt: now,
      updatedBy: admin.id,
    };

    const saved = await this.repository.save(initialSettings);
    return {
      settings: saved,
      initialized: true,
    };
  }

  /**
   * Updates platform settings with partial input, computing effective field changes.
   * Provides no-op protection and generates server stamps.
   */
  public async updateSettings(
    input: Record<string, any>,
    admin: AdminUser
  ): Promise<{ settings: PlatformGlobalSettings; changes: FieldChange[] }> {
    const validation = PlatformSettingsValidator.validateMutationInput(input);
    if (!validation.isValid) {
      throw new Error(`VALIDATION_ERROR: ${validation.errors.join('; ')}`);
    }

    const current = await this.repository.get();
    if (!current) {
      throw new Error('NOT_INITIALIZED: Platform settings have not been initialized yet. Run initializeFromDefaults first.');
    }

    // Deep merge helper
    const next: PlatformGlobalSettings = {
      ...current,
      identity: input.identity ? { ...current.identity, ...input.identity } : current.identity,
      institutional: input.institutional ? { ...current.institutional, ...input.institutional } : current.institutional,
      channels: input.channels ? {
        youtube: input.channels.youtube ? { ...current.channels.youtube, ...input.channels.youtube } : current.channels.youtube,
        facebook: input.channels.facebook ? { ...current.channels.facebook, ...input.channels.facebook } : current.channels.facebook,
        instagram: input.channels.instagram ? { ...current.channels.instagram, ...input.channels.instagram } : current.channels.instagram,
        whatsapp: input.channels.whatsapp ? { ...current.channels.whatsapp, ...input.channels.whatsapp } : current.channels.whatsapp,
      } : current.channels,
      contact: input.contact ? { ...current.contact, ...input.contact } : current.contact,
      footer: input.footer ? { ...current.footer, ...input.footer } : current.footer,
      legal: input.legal ? {
        privacy: input.legal.privacy ? { ...current.legal.privacy, ...input.legal.privacy } : current.legal.privacy,
        terms: input.legal.terms ? { ...current.legal.terms, ...input.legal.terms } : current.legal.terms,
      } : current.legal,
      metadata: input.metadata ? { ...current.metadata, ...input.metadata } : current.metadata,
      behavior: {
        climateClockEnabled: input.behavior?.climateClockEnabled ?? input.climateClockEnabled ?? current.behavior.climateClockEnabled,
        defaultLanguage: input.behavior?.defaultLanguage ?? input.defaultLanguage ?? current.behavior.defaultLanguage,
      },
      climateClockEnabled: input.behavior?.climateClockEnabled ?? input.climateClockEnabled ?? current.behavior.climateClockEnabled,
      defaultLanguage: input.behavior?.defaultLanguage ?? input.defaultLanguage ?? current.behavior.defaultLanguage,
      updatedAt: new Date().toISOString(),
      updatedBy: admin.id,
    };

    // Calculate effective field changes
    const changes: FieldChange[] = [];
    this.diffObjects('', current, next, changes);

    // No-op protection
    if (changes.length === 0) {
      return {
        settings: current,
        changes: [],
      };
    }

    // Validate complete merged object before persistence
    const completeValidation = PlatformSettingsValidator.validateCompleteSettings(next);
    if (!completeValidation.isValid) {
      throw new Error(`VALIDATION_ERROR: Resulting settings invalid: ${completeValidation.errors.join('; ')}`);
    }

    const saved = await this.repository.save(next);
    return {
      settings: saved,
      changes,
    };
  }

  private diffObjects(prefix: string, oldObj: any, newObj: any, changes: FieldChange[]): void {
    const ignoredKeys = new Set(['updatedAt', 'updatedBy', 'climateClockEnabled', 'defaultLanguage']);

    for (const key of Object.keys(newObj)) {
      if (ignoredKeys.has(key) && prefix === '') continue;

      const path = prefix ? `${prefix}.${key}` : key;
      const oldVal = oldObj ? oldObj[key] : undefined;
      const newVal = newObj[key];

      if (newVal !== null && typeof newVal === 'object' && !Array.isArray(newVal)) {
        this.diffObjects(path, oldVal || {}, newVal, changes);
      } else if (oldVal !== newVal) {
        changes.push({
          field: path,
          oldValue: oldVal ?? null,
          newValue: newVal ?? null,
        });
      }
    }
  }
}
