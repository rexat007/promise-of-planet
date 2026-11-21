/**
 * Standalone test runner for News Functional Tests.
 * Polyfills in-memory storage for headless Node.js execution.
 */

// Isolate test process environment BEFORE any module imports so Firebase remains unconfigured
if (typeof process !== 'undefined' && process.env) {
  delete process.env.VITE_FIREBASE_API_KEY;
  delete process.env.VITE_FIREBASE_PROJECT_ID;
}

// Headless polyfill for localStorage
if (typeof globalThis.localStorage === 'undefined') {
  const memoryStore = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => memoryStore.get(k) || null,
    setItem: (k: string, v: string) => memoryStore.set(k, String(v)),
    removeItem: (k: string) => memoryStore.delete(k),
    clear: () => memoryStore.clear(),
  };
}

if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = {
    location: {
      origin: 'https://promiseofplanet.org',
    },
  };
}

import Module, { createRequire } from 'node:module';

class FallbackHttpsError extends Error {
  readonly code: string;
  readonly details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpsError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const moduleWithLoad = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(
  request: string,
  parent: unknown,
  isMain: boolean
): unknown {
  try {
    return originalModuleLoad.call(this, request, parent, isMain);
  } catch (err: unknown) {
    if (request === 'firebase-functions/v2/https') {
      return {
        HttpsError: FallbackHttpsError,
        onCall: (_opts: unknown, handler: unknown) => handler,
        onRequest: (_opts: unknown, handler: unknown) => handler,
      };
    }
    if (request === 'firebase-admin/firestore') {
      return {
        getFirestore: () => {
          throw new Error('Uninjected live getFirestore() must not be called in headless tests.');
        },
      };
    }
    if (request === 'firebase-admin/app') {
      return { getApps: () => [], initializeApp: () => ({ name: '[DEFAULT]' }) };
    }
    if (request === 'firebase-admin/auth') {
      return { getAuth: () => ({}) };
    }
    throw err;
  }
};

const require = createRequire(import.meta.url);

async function registerBunFirebaseMocks(): Promise<void> {
  if (typeof (globalThis as unknown as { Bun?: unknown }).Bun === 'undefined') {
    return;
  }
  const bunTestSpec: string = 'bun:test';
  const bunTest = (await import(bunTestSpec)) as {
    mock: { module: (spec: string, factory: () => Record<string, unknown>) => void };
  };
  bunTest.mock.module('firebase-functions/v2/https', () => ({
    HttpsError: FallbackHttpsError,
    onCall: (_opts: unknown, handler: unknown) => handler,
    onRequest: (_opts: unknown, handler: unknown) => handler,
  }));
  bunTest.mock.module('firebase-functions/params', () => ({
    defineSecret: (name: string) => ({ name, value: () => process.env[name] || '' }),
  }));
  bunTest.mock.module('firebase-admin/app', () => ({
    getApps: () => [],
    initializeApp: () => ({ name: '[DEFAULT]' }),
  }));
  bunTest.mock.module('firebase-admin/auth', () => ({
    getAuth: () => ({}),
  }));
  bunTest.mock.module('firebase-admin/firestore', () => ({
    getFirestore: () => {
      throw new Error('Uninjected live getFirestore() must not be called in headless tests.');
    },
  }));
  bunTest.mock.module('firebase-admin/storage', () => ({
    getStorage: () => {
      throw new Error('Uninjected live getStorage() must not be called in headless tests.');
    },
  }));
}

interface CoordinatedCheckResult {
  readonly id: string;
  readonly name: string;
  readonly passed: boolean;
  readonly details: string;
}

async function runCoordinatedNewsEditorialVerification(): Promise<CoordinatedCheckResult[]> {
  await registerBunFirebaseMocks();
  const results: CoordinatedCheckResult[] = [];

  const { InMemoryNewsRepository } = await import('../functions/src/news/inMemoryNewsRepository');
  const {
    NewsApplicationService,
    NewsOperationError,
    EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE,
  } = await import('../functions/src/news/newsApplicationService');
  const { executeManageNewsRequest } = await import('../functions/src/news/newsAdminHandlers');
  const { InMemoryCommunityRepository } = await import('../functions/src/community/inMemoryCommunityRepository');
  const { AdminRole } = await import('../functions/src/shared/adminContract');
  const { WorkflowState } = await import('../functions/src/shared/workflowContract');
  const { formatNewsEditorialErrorMessage } = await import('../src/services/newsAdminClient');

  const { InMemoryEditorialImageAssetRepository } = await import(
    '../functions/src/news/inMemoryEditorialImageAssetRepository'
  );
  const {
    buildEditorialImageVariantStoragePath,
    createEditorialImageAssetRecord,
  } = await import('../functions/src/shared/editorialImageAssetContract');

  const nowIso = '2026-11-21T10:00:00.000Z';
  const coverAssetId = 'asset_11111111111111111111111111111111';
  const inlineAssetId = 'asset_22222222222222222222222222222222';
  const unapprovedAssetId = 'asset_33333333333333333333333333333333';

  const makeAssetRecord = (
    assetId: string,
    opts: { rightsStatus: 'Approved' | 'PendingReview' }
  ) => {
    const variantKeys = ['thumbnail', 'card', 'article_inline', 'article_cover', 'original_processed'] as const;
    const variants: Record<string, any> = {};
    for (const key of variantKeys) {
      variants[key] = {
        variantKey: key,
        storagePath: buildEditorialImageVariantStoragePath(assetId, key, 'image/webp'),
        mimeType: 'image/webp',
        width: 800,
        height: 600,
        sizeBytes: 24576,
        sha256Checksum: 'a'.repeat(64),
      };
    }
    const base = createEditorialImageAssetRecord({
      assetId,
      createdByUid: 'uid_owner',
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
      origin: 'news_article',
      originalFilename: `${assetId}.webp`,
      mimeType: 'image/webp',
      originalSizeBytes: 49152,
      originalWidth: 1600,
      originalHeight: 1200,
      sha256Checksum: 'b'.repeat(64),
      variants,
      altAr: 'صورة تحريرية موثقة',
      altEn: 'Verified editorial photo',
    });
    if (opts.rightsStatus === 'Approved') {
      return {
        ...base,
        rights: {
          ...base.rights,
          status: 'Approved' as const,
          licenseType: 'OriginalWork' as const,
          rightsHolder: 'Promise of Planet Editorial',
          sourceAttributionAr: 'فريق وعد الكوكب',
          sourceAttributionEn: 'Promise of Planet Team',
          evidenceRefs: ['editorial-record-2026-001'],
          usageScope: { scopeType: 'GeneralEditorial' as const },
          reviewedByUid: 'uid_owner',
          reviewedAtIso: nowIso,
        },
      };
    }
    return base;
  };

  const assetStore = new Map<string, any>([
    [coverAssetId, makeAssetRecord(coverAssetId, { rightsStatus: 'Approved' })],
    [inlineAssetId, makeAssetRecord(inlineAssetId, { rightsStatus: 'Approved' })],
    [unapprovedAssetId, makeAssetRecord(unapprovedAssetId, { rightsStatus: 'PendingReview' })],
  ]);
  const fakeAssetRepo = {
    getById: async (id: string) => {
      const found = assetStore.get(id);
      return found
        ? { ok: true, status: 'FOUND', asset: found }
        : { ok: true, status: 'NOT_FOUND', asset: null };
    },
  } as any;
  const fakeMediaRepo = {
    getVideoById: async () => null,
  };

  const adminsByUid = new Map<string, any>([
    ['uid_owner', { id: 'uid_owner', name: 'Owner', email: 'owner@pop.org', role: AdminRole.Owner, isActive: true }],
    ['uid_mod', { id: 'uid_mod', name: 'Citizen Mod', email: 'mod@pop.org', role: AdminRole.CitizenModerator, isActive: true }],
    ['uid_editor', { id: 'uid_editor', name: 'Editor', email: 'editor@pop.org', role: AdminRole.ContentEditor, isActive: true }],
    ['uid_trainer', { id: 'uid_trainer', name: 'Trainer', email: 'trainer@pop.org', role: AdminRole.Trainer, isActive: true }],
    ['uid_curator', { id: 'uid_curator', name: 'Curator', email: 'curator@pop.org', role: AdminRole.LibraryCurator, isActive: true }],
    ['uid_viewer', { id: 'uid_viewer', name: 'Viewer', email: 'viewer@pop.org', role: AdminRole.Viewer, isActive: true }],
    ['uid_ai', { id: 'uid_ai', name: 'AI', email: 'ai@pop.org', role: AdminRole.AIAssistant, isActive: true }],
  ]);
  const fakeAdminRepo = {
    getAdminByUid: async (uid: string) => adminsByUid.get(uid) ?? null,
    saveAdmin: async (a: any) => a,
    listAdmins: async () => Array.from(adminsByUid.values()),
  };

  const newsRepo = new InMemoryNewsRepository();
  const communityRepo = new InMemoryCommunityRepository();
  const newsService = new NewsApplicationService(newsRepo, fakeAssetRepo, fakeMediaRepo, communityRepo);

  const baseArticlePayload = {
    titleAr: 'خبر بيئي موحد لاختبار حقوق صورة الغلاف',
    titleEn: 'Unified Environmental News for Cover Rights Verification',
    summaryAr: 'ملخص تحريري معتمد لاختبار الربط والتدقيق.',
    summaryEn: 'Editorial summary for cover asset binding and rights verification.',
    contentAr: 'نص المقال الكامل باللغة العربية لاختبار النشر.',
    contentEn: 'Full English article body for publication verification.',
    category: 'Climate',
    authorNameAr: 'هيئة التحرير',
    authorNameEn: 'Editorial Desk',
  };

  // N-COORD-01: Managed featuredImage assetId bound on draft save & enforced on Publish
  try {
    // Unapproved cover assetId CAN be saved on Draft (staged asset exists), but missing assetId MUST be rejected
    let missingCoverRejected = false;
    try {
      await newsService.createDraft(
        { ...baseArticlePayload, featuredImage: 'asset_99999999999999999999999999999999' },
        { uid: 'uid_owner', name: 'Owner', role: AdminRole.Owner }
      );
    } catch (err: any) {
      missingCoverRejected =
        err instanceof NewsOperationError &&
        err.details?.assetId === 'asset_99999999999999999999999999999999' &&
        Array.isArray(err.details?.locations) &&
        err.details.locations.includes('cover');
    }

    // Create draft with unapproved cover asset -> should save draft, then block publication with cover location
    const unapprovedDraft = await newsService.createDraft(
      { ...baseArticlePayload, featuredImage: unapprovedAssetId },
      { uid: 'uid_owner', name: 'Owner', role: AdminRole.Owner }
    );
    await newsService.transitionWorkflow(
      unapprovedDraft.id,
      WorkflowState.InReview,
      { uid: 'uid_owner', name: 'Owner', role: AdminRole.Owner },
      'To review'
    );
    await newsService.transitionWorkflow(
      unapprovedDraft.id,
      WorkflowState.Approved,
      { uid: 'uid_owner', name: 'Owner', role: AdminRole.Owner },
      'Approved text'
    );

    let unapprovedCoverBlockedAtPublish = false;
    try {
      await executeManageNewsRequest(
        {
          auth: { uid: 'uid_owner' },
          data: {
            action: 'transitionWorkflow',
            id: unapprovedDraft.id,
            targetState: WorkflowState.Published,
            note: 'Attempt publish with unapproved cover',
          },
        },
        fakeAdminRepo,
        newsService,
        undefined,
        fakeAssetRepo,
        communityRepo
      );
    } catch (err: any) {
      unapprovedCoverBlockedAtPublish =
        err?.code === 'failed-precondition' &&
        err?.details?.reasonCode === EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE &&
        err?.details?.assetId === unapprovedAssetId &&
        Array.isArray(err?.details?.locations) &&
        err.details.locations.includes('cover') &&
        !JSON.stringify(err?.details ?? {}).includes('editorial/staging/') &&
        !String(err?.message ?? '').includes('editorial/staging/');
    }

    // Approved cover assetId + inline assetId -> publishes cleanly; revoking cover later blocks re-publish
    const approvedDraft = await newsService.createDraft(
      {
        ...baseArticlePayload,
        featuredImage: coverAssetId,
        richBodyAr: {
          schemaVersion: 2,
          doc: {
            type: 'doc',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'نص المقال الكامل باللغة العربية لاختبار النشر.' }] },
              {
                type: 'editorialImage',
                attrs: {
                  assetId: inlineAssetId,
                  altAr: 'صورة داخلية',
                  captionAr: 'توضيح',
                  width: '50%',
                  layout: 'block-center',
                },
              },
            ],
          },
        } as any,
      },
      { uid: 'uid_owner', name: 'Owner', role: AdminRole.Owner }
    );
    await newsService.transitionWorkflow(
      approvedDraft.id,
      WorkflowState.InReview,
      { uid: 'uid_owner', name: 'Owner', role: AdminRole.Owner },
      'Review'
    );
    await newsService.transitionWorkflow(
      approvedDraft.id,
      WorkflowState.Approved,
      { uid: 'uid_owner', name: 'Owner', role: AdminRole.Owner },
      'Approve'
    );
    const publishedArticle = await newsService.transitionWorkflow(
      approvedDraft.id,
      WorkflowState.Published,
      { uid: 'uid_owner', name: 'Owner', role: AdminRole.Owner },
      'Publish approved cover+inline'
    );

    // Also confirm legacy safe HTTPS cover URL remains backward-compatible without asset registry entry
    const legacyDraft = await newsService.createDraft(
      { ...baseArticlePayload, featuredImage: 'https://cdn.promiseofplanet.org/legacy-cover.jpg' },
      { uid: 'uid_owner', name: 'Owner', role: AdminRole.Owner }
    );

    const passed =
      missingCoverRejected &&
      unapprovedCoverBlockedAtPublish &&
      publishedArticle.workflowState === WorkflowState.Published &&
      publishedArticle.featuredImage === coverAssetId &&
      legacyDraft.featuredImage === 'https://cdn.promiseofplanet.org/legacy-cover.jpg';

    results.push({
      id: 'N-COORD-01',
      name: 'Managed featuredImage assetId binding, rights-eligibility publication gate, and legacy HTTPS compatibility',
      passed,
      details: passed
        ? 'Missing cover assetId rejected with cover location; unapproved cover blocked at publish with failed-precondition + redacted details; approved cover+inline published; legacy HTTPS URL preserved.'
        : `Failed assertions: missingCoverRejected=${missingCoverRejected}, unapprovedCoverBlockedAtPublish=${unapprovedCoverBlockedAtPublish}, pubState=${publishedArticle.workflowState}`,
    });
  } catch (err: any) {
    results.push({
      id: 'N-COORD-01',
      name: 'Managed featuredImage assetId binding, rights-eligibility publication gate, and legacy HTTPS compatibility',
      passed: false,
      details: `Unexpected error: ${err?.message || err}`,
    });
  }

  // N-COORD-02: Structured HttpsError mapping + path redaction + AR/EN client error formatting
  try {
    const simulatedErr = {
      code: 'failed-precondition',
      message: 'EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE: blocked',
      details: {
        reasonCode: EDITORIAL_IMAGE_PUBLICATION_RIGHTS_NOT_ELIGIBLE_CODE,
        subReasonCode: 'RIGHTS_STATUS_NOT_APPROVED',
        assetId: unapprovedAssetId,
        locations: ['cover', 'inline_ar'],
      },
    };
    const arMsg = formatNewsEditorialErrorMessage(simulatedErr, true);
    const enMsg = formatNewsEditorialErrorMessage(simulatedErr, false);

    // Invalid transition maps to failed-precondition (not internal)
    const draftForTransition = await newsService.createDraft(baseArticlePayload, {
      uid: 'uid_owner',
      name: 'Owner',
      role: AdminRole.Owner,
    });
    let invalidTransitionCode = '';
    try {
      await executeManageNewsRequest(
        {
          auth: { uid: 'uid_owner' },
          data: {
            action: 'transitionWorkflow',
            id: draftForTransition.id,
            targetState: WorkflowState.Published,
            note: 'Skip review & approval',
          },
        },
        fakeAdminRepo,
        newsService,
        undefined,
        fakeAssetRepo,
        communityRepo
      );
    } catch (err: any) {
      invalidTransitionCode = String(err?.code || '');
    }

    const passed =
      arMsg.includes(unapprovedAssetId) &&
      arMsg.includes('صورة الغلاف') &&
      arMsg.includes('النص العربي') &&
      enMsg.includes(unapprovedAssetId) &&
      enMsg.includes('cover image') &&
      enMsg.includes('Arabic inline image') &&
      (invalidTransitionCode === 'failed-precondition' || invalidTransitionCode === 'invalid-argument') &&
      invalidTransitionCode !== 'internal';

    results.push({
      id: 'N-COORD-02',
      name: 'Structured NewsOperationError -> HttpsError mapping & bilingual editorial error formatter',
      passed,
      details: passed
        ? 'AR/EN formatNewsEditorialErrorMessage surfaces exact assetId and cover/inline_ar locations; invalid transitions map to failed-precondition.'
        : `arMsg="${arMsg}" | enMsg="${enMsg}" | invalidTransitionCode="${invalidTransitionCode}"`,
    });
  } catch (err: any) {
    results.push({
      id: 'N-COORD-02',
      name: 'Structured NewsOperationError -> HttpsError mapping & bilingual editorial error formatter',
      passed: false,
      details: `Unexpected error: ${err?.message || err}`,
    });
  }

  // N-COORD-03: Durable createIdempotencyKey deduplicates retries without duplicate articles
  try {
    const idempRepo = new InMemoryNewsRepository();
    const idempService = new NewsApplicationService(idempRepo, fakeAssetRepo, fakeMediaRepo, communityRepo);
    const idemKey = 'news-idem-0123456789abcdef01234567';

    const firstResp = await executeManageNewsRequest(
      {
        auth: { uid: 'uid_editor' },
        data: {
          action: 'saveDraft',
          createIdempotencyKey: idemKey,
          item: baseArticlePayload,
        },
      },
      fakeAdminRepo,
      idempService,
      undefined,
      fakeAssetRepo,
      communityRepo
    );
    const secondResp = await executeManageNewsRequest(
      {
        auth: { uid: 'uid_editor' },
        data: {
          action: 'saveDraft',
          createIdempotencyKey: idemKey,
          item: { ...baseArticlePayload, titleEn: 'Retry with same idempotency key' },
        },
      },
      fakeAdminRepo,
      idempService,
      undefined,
      fakeAssetRepo,
      communityRepo
    );
    const distinctResp = await executeManageNewsRequest(
      {
        auth: { uid: 'uid_editor' },
        data: {
          action: 'saveDraft',
          createIdempotencyKey: 'news-idem-fedcba9876543210fedcba98',
          item: baseArticlePayload,
        },
      },
      fakeAdminRepo,
      idempService,
      undefined,
      fakeAssetRepo,
      communityRepo
    );

    let badKeyRejected = false;
    try {
      await executeManageNewsRequest(
        {
          auth: { uid: 'uid_editor' },
          data: {
            action: 'saveDraft',
            createIdempotencyKey: 'bad key with spaces!',
            item: baseArticlePayload,
          },
        },
        fakeAdminRepo,
        idempService,
        undefined,
        fakeAssetRepo,
        communityRepo
      );
    } catch (err: any) {
      badKeyRejected = err?.code === 'invalid-argument';
    }

    const allStored = await idempRepo.listAll();
    const passed =
      firstResp.item.id === secondResp.item.id &&
      firstResp.item.id !== distinctResp.item.id &&
      allStored.length === 2 &&
      badKeyRejected;

    results.push({
      id: 'N-COORD-03',
      name: 'Durable createIdempotencyKey deduplicates retried saveDraft calls and rejects malformed keys',
      passed,
      details: passed
        ? `Same key returned identical draft (${firstResp.item.id}); distinct key created second draft; total=${allStored.length}; invalid key rejected with invalid-argument.`
        : `first=${firstResp?.item?.id}, second=${secondResp?.item?.id}, distinct=${distinctResp?.item?.id}, count=${allStored.length}, badKeyRejected=${badKeyRejected}`,
    });
  } catch (err: any) {
    results.push({
      id: 'N-COORD-03',
      name: 'Durable createIdempotencyKey deduplicates retried createDraft calls and rejects malformed keys',
      passed: false,
      details: `Unexpected error: ${err?.message || err}`,
    });
  }

  // N-COORD-04: manageNews.createDraftFromCitizenSubmission narrow RBAC + AcceptedForEditorial + zero evidence leak
  try {
    const acceptedSubId = 'sub-accepted-001';
    const submittedSubId = 'sub-submitted-002';
    await communityRepo.save({
      id: acceptedSubId,
      submittedAt: nowIso,
      submittedByUid: 'citizen_uid_1',
      contributorName: 'مراسل ميداني',
      title: 'تلوث نهر محلي',
      body: 'رصد ميداني موثق لتسرب مخلفات صناعية.',
      sourceLanguage: 'ar',
      category: 'water',
      locationDescription: 'الخرطوم',
      status: 'AcceptedForEditorial',
      attachments: [
        {
          id: 'att-priv-1',
          fileName: 'private-evidence.jpg',
          fileType: 'image',
          fileUrl: 'citizen_submissions/citizen_uid_1/sub-accepted-001/private-evidence.jpg',
          storagePath: 'citizen_submissions/citizen_uid_1/sub-accepted-001/private-evidence.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 12345,
        },
      ],
    });
    await communityRepo.save({
      id: submittedSubId,
      submittedAt: nowIso,
      submittedByUid: 'citizen_uid_2',
      contributorName: 'مراسل ميداني 2',
      title: 'بلاغ غير مقبول بعد',
      body: 'ما زال قيد الانتظار.',
      sourceLanguage: 'ar',
      category: 'water',
      locationDescription: 'أم درمان',
      status: 'Received',
      attachments: [],
    });

    // ContentEditor, CitizenModerator, Owner allowed on AcceptedForEditorial
    const allowedUids = ['uid_owner', 'uid_mod', 'uid_editor'];
    let allAllowedOk = true;
    for (const uid of allowedUids) {
      const resp = await executeManageNewsRequest(
        {
          auth: { uid },
          data: { action: 'createDraftFromCitizenSubmission', submissionId: acceptedSubId },
        },
        fakeAdminRepo,
        newsService,
        undefined,
        fakeAssetRepo,
        communityRepo
      );
      const artJson = JSON.stringify(resp.item);
      if (
        resp.item.workflowState !== WorkflowState.Draft ||
        artJson.includes('private-evidence.jpg') ||
        artJson.includes('citizen_submissions/')
      ) {
        allAllowedOk = false;
      }
    }

    // Trainer, LibraryCurator, Viewer, AIAssistant MUST be denied
    const deniedUids = ['uid_trainer', 'uid_curator', 'uid_viewer', 'uid_ai'];
    let allDeniedOk = true;
    for (const uid of deniedUids) {
      let denied = false;
      try {
        await executeManageNewsRequest(
          {
            auth: { uid },
            data: { action: 'createDraftFromCitizenSubmission', submissionId: acceptedSubId },
          },
          fakeAdminRepo,
          newsService,
          undefined,
          fakeAssetRepo,
          communityRepo
        );
      } catch (err: any) {
        denied = err?.code === 'permission-denied';
      }
      if (!denied) allDeniedOk = false;
    }

    // Unaccepted submission MUST fail closed even for Owner
    let unacceptedBlocked = false;
    try {
      await executeManageNewsRequest(
        {
          auth: { uid: 'uid_owner' },
          data: { action: 'createDraftFromCitizenSubmission', submissionId: submittedSubId },
        },
        fakeAdminRepo,
        newsService,
        undefined,
        fakeAssetRepo,
        communityRepo
      );
    } catch (err: any) {
      unacceptedBlocked = err?.code === 'failed-precondition';
    }

    const passed = allAllowedOk && allDeniedOk && unacceptedBlocked;
    results.push({
      id: 'N-COORD-04',
      name: 'manageNews.createDraftFromCitizenSubmission enforces narrow RBAC, AcceptedForEditorial gate, and zero private evidence leak',
      passed,
      details: passed
        ? 'Owner/CitizenModerator/ContentEditor created clean Draft without private evidence; Trainer/LibraryCurator/Viewer/AIAssistant denied; non-AcceptedForEditorial blocked.'
        : `allAllowedOk=${allAllowedOk}, allDeniedOk=${allDeniedOk}, unacceptedBlocked=${unacceptedBlocked}`,
    });
  } catch (err: any) {
    results.push({
      id: 'N-COORD-04',
      name: 'manageNews.createDraftFromCitizenSubmission enforces narrow RBAC, AcceptedForEditorial gate, and zero private evidence leak',
      passed: false,
      details: `Unexpected error: ${err?.message || err}`,
    });
  }

  return results;
}

