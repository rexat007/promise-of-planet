/**
 * Standalone test runner for Rich News Persistence Tests.
 */

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

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { React: typeof React }).React = React;

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

interface CoordinatedRichTestResult {
  readonly id: string;
  readonly name: string;
  readonly passed: boolean;
  readonly details: string;
}

async function runCoordinatedRichImageTests(): Promise<CoordinatedRichTestResult[]> {
  await registerBunFirebaseMocks();
  const results: CoordinatedRichTestResult[] = [];
  const {
    NewsAdminClient,
    NewsEditorImageSessionController,
  } = await import('../src/services/newsAdminClient');
  const { EditorialInlineImageModal } = await import('../src/components/news/editor/EditorialInlineImageModal');
  const { shouldSuppressDuplicateCoverBanner } = await import('../src/components/news/PublicNewsHub');
  const { AdminRole } = await import('../src/types/admin');
  const { WorkflowState } = await import('../src/types/workflow');

  // RNP-COORD-01: Single upload deduplication for usage='both' + idempotency key retention across retries
  try {
    const observedCreateIdemKeys: string[] = [];
    let uploadCallCount = 0;
    let createAttemptCount = 0;

    NewsAdminClient.setTransport(async (action: string, payload?: any) => {
      if (action === 'saveDraft') {
        createAttemptCount += 1;
        const idemKey = payload?.createIdempotencyKey ?? payload?.item?.createIdempotencyKey;
        if (typeof idemKey === 'string') {
          observedCreateIdemKeys.push(idemKey);
        }
        if (createAttemptCount === 1) {
          throw new Error('Transient network drop during saveDraft');
        }
        return {
          item: {
            id: 'news-both-001',
            ...payload?.item,
            workflowState: WorkflowState.Draft,
            createdAt: '2026-11-21T10:00:00.000Z',
            updatedAt: '2026-11-21T10:00:00.000Z',
          },
        };
      }
      return {};
    });

    NewsAdminClient.setImageUploadRuntime({
      endpointUrl: 'https://upload.promiseofplanet.org/editorial-image',
      isAuthenticated: () => true,
      getAuthenticatedIdToken: async () => 'mock-admin-id-token',
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        uploadCallCount += 1;
        const headersObj = (init?.headers ?? {}) as Record<string, string>;
        const rawHeader = headersObj['X-Editorial-Image-Metadata'] || '';
        const parsedMeta = JSON.parse(decodeURIComponent(rawHeader));
        return {
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () =>
            JSON.stringify({
              ok: true,
              assetId: parsedMeta.assetId,
              intakeId: parsedMeta.intakeId,
              status: 'Completed',
            }),
        } as unknown as Response;
      }) as typeof fetch,
    });

    const controller = new NewsEditorImageSessionController({
      urlAdapter: {
        createObjectURL: () => 'blob:https://promiseofplanet.org/mock-both-1',
        revokeObjectURL: () => {},
      },
    });

    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    const fakeFile = new File([jpegBytes], 'river-field.jpg', { type: 'image/jpeg' });

    const staged = controller.stageInlineImage(fakeFile, {
      altAr: 'صورة غلاف ومحتوى',
      altEn: 'Cover and inline image',
      captionAr: 'توثيق ميداني',
      captionEn: 'Field documentation',
      photographerCredit: 'فريق وعد الكوكب',
      licensingInfo: 'CC-BY-4.0',
    });
    if (!staged.ok) {
      throw new Error(`stageInlineImage failed unexpectedly: ${staged.errorEn}`);
    }

    const saveInput = {
      isDraft: true,
      isCreating: true,
      activeItem: null,
      editForm: {
        titleAr: 'اختبار صورة واحدة للغلاف والمتن',
        titleEn: 'Single asset cover + inline test',
        summaryAr: 'ملخص',
        summaryEn: 'Summary',
        bodyAr: 'فقرة أولى',
        bodyEn: 'First paragraph',
        category: 'Climate',
        featuredImage: staged.assetId,
        richBodyAr: {
          schemaVersion: 2 as const,
          doc: {
            type: 'doc' as const,
            content: [
              { type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'فقرة أولى' }] },
              {
                type: 'editorialImage' as const,
                attrs: {
                  assetId: staged.assetId,
                  altAr: 'صورة غلاف ومحتوى',
                  captionAr: 'توثيق ميداني',
                  width: '100%' as const,
                  layout: 'block-center' as const,
                },
              },
            ],
          },
        },
      },
      tagsInput: '',
      sourcesInput: '',
      currentUser: {
        id: 'uid_owner',
        name: 'Owner',
        email: 'owner@pop.org',
        role: AdminRole.Owner,
        isActive: true,
      },
      isAr: true,
    };

    try {
      // First attempt fails transiently; second attempt MUST reuse identical createIdempotencyKey and STILL upload only once!
      const attempt1 = await controller.executeSaveWorkflow(saveInput);
      const attempt2 = await controller.executeSaveWorkflow(saveInput);

      const passed =
        uploadCallCount === 1 &&
        attempt1.ok === false &&
        attempt2.ok === true &&
        observedCreateIdemKeys.length === 2 &&
        observedCreateIdemKeys[0] === observedCreateIdemKeys[1] &&
        /^[a-zA-Z0-9_-]{8,128}$/.test(observedCreateIdemKeys[0]) &&
        attempt2.savedItem?.featuredImage === staged.assetId;

      results.push({
        id: 'RNP-COORD-01',
        name: 'Single-upload cover+inline deduplication (usage=both) and createIdempotencyKey retry preservation',
        passed,
        details: passed
          ? `Uploaded once (uploadCallCount=1) for cover+inline assetId=${staged.assetId}; retry reused exact key ${observedCreateIdemKeys[0]}.`
          : `uploadCallCount=${uploadCallCount}, attempt1.ok=${attempt1.ok}, attempt2.ok=${attempt2.ok}, keys=${JSON.stringify(observedCreateIdemKeys)}`,
      });
    } finally {
      NewsAdminClient.setTransport(null);
      NewsAdminClient.setImageUploadRuntime(null);
    }
  } catch (err: any) {
    results.push({
      id: 'RNP-COORD-01',
      name: 'Single-upload cover+inline deduplication (usage=both) and createIdempotencyKey retry preservation',
      passed: false,
      details: `Unexpected error: ${err?.message || err}`,
    });
  }

  // RNP-COORD-02: EditorialInlineImageModal allowInlineUsage=false disables inline/both cleanly
  try {
    const coverOnlyMarkup = renderToStaticMarkup(
      React.createElement(EditorialInlineImageModal, {
        isOpen: true,
        lang: 'ar',
        initialUsage: 'cover',
        allowInlineUsage: false,
        onClose: () => {},
        onConfirm: () => ({ accepted: true }),
      })
    );
    const fullUsageMarkup = renderToStaticMarkup(
      React.createElement(EditorialInlineImageModal, {
        isOpen: true,
        lang: 'en',
        initialUsage: 'both',
        allowInlineUsage: true,
        onClose: () => {},
        onConfirm: () => ({ accepted: true }),
      })
    );

    const hasDisabledNote = coverOnlyMarkup.includes('editorial-usage-inline-disabled-note');
    const inlineDisabledInCoverOnly =
      coverOnlyMarkup.includes('data-testid="editorial-usage-inline-btn" disabled=""') &&
      coverOnlyMarkup.includes('data-testid="editorial-usage-both-btn" disabled=""');
    const fullHasNoDisabledNote = !fullUsageMarkup.includes('editorial-usage-inline-disabled-note');

    const passed = hasDisabledNote && inlineDisabledInCoverOnly && fullHasNoDisabledNote;
    results.push({
      id: 'RNP-COORD-02',
      name: 'EditorialInlineImageModal disables inline/both when allowInlineUsage=false without guessing caret',
      passed,
      details: passed
        ? 'allowInlineUsage=false renders editorial-usage-inline-disabled-note and disables inline/both buttons; allowInlineUsage=true enables all usage intents.'
        : `hasDisabledNote=${hasDisabledNote}, inlineDisabledInCoverOnly=${inlineDisabledInCoverOnly}, fullHasNoDisabledNote=${fullHasNoDisabledNote}`,
    });
  } catch (err: any) {
    results.push({
      id: 'RNP-COORD-02',
      name: 'EditorialInlineImageModal disables inline/both when allowInlineUsage=false without guessing caret',
      passed: false,
      details: `Unexpected error: ${err?.message || err}`,
    });
  }

  // RNP-COORD-03: PublicNewsHub suppresses duplicate cover banner for explicit usage='both' & derived_first_inline ONLY when active body contains identical assetId
  try {
    const sharedAssetId = 'asset_aaaa1111bbbb2222cccc3333dddd4444';
    const distinctCoverAssetId = 'asset_555566667777888899990000aaaabbbb';
    const richDocWithShared = {
      schemaVersion: 2 as const,
      doc: {
        type: 'doc' as const,
        content: [
          { type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'نص المقال' }] },
          {
            type: 'editorialImage' as const,
            attrs: {
              assetId: sharedAssetId,
              altAr: 'صورة',
              width: '100%' as const,
              layout: 'block-center' as const,
            },
          },
        ],
      },
    };

    const makePublicArticle = (source: 'explicit' | 'derived_first_inline', assetId: string): any => ({
      id: 'pub-art-1',
      titleAr: 'عنوان',
      titleEn: 'Title',
      summaryAr: 'ملخص',
      summaryEn: 'Summary',
      contentAr: 'نص',
      contentEn: 'Body',
      category: 'Climate',
      coverImage: { source, assetId, altAr: 'صورة' },
    });

    const suppressExplicitSame = shouldSuppressDuplicateCoverBanner(
      makePublicArticle('explicit', sharedAssetId),
      richDocWithShared
    );
    const suppressDerivedSame = shouldSuppressDuplicateCoverBanner(
      makePublicArticle('derived_first_inline', sharedAssetId),
      richDocWithShared
    );
    const keepExplicitDifferent = shouldSuppressDuplicateCoverBanner(
      makePublicArticle('explicit', distinctCoverAssetId),
      richDocWithShared
    );
    const keepWhenPlainBody = shouldSuppressDuplicateCoverBanner(
      makePublicArticle('explicit', sharedAssetId),
      null
    );

    const passed =
      suppressExplicitSame === true &&
      suppressDerivedSame === true &&
      keepExplicitDifferent === false &&
      keepWhenPlainBody === false;

    results.push({
      id: 'RNP-COORD-03',
      name: 'PublicNewsHub suppresses duplicate reader cover banner for explicit usage=both and derived_first_inline when identical assetId is in active rich body',
      passed,
      details: passed
        ? 'Identical cover+inline assetId suppressed for explicit & derived_first_inline; distinct cover assetId and plain-body cover preserved.'
        : `explicitSame=${suppressExplicitSame}, derivedSame=${suppressDerivedSame}, explicitDiff=${keepExplicitDifferent}, plainBody=${keepWhenPlainBody}`,
    });
  } catch (err: any) {
    results.push({
      id: 'RNP-COORD-03',
      name: 'PublicNewsHub suppresses duplicate reader cover banner for explicit usage=both and derived_first_inline when identical assetId is in active rich body',
      passed: false,
      details: `Unexpected error: ${err?.message || err}`,
    });
  }

  return results;
}

async function main() {
  console.log('=================================================================');
  console.log(' PROMISE OF PLANET — RICH NEWS PERSISTENCE VERIFICATION');
  console.log('=================================================================\n');

  try {
    await registerBunFirebaseMocks();
    const { runRichNewsPersistenceTests } = await import('../src/services/richNewsPersistenceTests');
    const baseResults = await runRichNewsPersistenceTests();
    const coordResults = await runCoordinatedRichImageTests();
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
      console.log(` SUMMARY: ALL ${results.length} RICH PERSISTENCE TESTS PASSED.`);
      console.log('=================================================================');
      process.exit(0);
    } else {
      console.error(` SUMMARY: SOME RICH PERSISTENCE TESTS FAILED.`);
      console.log('=================================================================');
      process.exit(1);
    }
  } catch (err: any) {
    console.error('Test execution encountered fatal error:', err);
    process.exit(1);
  }
}

main();

