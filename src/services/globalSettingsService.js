"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GlobalSettingsService = exports.DEFAULT_GLOBAL_SETTINGS = void 0;
const admin_1 = require("../types/admin");
const audit_1 = require("../types/audit");
const adminAccess_1 = require("./adminAccess");
const adminAuditService_1 = require("./adminAuditService");
/**
 * Canonical Safe Default / Fallback Settings for Promise of Planet
 *
 * Invariants:
 * - Fallback is NOT persistent.
 * - Fallback is NOT source of truth once Firestore canonical settings exist.
 * - Fallback contains strictly verified channels only (YouTube, Facebook).
 * - No fake contact info or legal commitments.
 */
exports.DEFAULT_GLOBAL_SETTINGS = Object.freeze({
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
/**
 * Allowed top-level canonical setting keys.
 */
const ALLOWED_TOP_LEVEL_KEYS = new Set([
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
class GlobalSettingsService {
    static currentSettings = { ...exports.DEFAULT_GLOBAL_SETTINGS };
    static listeners = new Set();
    /**
     * Retrieves the current active global settings.
     */
    static getSettings() {
        return Object.freeze({ ...this.currentSettings });
    }
    /**
     * Retrieves canonical default settings.
     */
    static getDefaultSettings() {
        return exports.DEFAULT_GLOBAL_SETTINGS;
    }
    /**
     * Validates a settings update payload.
     */
    static validateSettings(input) {
        const errors = [];
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
            const b = input.behavior;
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
    static updateSettings(input, actor) {
        if (!actor || !adminAccess_1.AdminAccessService.hasPermission(actor, admin_1.AdminPermission.ManageSettings)) {
            throw new Error('ACCESS_DENIED: User lacks permission to manage platform settings.');
        }
        const validation = this.validateSettings(input);
        if (!validation.isValid) {
            throw new Error(`VALIDATION_FAILED: ${validation.errors.join('; ')}`);
        }
        const prev = this.currentSettings;
        const next = {
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
        const changes = [];
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
            const auditEvent = adminAuditService_1.AdminAuditService.recordEvent({
                actorUserId: actor.id,
                actorName: actor.name,
                actorRole: actor.role,
                action: audit_1.AuditAction.Updated,
                targetType: audit_1.AuditTargetType.GlobalSettings,
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
    static resetToDefaults(actor) {
        if (!adminAccess_1.AdminAccessService.hasPermission(actor, admin_1.AdminPermission.ManageSettings)) {
            throw new Error('ACCESS_DENIED: User lacks permission to manage platform settings.');
        }
        const prev = this.currentSettings;
        const defaults = exports.DEFAULT_GLOBAL_SETTINGS;
        const changes = [];
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
        const auditEvent = adminAuditService_1.AdminAuditService.recordEvent({
            actorUserId: actor.id,
            actorName: actor.name,
            actorRole: actor.role,
            action: audit_1.AuditAction.Updated,
            targetType: audit_1.AuditTargetType.GlobalSettings,
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
    static subscribe(listener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
    static notifyListeners(settings) {
        const frozen = Object.freeze({ ...settings });
        this.listeners.forEach((listener) => {
            try {
                listener(frozen);
            }
            catch (e) {
                console.error('Error executing GlobalSettingsService subscriber listener:', e);
            }
        });
    }
}
exports.GlobalSettingsService = GlobalSettingsService;
//# sourceMappingURL=globalSettingsService.js.map