async function main() {
  console.log('=================================================================');
  console.log(' PROMISE OF PLANET — NEWS HUB FUNCTIONAL VERIFICATION');
  console.log('=================================================================\n');

  try {
    const firebaseMod = await import('../src/services/firebase');
    if (firebaseMod.isFirebaseConfigured !== false || firebaseMod.app !== null) {
      console.error(
        `FATAL SAFETY ABORT: Firebase client is configured in test runner (isFirebaseConfigured=${firebaseMod.isFirebaseConfigured}, app=${firebaseMod.app !== null ? 'non-null' : 'null'}). Aborting immediately to prevent live Firebase calls.`
      );
      process.exit(1);
    }
    console.log('[SAFETY] Firebase test isolation verified: isFirebaseConfigured === false, app === null\n');

    await registerBunFirebaseMocks();
    const { runNewsFunctionalTests } = await import('../src/services/newsFunctionalTests');
    const baseResults = await runNewsFunctionalTests();
    const coordResults = await runCoordinatedNewsEditorialVerification();
    const results = [...baseResults, ...coordResults];
    let allPassed = true;

    for (const res of results) {
      const statusIcon = res.passed ? '✓' : '✗';
      console.log(`[${statusIcon}] ${res.id}: ${res.name}`);
      console.log(`    ${res.details}\n`);
      if (!res.passed) {
        allPassed = false;
      }
    }

    console.log('=================================================================');
    if (allPassed) {
      console.log(` SUMMARY: ALL ${results.length} NEWS SPECIFICATION TESTS PASSED.`);
      console.log('=================================================================');
      process.exit(0);
    } else {
      console.error(` SUMMARY: SOME NEWS SPECIFICATION TESTS FAILED.`);
      console.log('=================================================================');
      process.exit(1);
    }
  } catch (err: any) {
    console.error('Test execution encountered fatal error:', err);
    process.exit(1);
  }
}

main();

