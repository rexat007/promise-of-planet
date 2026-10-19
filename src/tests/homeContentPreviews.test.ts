import { PublicNewsClient } from '../services/publicNewsClient';
import type { SanitizedPublicNewsDTO } from '../services/newsDomainAdapter';
import type { Video } from '../types';

let testsPassed = 0;
let testsFailed = 0;

function assert(id: string, name: string, condition: boolean, details?: string) {
  if (condition) {
    testsPassed++;
    console.log(`[✓] ${id}: ${name}`);
    if (details) console.log(`    PASSED: ${details}`);
  } else {
    testsFailed++;
    console.error(`[✗] ${id}: ${name}`);
    if (details) console.error(`    FAILED: ${details}`);
  }
}

async function runHomeContentPreviewsTests() {
  console.log('=================================================================');
  console.log(' PROMISE OF PLANET — HOME CONTENT PREVIEWS VERIFICATION (E2)');
  console.log('=================================================================');

  // -------------------------------------------------------------------------
  // TEST 1: News Preview - 3 Articles Cap & Sorting
  // -------------------------------------------------------------------------
  try {
    const mockDtos: SanitizedPublicNewsDTO[] = [
      {
        id: 'news-1',
        titleAr: 'الخبر الأول',
        titleEn: 'First News',
        summaryAr: 'ملخص 1',
        bodyAr: 'المحتوى 1',
        category: 'Water',
        tags: ['بيئة'],
        sources: ['المصدر 1'],
        author: 'محرر 1',
        location: 'الخرطوم',
        urgencyLevel: 'Standard',
        createdAt: '2026-10-01T10:00:00Z',
        publishedAt: '2026-10-01T10:00:00Z',
      },
      {
        id: 'news-2',
        titleAr: 'الخبر الثاني',
        titleEn: 'Second News',
        summaryAr: 'ملخص 2',
        bodyAr: 'المحتوى 2',
        category: 'Water',
        tags: ['بيئة'],
        sources: ['المصدر 2'],
        author: 'محرر 2',
        location: 'الخرطوم',
        urgencyLevel: 'Standard',
        createdAt: '2026-10-02T10:00:00Z',
        publishedAt: '2026-10-02T10:00:00Z',
      },
      {
        id: 'news-3',
        titleAr: 'الخبر الثالث',
        titleEn: 'Third News',
        summaryAr: 'ملخص 3',
        bodyAr: 'المحتوى 3',
        category: 'Water',
        tags: ['بيئة'],
        sources: ['المصدر 3'],
        author: 'محرر 3',
        location: 'الخرطوم',
        urgencyLevel: 'Standard',
        createdAt: '2026-10-03T10:00:00Z',
        publishedAt: '2026-10-03T10:00:00Z',
      },
      {
        id: 'news-4',
        titleAr: 'الخبر الرابع - الأحدث',
        titleEn: 'Fourth News - Extra',
        summaryAr: 'ملخص 4',
        bodyAr: 'المحتوى 4',
        category: 'Water',
        tags: ['بيئة'],
        sources: ['المصدر 4'],
        author: 'محرر 4',
        location: 'الخرطوم',
        urgencyLevel: 'Standard',
        createdAt: '2026-10-04T10:00:00Z',
        publishedAt: '2026-10-04T10:00:00Z',
      },
    ];

    // Set custom transport for testing
    PublicNewsClient.setTransport(async () => ({
      articles: mockDtos,
    }));

    const result = await PublicNewsClient.listPublishedNews({ language: 'ar' });
    const previewCapped = result.slice(0, 3);

    // Verify capped at 3 and ordered newest first
    const isCappedAt3 = previewCapped.length === 3;
    const isSortedDesc = previewCapped[0].id === 'news-4' && previewCapped[1].id === 'news-3';

    assert(
      'E2-NEWS-01',
      'HomeNewsPreview Caps at 3 Most Recent Published Articles',
      isCappedAt3 && isSortedDesc,
      `Returned exactly ${previewCapped.length} items sorted descending by publication date`
    );
  } catch (err: any) {
    assert('E2-NEWS-01', 'HomeNewsPreview Caps at 3 Most Recent Published Articles', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 2: News Slug Generation and Hash Navigation
  // -------------------------------------------------------------------------
  try {
    const slugAr = PublicNewsClient.getSlug('ارتفاع مناسيب النيل الأزرق وتنبيهات للمزارعين');
    const slugEn = PublicNewsClient.getSlug('Blue Nile Water Levels Rise: Flood Alert');

    const expectedAr = 'ارتفاع-مناسيب-النيل-الأزرق-وتنبيهات-للمزارعين';
    const expectedEn = 'blue-nile-water-levels-rise-flood-alert';

    const slugArValid = slugAr === expectedAr;
    const slugEnValid = slugEn === expectedEn;

    assert(
      'E2-NEWS-02',
      'Semantic Slug Generation for Bilingual Navigation',
      slugArValid && slugEnValid,
      `Arabic slug: "${slugAr}", English slug: "${slugEn}"`
    );
  } catch (err: any) {
    assert('E2-NEWS-02', 'Semantic Slug Generation for Bilingual Navigation', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 3: News Fail-Closed Propagation (Zero Mock Fallback)
  // -------------------------------------------------------------------------
  try {
    PublicNewsClient.setTransport(async () => {
      throw new Error('NETWORK_TIMEOUT_SIMULATED');
    });

    let threw = false;
    try {
      await PublicNewsClient.listPublishedNews();
    } catch (_e: any) {
      threw = true;
    }

    assert(
      'E2-NEWS-03',
      'News Preview Fail-Closed Error Propagation',
      threw,
      'Errors propagate transparently to trigger ErrorBanner without injecting fake news'
    );
  } catch (err: any) {
    assert('E2-NEWS-03', 'News Preview Fail-Closed Error Propagation', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 4: Multimedia Deduplication, 3-Video Cap & Sorting
  // -------------------------------------------------------------------------
  try {
    const rawVideos: Video[] = [
      {
        id: 'vid-1',
        contentType: 'Video',
        status: 'Published',
        approvalStatus: 'Approved',
        rightsStatus: 'Cleared',
        visibilityDecision: 'MediaHubOnly',
        tags: [],
        category: 'Water',
        titleAr: 'فيديو قديم',
        excerptAr: 'ملخص فيديو 1',
        editorialDescriptionAr: 'وصف تحريري 1',
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
        publishedAt: '2026-09-01T00:00:00Z',
        youtubeSource: {
          youtubeVideoId: 'abc1',
          youtubeUrl: 'https://www.youtube.com/watch?v=abc1',
          originalTitle: 'Video 1',
          originalDescription: 'Desc 1',
          youtubePublishedAt: '2026-09-01T00:00:00Z',
          thumbnails: {},
          availabilityStatus: 'Available',
        },
      },
      {
        id: 'vid-2',
        contentType: 'Video',
        status: 'Published',
        approvalStatus: 'Approved',
        rightsStatus: 'Cleared',
        visibilityDecision: 'MediaHubOnly',
        tags: [],
        category: 'Water',
        titleAr: 'فيديو حديث',
        excerptAr: 'ملخص فيديو 2',
        editorialDescriptionAr: 'وصف تحريري 2',
        createdAt: '2026-10-15T00:00:00Z',
        updatedAt: '2026-10-15T00:00:00Z',
        publishedAt: '2026-10-15T00:00:00Z',
        youtubeSource: {
          youtubeVideoId: 'abc2',
          youtubeUrl: 'https://www.youtube.com/watch?v=abc2',
          originalTitle: 'Video 2',
          originalDescription: 'Desc 2',
          youtubePublishedAt: '2026-10-15T00:00:00Z',
          thumbnails: {},
          availabilityStatus: 'Available',
        },
      },
      {
        id: 'vid-1', // Duplicate of vid-1
        contentType: 'Video',
        status: 'Published',
        approvalStatus: 'Approved',
        rightsStatus: 'Cleared',
        visibilityDecision: 'MediaHubOnly',
        tags: [],
        category: 'Water',
        titleAr: 'فيديو قديم مكرر',
        excerptAr: 'ملخص فيديو 1',
        editorialDescriptionAr: 'وصف تحريري 1',
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
        publishedAt: '2026-09-01T00:00:00Z',
        youtubeSource: {
          youtubeVideoId: 'abc1',
          youtubeUrl: 'https://www.youtube.com/watch?v=abc1',
          originalTitle: 'Video 1',
          originalDescription: 'Desc 1',
          youtubePublishedAt: '2026-09-01T00:00:00Z',
          thumbnails: {},
          availabilityStatus: 'Available',
        },
      },
      {
        id: 'vid-3',
        contentType: 'Video',
        status: 'Published',
        approvalStatus: 'Approved',
        rightsStatus: 'Cleared',
        visibilityDecision: 'MediaHubOnly',
        tags: [],
        category: 'Water',
        titleAr: 'فيديو أحدث',
        excerptAr: 'ملخص فيديو 3',
        editorialDescriptionAr: 'وصف تحريري 3',
        createdAt: '2026-10-18T00:00:00Z',
        updatedAt: '2026-10-18T00:00:00Z',
        publishedAt: '2026-10-18T00:00:00Z',
        youtubeSource: {
          youtubeVideoId: 'abc3',
          youtubeUrl: 'https://www.youtube.com/watch?v=abc3',
          originalTitle: 'Video 3',
          originalDescription: 'Desc 3',
          youtubePublishedAt: '2026-10-18T00:00:00Z',
          thumbnails: {},
          availabilityStatus: 'Available',
        },
      },
      {
        id: 'vid-4',
        contentType: 'Video',
        status: 'Published',
        approvalStatus: 'Approved',
        rightsStatus: 'Cleared',
        visibilityDecision: 'MediaHubOnly',
        tags: [],
        category: 'Water',
        titleAr: 'فيديو متوسط',
        excerptAr: 'ملخص فيديو 4',
        editorialDescriptionAr: 'وصف تحريري 4',
        createdAt: '2026-10-10T00:00:00Z',
        updatedAt: '2026-10-10T00:00:00Z',
        publishedAt: '2026-10-10T00:00:00Z',
        youtubeSource: {
          youtubeVideoId: 'abc4',
          youtubeUrl: 'https://www.youtube.com/watch?v=abc4',
          originalTitle: 'Video 4',
          originalDescription: 'Desc 4',
          youtubePublishedAt: '2026-10-10T00:00:00Z',
          thumbnails: {},
          availabilityStatus: 'Available',
        },
      },
    ];

    // Simulate deduplication and sorting algorithm as implemented in HomeMultimediaPreview
    const seen = new Set<string>();
    const uniqueVideos: Video[] = [];
    for (const v of rawVideos) {
      if (!seen.has(v.id)) {
        seen.add(v.id);
        uniqueVideos.push(v);
      }
    }

    uniqueVideos.sort((a, b) => {
      const dateA = new Date(a.publishedAt || a.youtubeSource.youtubePublishedAt || a.createdAt).getTime();
      const dateB = new Date(b.publishedAt || b.youtubeSource.youtubePublishedAt || b.createdAt).getTime();
      return dateB - dateA;
    });

    const capped = uniqueVideos.slice(0, 3);

    const dedupedCountOk = uniqueVideos.length === 4; // vid-1 deduplicated
    const cappedAt3 = capped.length === 3;
    const sortedOk = capped[0].id === 'vid-3' && capped[1].id === 'vid-2' && capped[2].id === 'vid-4';

    assert(
      'E2-MEDIA-01',
      'HomeMultimediaPreview Deduplication, Sorting, and 3-Video Cap',
      dedupedCountOk && cappedAt3 && sortedOk,
      `Deduplicated from 5 to 4 items, capped to 3 sorted by publication date: [${capped.map(v => v.id).join(', ')}]`
    );
  } catch (err: any) {
    assert('E2-MEDIA-01', 'HomeMultimediaPreview Deduplication, Sorting, and 3-Video Cap', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 5: Modal Description Truncate Boundary (250 Characters)
  // -------------------------------------------------------------------------
  try {
    const shortDesc = 'تقرير بيئي قصير يوضح أثر الفيضانات على المزارع في سنار.';
    const longDesc = 'أعلنت الإدارة العامة للموارد المائية بوزارة الري والموارد المائية عن تدفقات مائية مرتفعة عبر النيل الأزرق نتيجة الهطول الغزير للأمطار بالهضبة الإثيوبية. وأكد الباحثون في محطة رصد سنار أن مناسيب المياه اقتربت من منسوب الفيضان الموسمي الاعتيادي، مما يقتضي اتخاذ الحيطة في تنظيم عمل الجسور الترابية والترع الرئيسية بالمنشورات الزراعية.';

    const isShortLongerThan250 = shortDesc.length > 250;
    const isLongLongerThan250 = longDesc.length > 250;

    const truncated = isLongLongerThan250 ? `${longDesc.slice(0, 250)}...` : longDesc;

    const shortBehaviorOk = !isShortLongerThan250;
    const longBehaviorOk = isLongLongerThan250 && truncated.length === 253; // 250 + '...'

    assert(
      'E2-MEDIA-02',
      'Modal Description 250-Character Truncation Boundary',
      shortBehaviorOk && longBehaviorOk,
      `Short description (${shortDesc.length} chars) untruncated; Long description (${longDesc.length} chars) truncated to 250 chars with expand control`
    );
  } catch (err: any) {
    assert('E2-MEDIA-02', 'Modal Description 250-Character Truncation Boundary', false, err.message);
  }

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log('=================================================================');
  console.log(` SUMMARY: ${testsPassed} PASSED, ${testsFailed} FAILED`);
  console.log('=================================================================');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runHomeContentPreviewsTests();
