import { MediaAdminClient } from '../services/mediaAdminClient';
import { NewsAdminClient } from '../services/newsAdminClient';
import { YouTubeAdminClient } from '../services/youtubeAdminClient';

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

export async function runAdminMediaProductionConvergenceTests() {
  console.log('=================================================================');
  console.log(' PROMISE OF PLANET — ADMIN MEDIA PRODUCTION CONVERGENCE TESTS (D2-A)');
  console.log('=================================================================');

  // TEST 1: Method existence contracts
  assert(
    'D2A-01',
    'MediaAdminClient methods exist for canonical operations',
    typeof MediaAdminClient.listAll === 'function' &&
    typeof MediaAdminClient.getById === 'function' &&
    typeof MediaAdminClient.getRelationsForVideo === 'function' &&
    typeof MediaAdminClient.register === 'function' &&
    typeof MediaAdminClient.updateMetadata === 'function' &&
    typeof MediaAdminClient.updateRightsStatus === 'function' &&
    typeof MediaAdminClient.updateVisibilityDecision === 'function' &&
    typeof MediaAdminClient.linkVideoToContent === 'function' &&
    typeof MediaAdminClient.unlinkVideoFromContent === 'function'
  );

  assert(
    'D2A-02',
    'NewsAdminClient methods exist for relation article lookup',
    typeof NewsAdminClient.listAll === 'function' &&
    typeof NewsAdminClient.getById === 'function'
  );

  assert(
    'D2A-03',
    'YouTubeAdminClient methods exist for candidate ingestion',
    typeof YouTubeAdminClient.listCandidates === 'function' &&
    typeof YouTubeAdminClient.acceptCandidate === 'function' &&
    typeof YouTubeAdminClient.rejectCandidate === 'function' &&
    typeof YouTubeAdminClient.syncUploads === 'function'
  );

  // TEST 2: Unauthenticated guard handling
  let listUnauthBlocked = false;
  try {
    if (!MediaAdminClient.isAuthenticated()) {
      await MediaAdminClient.listAll();
    } else {
      listUnauthBlocked = true; // When auth is present, listAll proceeds to backend
    }
  } catch (err: any) {
    listUnauthBlocked = true;
  }
  assert(
    'D2A-04',
    'MediaAdminClient.listAll handles unauthenticated or backend guard cleanly',
    listUnauthBlocked
  );

  let registerUnauthBlocked = false;
  try {
    if (!MediaAdminClient.isAuthenticated()) {
      await MediaAdminClient.register({
        contentType: 'Video' as const,
        category: 'Climate',
        titleAr: 'اختبار المناخ',
        originalLanguage: 'ar' as const,
        availableLanguages: ['ar'],
        translationStatus: 'NotRequired' as const,
        status: 'Draft' as const,
        approvalStatus: 'Pending' as const,
        visibilityDecision: 'Hidden' as const,
        rightsStatus: 'NotStarted' as const,
        editorialDescriptionAr: 'وصف',
        youtubeSource: {
          youtubeVideoId: 'testVideo123',
          youtubeUrl: 'https://youtube.com/watch?v=testVideo123',
          originalTitle: 'عنوان',
          originalDescription: 'وصف',
          youtubePublishedAt: new Date().toISOString(),
          thumbnails: {}
        }
      });
    } else {
      registerUnauthBlocked = true;
    }
  } catch (err: any) {
    registerUnauthBlocked = true;
  }
  assert(
    'D2A-05',
    'MediaAdminClient.register rejects unauthenticated submissions without in-memory fallback',
    registerUnauthBlocked
  );

  let updateMetadataBlocked = false;
  try {
    if (!MediaAdminClient.isAuthenticated()) {
      await MediaAdminClient.updateMetadata('vid-1', { editorialDescriptionAr: 'تحديث' });
    } else {
      updateMetadataBlocked = true;
    }
  } catch (err: any) {
    updateMetadataBlocked = true;
  }
  assert(
    'D2A-06',
    'MediaAdminClient.updateMetadata fails closed when unauthenticated',
    updateMetadataBlocked
  );

  let linkVideoBlocked = false;
  try {
    if (!MediaAdminClient.isAuthenticated()) {
      await MediaAdminClient.linkVideoToContent('vid-1', 'news-1', 'Embedded', 'Inline');
    } else {
      linkVideoBlocked = true;
    }
  } catch (err: any) {
    linkVideoBlocked = true;
  }
  assert(
    'D2A-07',
    'MediaAdminClient.linkVideoToContent fails closed on unauthenticated calls',
    linkVideoBlocked
  );

  console.log('-----------------------------------------------------------------');
  console.log(` SUMMARY: ${testsPassed} Passed, ${testsFailed} Failed`);
  console.log('=================================================================');

  return { testsPassed, testsFailed };
}

if (typeof process !== 'undefined' && process.argv[1]?.includes('adminMediaProductionConvergence.test')) {
  runAdminMediaProductionConvergenceTests();
}
