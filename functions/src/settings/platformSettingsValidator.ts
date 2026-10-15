import type {
  PlatformGlobalSettings,
  PlatformIdentitySettings,
  PlatformInstitutionalSettings,
  PlatformChannelsSettings,
  PlatformContactSettings,
  PlatformFooterSettings,
  PlatformLegalSettings,
  PlatformMetadataSettings,
  PlatformBehaviorSettings,
} from '../../../src/types/settings';

const SCRIPT_REGEX = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>|<iframe\b|javascript:|onload=|onerror=/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidUrl(val: string): boolean {
  if (typeof val !== 'string' || val.trim() === '') return false;
  try {
    const url = new URL(val);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidEmail(val: string): boolean {
  if (typeof val !== 'string') return false;
  return EMAIL_REGEX.test(val.trim());
}

function containsUnsafePayload(val: string): boolean {
  return SCRIPT_REGEX.test(val);
}

export class PlatformSettingsValidator {
  private static readonly ALLOWED_TOP_LEVEL_KEYS = new Set<string>([
    'identity',
    'institutional',
    'channels',
    'contact',
    'footer',
    'legal',
    'metadata',
    'behavior',
    'updatedAt',
    'updatedBy',
    'climateClockEnabled',
    'defaultLanguage',
  ]);

  /**
   * Validates a complete settings document (such as retrieved from Firestore).
   */
  public static validateCompleteSettings(doc: any): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      return { isValid: false, errors: ['Platform settings document must be a non-null object.'] };
    }

    for (const key of Object.keys(doc)) {
      if (!this.ALLOWED_TOP_LEVEL_KEYS.has(key)) {
        errors.push(`Unknown top-level property '${key}' is rejected.`);
      }
    }

    // 1. Identity
    if (!doc.identity || typeof doc.identity !== 'object') {
      errors.push('Section "identity" is required and must be an object.');
    } else {
      const id = doc.identity;
      const strFields = [
        'platformNameAr',
        'platformNameEn',
        'taglineAr',
        'taglineEn',
        'subtitleAr',
        'subtitleEn',
        'descriptionAr',
        'descriptionEn',
      ];
      for (const f of strFields) {
        if (typeof id[f] !== 'string') {
          errors.push(`identity.${f} must be a string.`);
        } else if (containsUnsafePayload(id[f])) {
          errors.push(`identity.${f} contains disallowed script or HTML payloads.`);
        }
      }

      if (id.logoUrl !== null && id.logoUrl !== undefined) {
        if (typeof id.logoUrl !== 'string' || (id.logoUrl.trim() !== '' && !isValidUrl(id.logoUrl))) {
          errors.push('identity.logoUrl must be null, empty, or a valid http/https URL.');
        }
      }
      if (id.logoStoragePath !== null && id.logoStoragePath !== undefined) {
        if (typeof id.logoStoragePath !== 'string' || 
            !id.logoStoragePath.startsWith('branding/platform-logo/') || 
            (id.logoStoragePath.includes('..') || id.logoStoragePath.includes('\\')) ||
            !(id.logoStoragePath.endsWith('.png') || id.logoStoragePath.endsWith('.webp'))) {
          errors.push('identity.logoStoragePath must be null or a valid branding storage path (ending in .png or .webp).');
        }
      }
      if (id.logoDarkUrl !== null && id.logoDarkUrl !== undefined) {
        if (typeof id.logoDarkUrl !== 'string' || (id.logoDarkUrl.trim() !== '' && !isValidUrl(id.logoDarkUrl))) {
          errors.push('identity.logoDarkUrl must be null, empty, or a valid http/https URL.');
        }
      }
      if (id.faviconUrl !== null && id.faviconUrl !== undefined) {
        if (typeof id.faviconUrl !== 'string' || (id.faviconUrl.trim() !== '' && !isValidUrl(id.faviconUrl))) {
          errors.push('identity.faviconUrl must be null, empty, or a valid http/https URL.');
        }
      }
    }

    // 2. Institutional
    if (!doc.institutional || typeof doc.institutional !== 'object') {
      errors.push('Section "institutional" is required and must be an object.');
    } else {
      const inst = doc.institutional;
      const instFields = [
        'aboutIntroAr',
        'aboutIntroEn',
        'visionAr',
        'visionEn',
        'missionAr',
        'missionEn',
        'sudanContextAr',
        'sudanContextEn',
        'editorialPositioningAr',
        'editorialPositioningEn',
        'conferenceCoverageStatementAr',
        'conferenceCoverageStatementEn',
      ];
      for (const f of instFields) {
        if (typeof inst[f] !== 'string') {
          errors.push(`institutional.${f} must be a string.`);
        } else if (containsUnsafePayload(inst[f])) {
          errors.push(`institutional.${f} contains disallowed script or HTML payloads.`);
        }
      }
    }

    // 3. Channels
    if (!doc.channels || typeof doc.channels !== 'object') {
      errors.push('Section "channels" is required and must be an object.');
    } else {
      const ch = doc.channels;
      const channelNames = ['youtube', 'facebook', 'instagram', 'whatsapp'];
      for (const c of channelNames) {
        if (!ch[c] || typeof ch[c] !== 'object') {
          errors.push(`channels.${c} must be an object.`);
        } else {
          if (typeof ch[c].enabled !== 'boolean') {
            errors.push(`channels.${c}.enabled must be a boolean.`);
          }
          if (typeof ch[c].url !== 'string') {
            errors.push(`channels.${c}.url must be a string.`);
          } else {
            const urlStr = ch[c].url.trim();
            if (ch[c].enabled && urlStr === '') {
              errors.push(`channels.${c}.url cannot be empty when channel is enabled.`);
            }
            if (urlStr !== '' && !isValidUrl(urlStr)) {
              errors.push(`channels.${c}.url must be a valid http/https URL.`);
            }
          }
        }
      }
    }

    // 4. Contact
    if (!doc.contact || typeof doc.contact !== 'object') {
      errors.push('Section "contact" is required and must be an object.');
    } else {
      const ct = doc.contact;
      const contactStrFields = ['phone', 'addressAr', 'addressEn', 'accreditationNoticeAr', 'accreditationNoticeEn'];
      for (const f of contactStrFields) {
        if (typeof ct[f] !== 'string') {
          errors.push(`contact.${f} must be a string.`);
        } else if (containsUnsafePayload(ct[f])) {
          errors.push(`contact.${f} contains disallowed script or HTML payloads.`);
        }
      }

      if (typeof ct.contactEmail !== 'string') {
        errors.push('contact.contactEmail must be a string.');
      } else if (ct.contactEmail.trim() !== '' && !isValidEmail(ct.contactEmail)) {
        errors.push('contact.contactEmail must be empty or a valid email address.');
      }

      if (typeof ct.pressEmail !== 'string') {
        errors.push('contact.pressEmail must be a string.');
      } else if (ct.pressEmail.trim() !== '' && !isValidEmail(ct.pressEmail)) {
        errors.push('contact.pressEmail must be empty or a valid email address.');
      }
    }

    // 5. Footer
    if (!doc.footer || typeof doc.footer !== 'object') {
      errors.push('Section "footer" is required and must be an object.');
    } else {
      const ft = doc.footer;
      const footerFields = ['descriptionAr', 'descriptionEn', 'rightsTextAr', 'rightsTextEn'];
      for (const f of footerFields) {
        if (typeof ft[f] !== 'string') {
          errors.push(`footer.${f} must be a string.`);
        } else if (containsUnsafePayload(ft[f])) {
          errors.push(`footer.${f} contains disallowed script or HTML payloads.`);
        }
      }
    }

    // 6. Legal
    if (!doc.legal || typeof doc.legal !== 'object') {
      errors.push('Section "legal" is required and must be an object.');
    } else {
      const lg = doc.legal;
      const legalDocs = ['privacy', 'terms'];
      for (const docKey of legalDocs) {
        const item = lg[docKey];
        if (!item || typeof item !== 'object') {
          errors.push(`legal.${docKey} must be an object.`);
        } else {
          if (typeof item.titleAr !== 'string' || typeof item.titleEn !== 'string') {
            errors.push(`legal.${docKey} titles must be strings.`);
          }
          if (typeof item.contentAr !== 'string' || typeof item.contentEn !== 'string') {
            errors.push(`legal.${docKey} contents must be strings.`);
          } else {
            if (containsUnsafePayload(item.contentAr) || containsUnsafePayload(item.contentEn)) {
              errors.push(`legal.${docKey} contains disallowed script or HTML payloads.`);
            }
          }
          if (typeof item.published !== 'boolean') {
            errors.push(`legal.${docKey}.published must be a boolean.`);
          } else if (item.published) {
            if (item.contentAr.trim() === '' || item.contentEn.trim() === '') {
              errors.push(`legal.${docKey} cannot be published with empty content in Arabic or English.`);
            }
          }
          if (item.effectiveDate !== null && item.effectiveDate !== undefined) {
            if (typeof item.effectiveDate !== 'string' || isNaN(Date.parse(item.effectiveDate))) {
              errors.push(`legal.${docKey}.effectiveDate must be null or a valid ISO date string.`);
            }
          }
        }
      }
    }

    // 7. Metadata
    if (!doc.metadata || typeof doc.metadata !== 'object') {
      errors.push('Section "metadata" is required and must be an object.');
    } else {
      const md = doc.metadata;
      const metaFields = ['siteTitleAr', 'siteTitleEn', 'metaDescriptionAr', 'metaDescriptionEn'];
      for (const f of metaFields) {
        if (typeof md[f] !== 'string') {
          errors.push(`metadata.${f} must be a string.`);
        } else if (containsUnsafePayload(md[f])) {
          errors.push(`metadata.${f} contains disallowed script or HTML payloads.`);
        }
      }
    }

    // 8. Behavior
    if (!doc.behavior || typeof doc.behavior !== 'object') {
      errors.push('Section "behavior" is required and must be an object.');
    } else {
      const bh = doc.behavior;
      if (typeof bh.climateClockEnabled !== 'boolean') {
        errors.push('behavior.climateClockEnabled must be a boolean.');
      }
      if (bh.defaultLanguage !== 'ar' && bh.defaultLanguage !== 'en') {
        errors.push('behavior.defaultLanguage must be either "ar" or "en".');
      }
    }

    // 9. Server Stamps
    if (typeof doc.updatedAt !== 'string' || isNaN(Date.parse(doc.updatedAt))) {
      errors.push('updatedAt must be a valid ISO timestamp.');
    }
    if (typeof doc.updatedBy !== 'string' || doc.updatedBy.trim() === '') {
      errors.push('updatedBy must be a non-empty string.');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validates partial update mutation input.
   */
  public static validateMutationInput(input: any): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { isValid: false, errors: ['Mutation input must be a valid non-null object.'] };
    }

    for (const key of Object.keys(input)) {
      if (!this.ALLOWED_TOP_LEVEL_KEYS.has(key)) {
        errors.push(`Unknown update key '${key}' is rejected.`);
      }
    }

    // Identity validation
    if (input.identity) {
      if (typeof input.identity !== 'object') {
        errors.push('identity must be an object.');
      } else {
        const id = input.identity;
        for (const [k, v] of Object.entries(id)) {
          if (['logoUrl', 'logoDarkUrl', 'faviconUrl'].includes(k)) {
            if (v !== null && v !== undefined && (typeof v !== 'string' || (v.trim() !== '' && !isValidUrl(v)))) {
              errors.push(`identity.${k} must be null, empty, or a valid http/https URL.`);
            }
          } else if (typeof v !== 'string') {
            errors.push(`identity.${k} must be a string.`);
          } else if (containsUnsafePayload(v)) {
            errors.push(`identity.${k} contains disallowed script or HTML payloads.`);
          }
        }
      }
    }

    // Channels validation
    if (input.channels) {
      if (typeof input.channels !== 'object') {
        errors.push('channels must be an object.');
      } else {
        for (const [k, v] of Object.entries(input.channels)) {
          if (!['youtube', 'facebook', 'instagram', 'whatsapp'].includes(k)) {
            errors.push(`Unknown channel '${k}'.`);
          } else if (v && typeof v === 'object') {
            const ch = v as Record<string, any>;
            if ('enabled' in ch && typeof ch.enabled !== 'boolean') {
              errors.push(`channels.${k}.enabled must be a boolean.`);
            }
            if ('url' in ch) {
              if (typeof ch.url !== 'string') {
                errors.push(`channels.${k}.url must be a string.`);
              } else if (ch.url.trim() !== '' && !isValidUrl(ch.url.trim())) {
                errors.push(`channels.${k}.url must be a valid http/https URL.`);
              }
            }
          }
        }
      }
    }

    // Contact validation
    if (input.contact) {
      if (typeof input.contact !== 'object') {
        errors.push('contact must be an object.');
      } else {
        const ct = input.contact;
        if ('contactEmail' in ct && ct.contactEmail !== '' && !isValidEmail(ct.contactEmail)) {
          errors.push('contact.contactEmail must be a valid email format.');
        }
        if ('pressEmail' in ct && ct.pressEmail !== '' && !isValidEmail(ct.pressEmail)) {
          errors.push('contact.pressEmail must be a valid email format.');
        }
      }
    }

    // Behavior validation
    if (input.behavior) {
      if (typeof input.behavior !== 'object') {
        errors.push('behavior must be an object.');
      } else {
        const bh = input.behavior;
        if ('climateClockEnabled' in bh && typeof bh.climateClockEnabled !== 'boolean') {
          errors.push('behavior.climateClockEnabled must be a boolean.');
        }
        if ('defaultLanguage' in bh && bh.defaultLanguage !== 'ar' && bh.defaultLanguage !== 'en') {
          errors.push('behavior.defaultLanguage must be either "ar" or "en".');
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
