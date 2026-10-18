import type { AuditChange, AuditEvent } from './auditContract';

export type Language = 'ar' | 'en';

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

/**
 * Canonical Safe Default / Fallback Settings for Promise of Planet
 *
 * Invariants:
 * - Fallback is NOT persistent.
 * - Fallback is NOT source of truth once Firestore canonical settings exist.
 * - Fallback contains strictly verified channels only (YouTube, Facebook).
 * - No fake contact info or legal commitments.
 */
export const DEFAULT_GLOBAL_SETTINGS: Readonly<PlatformGlobalSettings> = Object.freeze({
  identity: Object.freeze({
    platformNameAr: 'وعد الكوكب',
    platformNameEn: 'Promise of Planet',
    taglineAr: 'منصة تعليمية وإعلامية بيئية',
    taglineEn: 'Environmental Educational and Media Platform',
    subtitleAr: 'منصة سودانية للصحافة والمعرفة البيئية',
    subtitleEn: 'Sudanese Platform for Environmental Journalism and Knowledge',
    descriptionAr: 'منصة رائدة للصحافة والمعرفة البيئية والتدريب والمشاركة المجتمعية في السودان.',
    descriptionEn: 'A leading platform for environmental journalism, knowledge, training, and community engagement in Sudan.',
    logoUrl: null,
    logoStoragePath: null,
    logoDarkUrl: null,
    faviconUrl: null,
  }),
  institutional: Object.freeze({
    aboutIntroAr: 'منصة إعلامية ومعرفية وتدريبية مستقلة مكرسة لقضايا البيئة، التغير المناخي، حوكمة الموارد الطبيعية، والتنمية المستدامة في السودان والمنطقة.',
    aboutIntroEn: 'An environmental media, knowledge, and training platform dedicated to climate resilience, natural resource governance, and ecological stewardship in Sudan and the surrounding region.',
    visionAr: 'بيئة سودانية وإقليمية واعية ومستدامة، تعتمد على المعرفة الموثوقة والمساءلة المجتمعية في حماية الموارد الطبيعية.',
    visionEn: 'An informed and sustainable Sudanese and regional environment grounded in verified knowledge and community stewardship of natural resources.',
    missionAr: 'تقديم تغطية صحفية علمية رصينة وموضوعية حول التحديات المناخية والبيئية، وتوفير مساحة لتوثيق التحولات الميدانية، ومساندة التدريب وبناء المهارات الصحفية المتخصصة.',
    missionEn: 'Delivering rigorous, evidence-based environmental journalism, documenting field realities, and empowering researchers and media practitioners with specialized skills.',
    sudanContextAr: 'يركز العمل على توثيق آثار الجفاف والنزاعات البيئية وأنشطة التعدين وإدارة أحواض الأنهار والمياه الجوفية في السودان.',
    sudanContextEn: 'Focusing on documenting climate impacts, drought, environmental governance, mining pressures, and river basin stewardship across Sudan.',
    editorialPositioningAr: 'الالتزام التام بالحياد المهني، والاستناد إلى الأدلة العلمية والتحقق الميداني والشفافية في نقل الحقائق البيئية.',
    editorialPositioningEn: 'Committed to professional neutrality, scientific grounding, field verification, and editorial transparency.',
    conferenceCoverageStatementAr: 'تغطيات ميدانية وتوثيقية للفعاليات والمؤتمرات المناخية الإقليمية والدولية لنقل صوت المجتمعات المتأثرة.',
    conferenceCoverageStatementEn: 'Field and documentary coverage of regional and global climate conferences, amplifying the voices of affected communities.',
  }),
  channels: Object.freeze({
    youtube: Object.freeze({
      url: 'https://www.youtube.com/@PromiseOfPlanet',
      enabled: true,
    }),
    facebook: Object.freeze({
      url: 'https://www.facebook.com/PromiseOfPlanet/',
      enabled: true,
    }),
    instagram: Object.freeze({
      url: '',
      enabled: false,
    }),
    whatsapp: Object.freeze({
      url: '',
      enabled: false,
    }),
  }),
  contact: Object.freeze({
    contactEmail: '',
    pressEmail: '',
    phone: '',
    addressAr: '',
    addressEn: '',
    accreditationNoticeAr: 'للصحفيين والباحثين والمؤسسات المهتمة بالتغطيات الصحفية والفعاليات البيئية والمناخية، يمكن التواصل ومتابعة التحديثات عبر قنوات البث الرسمية المعلنة، إلى حين إطلاق بوابة الاتصال التحريرية المباشرة.',
    accreditationNoticeEn: 'Journalists, researchers, and organizations seeking accreditation verification and environmental conference coverage inquiries can follow official updates via our official broadcast channels.',
  }),
  footer: Object.freeze({
    descriptionAr: 'منصة سودانية للصحافة والمعرفة البيئية والتدريب والمشاركة المجتمعية.',
    descriptionEn: 'Sudanese platform for environmental journalism, knowledge, training, and community engagement.',
    rightsTextAr: 'جميع الحقوق محفوظة © 2026 وعد الكوكب',
    rightsTextEn: 'All rights reserved © 2026 Promise of Planet',
  }),
  legal: Object.freeze({
    privacy: Object.freeze({
      titleAr: 'سياسة الخصوصية',
      titleEn: 'Privacy Policy',
      contentAr: '',
      contentEn: '',
      effectiveDate: null,
      published: false,
    }),
    terms: Object.freeze({
      titleAr: 'شروط الخدمة',
      titleEn: 'Terms of Service',
      contentAr: '',
      contentEn: '',
      effectiveDate: null,
      published: false,
    }),
  }),
  metadata: Object.freeze({
    siteTitleAr: 'وعد الكوكب | Promise of Planet',
    siteTitleEn: 'Promise of Planet | Environmental Media & Knowledge',
    metaDescriptionAr: 'منصة وعد الكوكب - منصة رائدة للصحافة والمعرفة البيئية والتدريب في السودان.',
    metaDescriptionEn: 'Promise of Planet - Leading environmental journalism, knowledge, and training platform in Sudan.',
  }),
  behavior: Object.freeze({
    climateClockEnabled: true,
    defaultLanguage: 'ar',
  }),
  climateClockEnabled: true,
  defaultLanguage: 'ar',
  updatedAt: '2026-01-01T00:00:00.000Z',
  updatedBy: 'system',
});
