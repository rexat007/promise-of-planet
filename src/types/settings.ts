import type { Language } from '../types';
import type { AuditChange, AuditEvent } from './audit';

/**
 * Canonical Global Platform Settings Contract
 *
 * Defines the strongly-typed, bounded configuration values for existing
 * platform-wide capabilities in Promise of Planet.
 *
 * Invariants:
 * 1. Contains only settings with actual runtime consumers in the platform.
 * 2. Strictly excludes secrets, API keys, credentials, and domain-specific entities.
 * 3. Reuses existing canonical types (e.g., Language) to avoid duplicate sources of truth.
 * 4. Bounded to existing platform capabilities; excludes platform development or speculative toggles.
 */
export interface PlatformGlobalSettings {
  /**
   * Platform-controlled display of the official Climate Clock widget slot.
   * Controls whether the ClimateClockSlot renders on public portal pages.
   */
  readonly climateClockEnabled: boolean;

  /**
   * System-wide default/fallback language for the platform.
   * Reuses the canonical Language union ('ar' | 'en').
   */
  readonly defaultLanguage: Language;
}

/**
 * Partial update payload for global settings.
 * Only known canonical keys are permitted.
 */
export type UpdateGlobalSettingsInput = Partial<PlatformGlobalSettings>;

/**
 * Settings validation outcome.
 */
export interface SettingsValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
}

/**
 * Result of a settings update operation.
 * Returns the new settings state and calculated audit changes.
 */
export interface SettingsMutationResult {
  readonly settings: PlatformGlobalSettings;
  readonly changes: readonly AuditChange[];
  readonly auditEvent?: AuditEvent;
}
