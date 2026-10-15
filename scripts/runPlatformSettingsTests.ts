import { PlatformSettingsValidator } from '../functions/src/settings/platformSettingsValidator';
import { PlatformSettingsService } from '../functions/src/settings/platformSettingsService';
import type { IPlatformSettingsRepository } from '../functions/src/settings/platformSettingsRepository';
import type { PlatformGlobalSettings } from '../src/types/settings';
import { DEFAULT_GLOBAL_SETTINGS } from '../src/services/globalSettingsService';
import { AdminRole, AdminPermission, type AdminUser, hasAdminPermission } from '../src/types/admin';

class InMemoryPlatformSettingsRepo implements IPlatformSettingsRepository {
  public data: PlatformGlobalSettings | null = null;

  async get(): Promise<PlatformGlobalSettings | null> {
    if (!this.data) return null;
    const validation = PlatformSettingsValidator.validateCompleteSettings(this.data);
    if (!validation.isValid) {
      throw new Error(`MALFORMED_SETTINGS_DOCUMENT: ${validation.errors.join('; ')}`);
    }
    return JSON.parse(JSON.stringify(this.data));
  }

  async save(settings: PlatformGlobalSettings): Promise<PlatformGlobalSettings> {
    const validation = PlatformSettingsValidator.validateCompleteSettings(settings);
    if (!validation.isValid) {
      throw new Error(`VALIDATION_ERROR: ${validation.errors.join('; ')}`);
    }
    this.data = JSON.parse(JSON.stringify(settings));
    return this.data!;
  }
}

