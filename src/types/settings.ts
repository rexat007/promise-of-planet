import type { Language } from '../types';
import type { AuditChange, AuditEvent } from './audit';

/**
 * Platform Identity Settings
 */
export interface PlatformIdentitySettings {
  readonly platformNameAr: string;
  readonly platformNameEn: string;
  readonly taglineAr: string;
  readonly taglineEn: string;
  readonly subtitleAr: string;
  readonly subtitleEn: string;
  readonly descriptionAr: string;
  readonly descriptionEn: string;

  /**
   * Canonical logo reference (URL to hosted/static asset).
   * Nullable to allow graceful fallback to typographic brand.
   */
  readonly logoUrl: string | null;
  readonly logoStoragePath: string | null;
  readonly logoDarkUrl?: string | null;
  readonly faviconUrl?: string | null;
}

/**
 * Institutional Positioning & Governance Content
 */
export interface PlatformInstitutionalSettings {
  readonly aboutIntroAr: string;
  readonly aboutIntroEn: string;
  readonly visionAr: string;
  readonly visionEn: string;
  readonly missionAr: string;
  readonly missionEn: string;
  readonly sudanContextAr: string;
  readonly sudanContextEn: string;
  readonly editorialPositioningAr: string;
  readonly editorialPositioningEn: string;
  readonly conferenceCoverageStatementAr: string;
  readonly conferenceCoverageStatementEn: string;
}

/**
 * Social Channel Item
 */
export interface PlatformChannelItem {
  readonly url: string;
  readonly enabled: boolean;
}

/**
 * Official External Channels
 */
export interface PlatformChannelsSettings {
  readonly youtube: PlatformChannelItem;
  readonly facebook: PlatformChannelItem;
  readonly instagram: PlatformChannelItem;
  readonly whatsapp: PlatformChannelItem;
}

/**
 * Public Contact & Accreditation Guidance
 */
export interface PlatformContactSettings {
  readonly contactEmail: string;
  readonly pressEmail: string;
  readonly phone: string;
  readonly addressAr: string;
  readonly addressEn: string;
  readonly accreditationNoticeAr: string;
  readonly accreditationNoticeEn: string;
}

/**
 * Public Footer Content
 */
export interface PlatformFooterSettings {
  readonly descriptionAr: string;
  readonly descriptionEn: string;
  readonly rightsTextAr: string;
  readonly rightsTextEn: string;
}

/**
 * Legal Document Entry
 */
export interface PlatformLegalDocument {
  readonly titleAr: string;
  readonly titleEn: string;
  readonly contentAr: string;
  readonly contentEn: string;
  readonly effectiveDate: string | null;
  readonly published: boolean;
}

/**
 * Legal Policies
 */
export interface PlatformLegalSettings {
  readonly privacy: PlatformLegalDocument;
  readonly terms: PlatformLegalDocument;
}

/**
 * SEO & Meta Tags
 */
export interface PlatformMetadataSettings {
  readonly siteTitleAr: string;
  readonly siteTitleEn: string;
  readonly metaDescriptionAr: string;
  readonly metaDescriptionEn: string;
}

/**
 * System Capabilities & Runtime Behavior
 */
export interface PlatformBehaviorSettings {
  readonly climateClockEnabled: boolean;
  readonly defaultLanguage: Language;
}

/**
 * Canonical Global Platform Settings Contract
 *
 * Defines the strongly-typed, durable configuration values for platform identity,
 * institutional copy, external presence, legal disclosures, and capabilities.
 */
export interface PlatformGlobalSettings {
  readonly identity: PlatformIdentitySettings;
  readonly institutional: PlatformInstitutionalSettings;
  readonly channels: PlatformChannelsSettings;
  readonly contact: PlatformContactSettings;
  readonly footer: PlatformFooterSettings;
  readonly legal: PlatformLegalSettings;
  readonly metadata: PlatformMetadataSettings;
  readonly behavior: PlatformBehaviorSettings;

  /**
   * Backwards-compatibility aliases for un-migrated components (AdminGlobalSettings, verification tests)
   */
  readonly climateClockEnabled?: boolean;
  readonly defaultLanguage?: Language;

  readonly updatedAt: string;
  readonly updatedBy: string;
}

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? DeepPartial<U>[]
    : T[P] extends readonly (infer U)[]
    ? readonly DeepPartial<U>[]
    : T[P] extends object
    ? DeepPartial<T[P]>
    : T[P];
};

/**
 * Partial update payload for global settings.
 */
export type UpdateGlobalSettingsInput = DeepPartial<PlatformGlobalSettings>;

/**
 * Settings validation outcome.
 */
export interface SettingsValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
}

/**
 * Result of a settings mutation operation.
 */
export interface SettingsMutationResult {
  readonly settings: PlatformGlobalSettings;
  readonly changes: readonly AuditChange[];
  readonly auditEvent?: AuditEvent;
}
