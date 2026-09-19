import { InMemoryYouTubeRepository } from '../functions/src/youtube/inMemoryYouTubeRepository';
import { YoutubeApplicationService } from '../functions/src/youtube/youtubeApplicationService';
import { FakeYouTubeClient } from '../functions/src/youtube/fakeYouTubeClient';
import { InMemoryAdminRepository } from '../functions/src/admin/inMemoryAdminRepository';
import { AdminRole, AdminPermission } from '../functions/src/types/admin';
import type { YouTubeImportCandidate, CandidateSourceSnapshot, CandidateEditorialDraft } from '../functions/src/types/youtube';
import {
  executeManageYouTubeIntegrationRequest,
  executeReviewYouTubeCandidateRequest
} from '../functions/src/youtube/youtubeAdminHandlers';

async function runReviewTests() {
  console.log('=========================================================');
  console.log('ADMIN MEDIA — YOUTUBE REVIEW & MANUAL SYNC INTEGRATION TEST SUITE');
  console.log('=========================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail: string) {
    if (condition) {
      console.log(`[PASS] ${testName} - ${detail}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} - ${detail}`);
      failed++;
    }
  }

  // Setup Repositories
  const adminRepo = new InMemoryAdminRepository();
  const ytRepo = new InMemoryYouTubeRepository();
  const ytClient = new FakeYouTubeClient();
  const ytAppService = new YoutubeApplicationService(ytRepo, ytClient);

  // Setup test admin accounts
  const ownerUser = {
    id: 'uid-owner',
    email: 'owner@promiseofplanet.org',
    name: 'Owner Admin',
    role: AdminRole.Owner,
    isActive: true,
  };

  const editorUser = {
    id: 'uid-editor',
    email: 'editor@promiseofplanet.org',
    name: 'Content Editor',
    role: AdminRole.ContentEditor,
    isActive: true,
  };

  const viewerUser = {
    id: 'uid-viewer',
    email: 'viewer@promiseofplanet.org',
    name: 'Viewer',
    role: AdminRole.Viewer,
    isActive: true,
  };

  const inactiveOwner = {
    id: 'uid-inactive',
    email: 'inactive@promiseofplanet.org',
    name: 'Inactive Owner',
    role: AdminRole.Owner,
    isActive: false,
  };

  await adminRepo.saveAdmin(ownerUser);
  await adminRepo.saveAdmin(editorUser);
  await adminRepo.saveAdmin(viewerUser);
  await adminRepo.saveAdmin(inactiveOwner);

  // Setup YouTube integration config
  await ytRepo.saveConfiguration({
    id: 'youtube-primary',
    channelId: 'UC_TEST_CHANNEL',
    enabled: true,
    updatedAt: new Date().toISOString(),
    version: 1,
  });

  // Seed sample candidates
  const source1: CandidateSourceSnapshot = {
    sourceTitle: 'Sudan Afforestation Project 2026',
    sourceDescription: 'Overview of community-led reforestation efforts in Sudan.',
    sourceThumbnailUrl: 'https://img.youtube.com/vi/test_vid_1/maxresdefault.jpg',
    youtubePublishedAt: '2026-03-01T10:00:00Z',
  };

  const draft1: CandidateEditorialDraft = {
    titleAr: 'مشروع تشجير السودان 2026',
    titleEn: 'Sudan Afforestation Project 2026',
    excerptAr: 'مبادرة مجتمعية لإعادة التشجير ومكافحة التصحر.',
    excerptEn: 'Community initiative for reforestation and anti-desertification.',
    editorialDescriptionAr: 'توثيق ميداني لمبادرات استعادة الغطاء النباتي.',
    editorialDescriptionEn: 'Field documentation of vegetation cover restoration.',
    tags: ['تشجير', 'السودان', 'المناخ'],
    // category intentionally unset
  };

  const candidate1: YouTubeImportCandidate = {
    id: 'youtube_test_vid_1',
    provider: 'YouTube',
    externalVideoId: 'test_vid_1',
    sourceSnapshot: source1,
    editorialDraft: draft1,
    status: 'PendingReview',
    candidateVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const candidate2: YouTubeImportCandidate = {
    id: 'youtube_test_vid_2',
    provider: 'YouTube',
    externalVideoId: 'test_vid_2',
    sourceSnapshot: {
      ...source1,
      sourceTitle: 'Water Conservation in the Nile Basin',
    },
    editorialDraft: {
      ...draft1,
      titleAr: 'الحفاظ على المياه في حوض النيل',
      category: 'Water',
    },
    status: 'PendingReview',
    candidateVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await ytRepo.saveCandidate(candidate1);
  await ytRepo.saveCandidate(candidate2);

  // TEST 1: listCandidates returns pending candidates via application service
  const pendingList = await ytAppService.listCandidates({ status: 'PendingReview' });
  assert(
    pendingList.length === 2 && pendingList.every(c => c.status === 'PendingReview'),
    'Review Test 1',
    'listCandidates returns all PendingReview candidates accurately'
  );

  // TEST 2: executeManageYouTubeIntegrationRequest - unauthenticated fails
  let unauthCaught = false;
  try {
    await executeManageYouTubeIntegrationRequest(
      { auth: null, data: { action: 'getConfig' } },
      adminRepo,
      ytAppService
    );
  } catch (err: any) {
    unauthCaught = err.code === 'unauthenticated' || err.message.includes('UNAUTHENTICATED');
  }
  assert(unauthCaught, 'Review Test 2', 'executeManageYouTubeIntegrationRequest fails closed when unauthenticated');

  // TEST 3: executeManageYouTubeIntegrationRequest - inactive admin fails
  let inactiveCaught = false;
  try {
    await executeManageYouTubeIntegrationRequest(
      { auth: { uid: 'uid-inactive', token: {} as any }, data: { action: 'getConfig' } },
      adminRepo,
      ytAppService
    );
  } catch (err: any) {
    inactiveCaught = err.code === 'permission-denied' && err.message.includes('ADMIN_INACTIVE');
  }
  assert(inactiveCaught, 'Review Test 3', 'Inactive admin fails closed on manage request');

  // TEST 4: executeManageYouTubeIntegrationRequest - viewer lacks ManageSettings
  let viewerDenied = false;
  try {
    await executeManageYouTubeIntegrationRequest(
      { auth: { uid: 'uid-viewer', token: {} as any }, data: { action: 'getConfig' } },
      adminRepo,
      ytAppService
    );
  } catch (err: any) {
    viewerDenied = err.code === 'permission-denied';
  }
  assert(viewerDenied, 'Review Test 4', 'Viewer without ManageSettings is denied getConfig');

  // TEST 5: Owner with ManageSettings gets config successfully
  const configRes = await executeManageYouTubeIntegrationRequest(
    { auth: { uid: 'uid-owner', token: {} as any }, data: { action: 'getConfig' } },
    adminRepo,
    ytAppService
  );
  assert(
    configRes.config && configRes.config.channelId === 'UC_TEST_CHANNEL',
    'Review Test 5',
    'Owner with ManageSettings successfully retrieves YouTube configuration'
  );

  // TEST 6: Editor cannot mutate config (updateConfig requires ManageSettings)
  let editorConfigUpdateDenied = false;
  try {
    await executeManageYouTubeIntegrationRequest(
      {
        auth: { uid: 'uid-editor', token: {} as any },
        data: {
          action: 'updateConfig',
          channelId: 'UC_NEW_CHANNEL',
          enabled: true,
          version: 1,
        }
      },
      adminRepo,
      ytAppService
    );
  } catch (err: any) {
    editorConfigUpdateDenied = err.code === 'permission-denied';
  }
  assert(
    editorConfigUpdateDenied,
    'Review Test 6',
    'Editor lacks ManageSettings and cannot update YouTube configuration'
  );

  // TEST 7: Owner updates config with concurrency protection
  const updateRes = await executeManageYouTubeIntegrationRequest(
    {
      auth: { uid: 'uid-owner', token: {} as any },
      data: {
        action: 'updateConfig',
        channelId: 'UC_UPDATED_CHANNEL',
        enabled: true,
        version: 1,
      }
    },
    adminRepo,
    ytAppService
  );
  assert(
    updateRes.config && updateRes.config.channelId === 'UC_UPDATED_CHANNEL' && updateRes.config.version === 2,
    'Review Test 7',
    'Owner successfully updates YouTube configuration with monotonic version increment'
  );

  // TEST 8: listCandidates via review permission allows ContentEditor
  const listCandidatesRes = await executeManageYouTubeIntegrationRequest(
    {
      auth: { uid: 'uid-editor', token: {} as any },
      data: { action: 'listCandidates', status: 'PendingReview' }
    },
    adminRepo,
    ytAppService
  );
  assert(
    Array.isArray(listCandidatesRes.candidates) && listCandidatesRes.candidates.length === 2,
    'Review Test 8',
    'ContentEditor with Review permission successfully queries pending candidates'
  );

  // TEST 9: executeReviewYouTubeCandidateRequest - updateDraft requires Edit permission
  // Viewer lacks Edit permission
  let viewerEditDenied = false;
  try {
    await executeReviewYouTubeCandidateRequest(
      {
        auth: { uid: 'uid-viewer', token: {} as any },
        data: {
          action: 'updateDraft',
          candidateId: candidate1.id,
          editorialDraft: {
            titleAr: 'تعديل غير مصرح',
          }
        }
      },
      adminRepo,
      ytAppService
    );
  } catch (err: any) {
    viewerEditDenied = err.code === 'permission-denied';
  }
  assert(
    viewerEditDenied,
    'Review Test 9',
    'Viewer lacks Edit permission and is denied updating candidate editorial draft'
  );

  // TEST 10: Editor with Edit permission successfully updates candidate editorial draft
  const draftUpdateRes = await executeReviewYouTubeCandidateRequest(
    {
      auth: { uid: 'uid-editor', token: {} as any },
      data: {
        action: 'updateDraft',
        candidateId: candidate1.id,
        editorialDraft: {
          titleAr: 'مشروع تشجير السودان المعتمد 2026',
          category: 'Climate',
          tags: ['تشجير', 'السودان', 'المناخ'],
        }
      }
    },
    adminRepo,
    ytAppService
  );
  assert(
    draftUpdateRes.candidate &&
    draftUpdateRes.candidate.editorialDraft.titleAr === 'مشروع تشجير السودان المعتمد 2026' &&
    draftUpdateRes.candidate.editorialDraft.category === 'Climate' &&
    draftUpdateRes.candidate.status === 'PendingReview',
    'Review Test 10',
    'ContentEditor successfully updates candidate editorial draft while preserving PendingReview status'
  );

  // TEST 11: Invalid category assignment is rejected fail-closed
  let invalidCategoryDenied = false;
  try {
    await executeReviewYouTubeCandidateRequest(
      {
        auth: { uid: 'uid-editor', token: {} as any },
        data: {
          action: 'updateDraft',
          candidateId: candidate1.id,
          editorialDraft: {
            category: 'NotACanonicalCategory',
          }
        }
      },
      adminRepo,
      ytAppService
    );
  } catch (err: any) {
    invalidCategoryDenied = err.code === 'invalid-argument' && err.message.includes('INVALID_CATEGORY');
  }
  assert(
    invalidCategoryDenied,
    'Review Test 11',
    'Non-canonical category string is rejected with invalid-argument error'
  );

  // TEST 12: Reject candidate requires Review permission
  // Viewer lacks Review permission
  let viewerRejectDenied = false;
  try {
    await executeReviewYouTubeCandidateRequest(
      {
        auth: { uid: 'uid-viewer', token: {} as any },
        data: {
          action: 'reject',
          candidateId: candidate2.id,
          reviewedVersion: 1,
        }
      },
      adminRepo,
      ytAppService
    );
  } catch (err: any) {
    viewerRejectDenied = err.code === 'permission-denied';
  }
  assert(
    viewerRejectDenied,
    'Review Test 12',
    'Viewer lacks Review permission and cannot reject a candidate'
  );

  // TEST 13: Stale review rejection fails with precondition / conflict error
  let staleReviewBlocked = false;
  try {
    await executeReviewYouTubeCandidateRequest(
      {
        auth: { uid: 'uid-editor', token: {} as any },
        data: {
          action: 'reject',
          candidateId: candidate2.id,
          reviewedVersion: 99, // Stale version
        }
      },
      adminRepo,
      ytAppService
    );
  } catch (err: any) {
    staleReviewBlocked = err.code === 'failed-precondition' && err.message.includes('STALE_REVIEW');
  }
  assert(
    staleReviewBlocked,
    'Review Test 13',
    'Stale reviewedVersion fails closed protecting concurrent candidate mutations'
  );

  // TEST 14: Editor with Review permission rejects candidate successfully
  const rejectRes = await executeReviewYouTubeCandidateRequest(
    {
      auth: { uid: 'uid-editor', token: {} as any },
      data: {
        action: 'reject',
        candidateId: candidate2.id,
        reviewedVersion: 1,
      }
    },
    adminRepo,
    ytAppService
  );
  assert(
    rejectRes.candidate && rejectRes.candidate.status === 'Rejected',
    'Review Test 14',
    'Editor with Review permission successfully rejects candidate transitioning to Rejected'
  );

  // TEST 15: Terminal state candidate cannot be edited further
  let terminalEditDenied = false;
  try {
    await executeReviewYouTubeCandidateRequest(
      {
        auth: { uid: 'uid-editor', token: {} as any },
        data: {
          action: 'updateDraft',
          candidateId: candidate2.id,
          editorialDraft: {
            titleAr: 'محاولة تعديل مرفوض',
          }
        }
      },
      adminRepo,
      ytAppService
    );
  } catch (err: any) {
    terminalEditDenied = err.code === 'failed-precondition' && err.message.includes('INVALID_TRANSITION');
  }
  assert(
    terminalEditDenied,
    'Review Test 15',
    'Candidates in terminal Rejected state are locked against further editorial draft mutation'
  );

  // TEST 16: Category assignment requirement for future acceptance
  // Acceptance is blocked when Category is unset
  const unclassifiedCand: YouTubeImportCandidate = {
    id: 'youtube_unclassified_vid',
    provider: 'YouTube',
    externalVideoId: 'unclassified_vid',
    sourceSnapshot: source1,
    editorialDraft: {
      ...draft1,
      category: undefined, // UNSET
    },
    status: 'PendingReview',
    candidateVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await ytRepo.saveCandidate(unclassifiedCand);

  let unclassifiedAcceptBlocked = false;
  try {
    await ytAppService.acceptCandidate('youtube_unclassified_vid', 1);
  } catch (err: any) {
    unclassifiedAcceptBlocked = err.message.includes('Canonical Category');
  }
  assert(
    unclassifiedAcceptBlocked,
    'Review Test 16',
    'acceptCandidate strictly enforces human-curated canonical Category before acceptance'
  );

  console.log('\n=========================================================');
  console.log(`TOTAL PASSED: ${passed} / ${passed + failed}`);
  console.log(`TOTAL FAILED: ${failed}`);
  console.log('=========================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runReviewTests().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