async function runTests() {
  console.log('--- Running Platform Settings Unit 1 Foundation Tests ---');
  let passed = 0;

  const ownerAdmin: AdminUser = {
    id: 'admin_owner_01',
    name: 'Platform Owner',
    email: 'owner@promiseofplanet.org',
    role: AdminRole.Owner,
    isActive: true,
  };

  const editorAdmin: AdminUser = {
    id: 'admin_editor_01',
    name: 'Content Editor',
    email: 'editor@promiseofplanet.org',
    role: AdminRole.ContentEditor,
    isActive: true,
  };

  // Test 1: Verify DEFAULT_GLOBAL_SETTINGS invariants
  console.log('1. Checking DEFAULT_GLOBAL_SETTINGS invariants...');
  if (DEFAULT_GLOBAL_SETTINGS.channels.youtube.url !== 'https://www.youtube.com/@PromiseOfPlanet') {
    throw new Error('Default YouTube URL does not match canonical verified URL.');
  }
  if (!DEFAULT_GLOBAL_SETTINGS.channels.youtube.enabled) {
    throw new Error('Default YouTube channel should be enabled.');
  }
  if (DEFAULT_GLOBAL_SETTINGS.channels.facebook.url !== 'https://www.facebook.com/PromiseOfPlanet/') {
    throw new Error('Default Facebook URL does not match verified URL.');
  }
  if (DEFAULT_GLOBAL_SETTINGS.channels.instagram.enabled || DEFAULT_GLOBAL_SETTINGS.channels.whatsapp.enabled) {
    throw new Error('Unverified social channels (Instagram, WhatsApp) must be disabled by default.');
  }
  if (DEFAULT_GLOBAL_SETTINGS.contact.contactEmail !== '' || DEFAULT_GLOBAL_SETTINGS.contact.pressEmail !== '') {
    throw new Error('Contact emails must be empty by default.');
  }
  if (DEFAULT_GLOBAL_SETTINGS.legal.privacy.published || DEFAULT_GLOBAL_SETTINGS.legal.terms.published) {
    throw new Error('Legal policies must be unpublished by default.');
  }
  if (DEFAULT_GLOBAL_SETTINGS.identity.logoUrl !== null) {
    throw new Error('Default logoUrl must be null to trigger fallback.');
  }
  if (DEFAULT_GLOBAL_SETTINGS.behavior.climateClockEnabled !== true || DEFAULT_GLOBAL_SETTINGS.behavior.defaultLanguage !== 'ar') {
    throw new Error('Behavior default values must preserve climateClockEnabled: true and defaultLanguage: "ar".');
  }
  passed++;
  console.log('✓ Invariants verified.');

  // Test 2: Validation of default settings
  console.log('2. Validating default settings complete document...');
  const defaultValidation = PlatformSettingsValidator.validateCompleteSettings(DEFAULT_GLOBAL_SETTINGS);
  if (!defaultValidation.isValid) {
    throw new Error(`Default settings failed validation: ${defaultValidation.errors.join(', ')}`);
  }
  passed++;
  console.log('✓ Default settings pass complete validation.');

  // Test 3: Validation rejects XSS / scripts
  console.log('3. Checking XSS / script payload rejection...');
  const xssCheck = PlatformSettingsValidator.validateMutationInput({
    identity: {
      platformNameAr: 'وعد الكوكب <script>alert("xss")</script>',
    },
  });
  if (xssCheck.isValid) {
    throw new Error('Validator should reject script tags in text fields.');
  }
  passed++;
  console.log('✓ XSS payloads rejected.');

  // Test 4: Validation requires URL when channel enabled
  console.log('4. Checking channel validation rules...');
  const channelCheck = PlatformSettingsValidator.validateMutationInput({
    channels: {
      instagram: {
        enabled: true,
        url: '',
      },
    },
  });
  // Complete doc validation test
  const testDoc = JSON.parse(JSON.stringify(DEFAULT_GLOBAL_SETTINGS));
  testDoc.channels.instagram = { enabled: true, url: '' };
  const completeChannelCheck = PlatformSettingsValidator.validateCompleteSettings(testDoc);
  if (completeChannelCheck.isValid) {
    throw new Error('Validator should reject enabled channel with empty URL.');
  }
  passed++;
  console.log('✓ Channel validation rules enforced.');

  // Test 5: Validation requires content when legal policy published
  console.log('5. Checking legal policy publication rules...');
  testDoc.channels.instagram = { enabled: false, url: '' };
  testDoc.legal.privacy.published = true;
  testDoc.legal.privacy.contentAr = '';
  testDoc.legal.privacy.contentEn = '';
  const legalCheck = PlatformSettingsValidator.validateCompleteSettings(testDoc);
  if (legalCheck.isValid) {
    throw new Error('Validator should reject published legal document with empty content.');
  }
  passed++;
  console.log('✓ Legal document publication rules enforced.');

  // Test 6: Repository & Service initialization semantics
  console.log('6. Checking Service initialization semantics...');
  const repo = new InMemoryPlatformSettingsRepo();
  const service = new PlatformSettingsService(repo);

  const uninitialized = await service.getSettings();
  if (uninitialized !== null) {
    throw new Error('Initial state before explicit initialization should be null.');
  }

  const initResult = await service.initializeFromDefaults(ownerAdmin);
  if (!initResult.initialized || initResult.settings.updatedBy !== ownerAdmin.id) {
    throw new Error('initializeFromDefaults should succeed and set updatedBy to admin.');
  }

  // Second initialization attempt must NOT overwrite
  const secondInit = await service.initializeFromDefaults({ ...ownerAdmin, id: 'another_admin' });
  if (secondInit.initialized) {
    throw new Error('initializeFromDefaults must not re-initialize or overwrite existing document.');
  }
  if (secondInit.settings.updatedBy !== ownerAdmin.id) {
    throw new Error('Existing settings should retain original updatedBy.');
  }
  passed++;
  console.log('✓ Initialization semantics verified.');

  // Test 7: Update and change diffing with no-op protection
  console.log('7. Checking update and change calculation...');
  const updateRes = await service.updateSettings(
    {
      identity: {
        taglineEn: 'Updated Environmental Media Platform',
      },
    },
    ownerAdmin
  );
  if (updateRes.changes.length !== 1 || updateRes.changes[0].field !== 'identity.taglineEn') {
    throw new Error(`Expected exactly 1 change for identity.taglineEn, got ${JSON.stringify(updateRes.changes)}`);
  }
  if (updateRes.settings.identity.taglineEn !== 'Updated Environmental Media Platform') {
    throw new Error('Settings not updated correctly.');
  }

  // No-op update
  const noOpRes = await service.updateSettings(
    {
      identity: {
        taglineEn: 'Updated Environmental Media Platform',
      },
    },
    ownerAdmin
  );
  if (noOpRes.changes.length !== 0) {
    throw new Error(`Expected 0 changes for identical update, got ${noOpRes.changes.length}`);
  }
  passed++;
  console.log('✓ Updates, diffs, and no-op protection verified.');

  // Test 8: RBAC authorization check
  console.log('8. Checking RBAC ManageSettings permission...');
  const ownerCanManage = hasAdminPermission(ownerAdmin, AdminPermission.ManageSettings);
  if (!ownerCanManage) {
    throw new Error('Owner must have AdminPermission.ManageSettings.');
  }
  const editorCanManage = hasAdminPermission(editorAdmin, AdminPermission.ManageSettings);
  if (editorCanManage) {
    throw new Error('ContentEditor must NOT have AdminPermission.ManageSettings.');
  }
  passed++;
  console.log('✓ RBAC authorization rules verified.');

  console.log(`\n========================================`);
  console.log(`ALL ${passed} SETTINGS FOUNDATION TESTS PASSED`);
  console.log(`========================================\n`);
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
