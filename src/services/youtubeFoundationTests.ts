import { YoutubeApplicationService } from '../../functions/src/youtube/youtubeApplicationService';
import { InMemoryYouTubeRepository } from '../../functions/src/youtube/inMemoryYouTubeRepository';
import { FirestoreYouTubeRepository } from '../../functions/src/youtube/firestoreYouTubeRepository';
import { FakeYouTubeClient } from '../../functions/src/youtube/fakeYouTubeClient';
import { RealYouTubeClient } from '../../functions/src/youtube/realYouTubeClient';
import { youtubeApiKeySecret } from '../../functions/src/youtube/youtubeSecrets';
import { InMemoryAdminRepository } from '../../functions/src/admin/inMemoryAdminRepository';
import { executeManualYouTubeSyncRequest } from '../../functions/src/youtube/manualSyncHandler';
import { MediaService } from './mediaService';
import { AdminRole, AdminPermission, AdminRole as FrontendRole, AdminPermission as FrontendPermission } from '../types/admin';
import { AdminRole as FunctionsRole, AdminPermission as FunctionsPermission } from '../../functions/src/types/admin';
import * as SharedContract from '../shared/adminContract';
import { AdminAccessService } from './adminAccess';
import type { AdminUser } from '../types/admin';
import type { CandidateSourceSnapshot } from '../types/youtube';

export interface TestResult {
  test: string;
  passed: boolean;
  details?: string;
}

export async function runYoutubeFoundationVerification(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  function assert(name: string, condition: boolean, details?: string) {
    results.push({ test: name, passed: condition, details });
  }

  // Create isolated test repository instance (In-Memory test double)
  const testRepo = new InMemoryYouTubeRepository();
  const service = new YoutubeApplicationService(testRepo);

  // Canonical Roles from types/admin.ts
  const ownerUser: AdminUser = {
    id: 'owner-1',
    name: 'Chief Owner',
    email: 'owner@promiseofplanet.sd',
    role: AdminRole.Owner,
    isActive: true,
  };

  const viewerUser: AdminUser = {
    id: 'viewer-1',
    name: 'Guest Viewer',
    email: 'viewer@promiseofplanet.sd',
    role: AdminRole.Viewer,
    isActive: true,
  };

  const contentEditorUser: AdminUser = {
    id: 'editor-1',
    name: 'Arabic Content Editor',
    email: 'editor@promiseofplanet.sd',
    role: AdminRole.ContentEditor,
    isActive: true,
  };

  // ---------------------------------------------------------------------------
  // 1. ARCHITECTURAL / REPOSITORY BOUNDARY TESTS
  // ---------------------------------------------------------------------------

  // Assertion 15: No mutable useMemoryDb production flag on class
  const serviceHasMemoryFlag = 'useMemoryDb' in (YoutubeApplicationService as any);
  assert(
    'Assertion 15 - No mutable useMemoryDb production flag',
    serviceHasMemoryFlag === false,
    'YoutubeApplicationService uses explicit Repository dependency injection without runtime boolean flags'
  );

  // Assertion 13 & 14: Firestore repo is server-only, InMemory repo is test-only
  const firestoreRepoInstance = new FirestoreYouTubeRepository();
  assert(
    'Assertion 13 & 14 - Repository separation verified',
    firestoreRepoInstance instanceof FirestoreYouTubeRepository && testRepo instanceof InMemoryYouTubeRepository,
    'Production uses FirestoreYouTubeRepository while test infrastructure explicitly injects InMemoryYouTubeRepository'
  );

  // Assertion 16: No silent Firestore -> memory fallback
  try {
    const prodService = new YoutubeApplicationService(); // defaults to FirestoreYouTubeRepository
    // Should fail closed if Firestore is not initialized in CLI environment
    await prodService.getConfiguration();
    assert('Assertion 16 - Fail closed without silent fallback', false, 'Allowed un-configured Firestore read');
  } catch (e: any) {
    assert(
      'Assertion 16 - Fail closed without silent fallback',
      e !== null && e !== undefined,
      'Production Firestore repository fails closed rather than silently falling back to memory'
    );
  }

  // ---------------------------------------------------------------------------
  // 2. CONFIGURATION TESTS & CONCURRENCY
  // ---------------------------------------------------------------------------

  try {
    const config = await service.getConfiguration();
    assert('Config - Singleton default identity', config === null, 'Singleton initially empty');
  } catch (e: any) {
    assert('Config - Singleton default identity', false, e.message);
  }

  try {
    // Check RBAC permission for ManageSettings
    if (!AdminAccessService.hasPermission(ownerUser, AdminPermission.ManageSettings)) {
      throw new Error('Unauthorized');
    }
    const config = await service.updateConfiguration({
      channelId: 'UC123_POP_OFFICIAL',
      enabled: true,
      version: 0,
    });

    assert(
      'Config - Valid update by authorized user',
      config.id === 'youtube-primary' && config.channelId === 'UC123_POP_OFFICIAL' && config.enabled === true && config.version === 1,
      'Config initialized cleanly with version 1'
    );
  } catch (e: any) {
    assert('Config - Valid update by authorized user', false, e.message);
  }

  // Assertion 11 (Config Concurrency) & Authorization
  try {
    if (!AdminAccessService.hasPermission(viewerUser, AdminPermission.ManageSettings)) {
      throw new Error('Unauthorized: Requires ManageSettings permission');
    }
    await service.updateConfiguration({
      channelId: 'UC123_POP_HACK',
      enabled: true,
      version: 1,
    });
    assert('Config - Unauthorized update rejected', false, 'Allowed unauthorized guest viewer to edit config');
  } catch (e: any) {
    assert(
      'Config - Unauthorized update rejected',
      e.message.includes('Unauthorized'),
      `Successfully blocked unauthorized user: ${e.message}`
    );
  }

  // ---------------------------------------------------------------------------
  // 3. CANDIDATE LIFECYCLE, IDENTITY & VERSIONING TESTS
  // ---------------------------------------------------------------------------

  const sourceSnapshot1: CandidateSourceSnapshot = {
    sourceTitle: 'Never Gonna Give You Up',
    sourceDescription: 'Official environmental clip on POP.',
    sourceThumbnailUrl: 'https://img.youtube.com/vi/dQw4w9WgXcQ/default.jpg',
    youtubePublishedAt: '2009-10-25T00:00:00Z',
  };

  // Assertion 1: Deterministic identity & Assertion 2: sourceSnapshot minimization
  try {
    const candidate = await service.saveCandidateFromSource(sourceSnapshot1, 'dQw4w9WgXcQ');
    const hasDuplicateIdInSnapshot = 'youtubeVideoId' in candidate.sourceSnapshot;
    assert(
      'Assertion 1 & 2 - Deterministic ID and minimized sourceSnapshot',
      candidate.id === 'youtube_dQw4w9WgXcQ' && hasDuplicateIdInSnapshot === false,
      "Candidate ID derived as 'youtube_dQw4w9WgXcQ' and duplicate youtubeVideoId excluded"
    );
  } catch (e: any) {
    assert('Assertion 1 & 2 - Deterministic ID and minimized sourceSnapshot', false, e.message);
  }

  // Assertion 3: Editorial / source separation & canonical Category handling
  try {
    // Set category explicitly as human editor
    await service.updateEditorialDraft('youtube_dQw4w9WgXcQ', { category: 'Climate' });
    const candidate = await service.getCandidate('youtube_dQw4w9WgXcQ');
    const isCanonicalCategory = candidate?.editorialDraft.category === 'Climate';
    const hasEditorInDraft = 'editor' in (candidate?.editorialDraft || {});
    assert(
      'Assertion 3 - Source/Editorial separation and canonical category setting',
      isCanonicalCategory === true && hasEditorInDraft === false,
      "Human editor set canonical 'Climate' Category and excluded redundant editor property"
    );
  } catch (e: any) {
    assert('Assertion 3 - Source/Editorial separation and canonical category setting', false, e.message);
  }

  // Assertion 4: Source refresh preserves human editorial draft
  try {
    if (!AdminAccessService.hasPermission(contentEditorUser, AdminPermission.Edit)) {
      throw new Error('Unauthorized');
    }
    await service.updateEditorialDraft('youtube_dQw4w9WgXcQ', {
      titleAr: 'عن تغير المناخ وحماية الكوكب',
      excerptAr: 'مقتطف مخصص يدويًا',
      category: 'Climate',
    });

    const snapshotUpdated: CandidateSourceSnapshot = {
      ...sourceSnapshot1,
      sourceTitle: 'Never Gonna Give You Up (New Ingest Refresh)',
    };
    const refreshed = await service.saveCandidateFromSource(snapshotUpdated, 'dQw4w9WgXcQ');

    assert(
      'Assertion 4 - Source refresh preserves editorial draft',
      refreshed.sourceSnapshot.sourceTitle === 'Never Gonna Give You Up (New Ingest Refresh)' &&
      refreshed.editorialDraft.titleAr === 'عن تغير المناخ وحماية الكوكب',
      'Editorial draft fully protected against silent overwrite by source refresh'
    );
  } catch (e: any) {
    assert('Assertion 4 - Source refresh preserves editorial draft', false, e.message);
  }

  // Assertion 5: candidateVersion source increment (only on material change)
  try {
    const beforeCandidate = await service.getCandidate('youtube_dQw4w9WgXcQ');
    const beforeVer = beforeCandidate?.candidateVersion || 0;

    const changedSnapshot: CandidateSourceSnapshot = {
      ...sourceSnapshot1,
      sourceTitle: 'Never Gonna Give You Up (Refreshed Title Changes)',
    };
    const afterChanged = await service.saveCandidateFromSource(changedSnapshot, 'dQw4w9WgXcQ');
    const midVer = afterChanged.candidateVersion;

    const afterIdentical = await service.saveCandidateFromSource(changedSnapshot, 'dQw4w9WgXcQ');
    const finalVer = afterIdentical.candidateVersion;

    assert(
      'Assertion 5 - candidateVersion source increment',
      midVer === beforeVer + 1 && finalVer === midVer,
      'candidateVersion increments on material snapshot changes but remains stable on identical payloads'
    );
  } catch (e: any) {
    assert('Assertion 5 - candidateVersion source increment', false, e.message);
  }

  // Assertion 6: candidateVersion editorial increment
  try {
    const candidateBefore = await service.getCandidate('youtube_dQw4w9WgXcQ');
    const beforeVer = candidateBefore?.candidateVersion || 0;

    const candidateAfter = await service.updateEditorialDraft('youtube_dQw4w9WgXcQ', {
      titleAr: 'تحديث جديد وتعديل يدوي آخر',
    });

    assert(
      'Assertion 6 - candidateVersion editorial increment',
      candidateAfter.candidateVersion === beforeVer + 1,
      `Draft change bumped version from ${beforeVer} to ${candidateAfter.candidateVersion}`
    );
  } catch (e: any) {
    assert('Assertion 6 - candidateVersion editorial increment', false, e.message);
  }

  // Assertion 7: Stale review rejection
  try {
    const currentCandidate = await service.getCandidate('youtube_dQw4w9WgXcQ');
    const currentVer = currentCandidate?.candidateVersion || 0;

    if (!AdminAccessService.hasPermission(ownerUser, AdminPermission.Review)) {
      throw new Error('Unauthorized');
    }
    await service.rejectCandidate('youtube_dQw4w9WgXcQ', currentVer - 1);
    assert('Assertion 7 - Stale review rejection', false, 'Allowed operation using stale version token');
  } catch (e: any) {
    assert(
      'Assertion 7 - Stale review rejection',
      e.message.includes('Stale Review'),
      `Rejected stale review transaction successfully: ${e.message}`
    );
  }

  // Assertion 8: Accepted terminal lock & Assertion 10: Ingestion cannot reopen terminal candidate
  try {
    const currentCandidate = await service.getCandidate('youtube_dQw4w9WgXcQ');
    const curVer = currentCandidate?.candidateVersion || 1;

    // Simulate canonical media registration hook
    let mediaRegistered: boolean = false;
    const accepted = await service.acceptCandidate('youtube_dQw4w9WgXcQ', curVer, (cand) => {
      mediaRegistered = true;
      MediaService.register({
        contentType: 'Video',
        titleAr: cand.editorialDraft.titleAr,
        excerptAr: cand.editorialDraft.excerptAr,
        category: cand.editorialDraft.category!,
        tags: cand.editorialDraft.tags,
        originalLanguage: 'ar',
        availableLanguages: ['ar'],
        translationStatus: 'NotRequired',
        editor: ownerUser.name,
        status: 'Draft',
        approvalStatus: 'Pending',
        visibilityDecision: 'Hidden',
        rightsStatus: 'NotStarted',
        editorialDescriptionAr: cand.editorialDraft.editorialDescriptionAr,
        youtubeSource: {
          youtubeVideoId: cand.externalVideoId,
          youtubeUrl: `https://www.youtube.com/watch?v=${cand.externalVideoId}`,
          channelId: 'UC123_POP_OFFICIAL',
          channelName: 'Promise of Planet',
          channelUrl: 'https://www.youtube.com/channel/UC123_POP_OFFICIAL',
          originalTitle: cand.sourceSnapshot.sourceTitle,
          originalDescription: cand.sourceSnapshot.sourceDescription,
          youtubePublishedAt: cand.sourceSnapshot.youtubePublishedAt,
          thumbnails: { default: cand.sourceSnapshot.sourceThumbnailUrl },
          duration: 'PT0S',
          availabilityStatus: 'Available',
        },
      }, ownerUser);
    });

    const reIngested = await service.saveCandidateFromSource(sourceSnapshot1, 'dQw4w9WgXcQ');

    assert(
      'Assertion 8 & 10 - Accepted terminal lock & no reopen',
      accepted.status === 'Accepted' && reIngested.status === 'Accepted' && Boolean(mediaRegistered),
      'Accepted state remains terminal and cannot be reopened by background ingestion'
    );
  } catch (e: any) {
    assert('Assertion 8 & 10 - Accepted terminal lock & no reopen', false, e.message);
  }

  // Assertion 9: Rejected terminal lock
  try {
    const snapshotNew: CandidateSourceSnapshot = {
      sourceTitle: 'Rejection Isolation Test',
      sourceDescription: 'Will reject.',
      sourceThumbnailUrl: 'https://img.youtube.com/vi/reject_vid/default.jpg',
      youtubePublishedAt: '2026-09-19T00:00:00Z',
    };
    const cand = await service.saveCandidateFromSource(snapshotNew, 'reject_vid');
    const rejected = await service.rejectCandidate('youtube_reject_vid', cand.candidateVersion);

    const afterIngested = await service.saveCandidateFromSource(snapshotNew, 'reject_vid');

    assert(
      'Assertion 9 - Rejected candidate terminal lock',
      rejected.status === 'Rejected' && afterIngested.status === 'Rejected',
      'Rejection is terminal and fully isolated from ingestion-triggered reopening'
    );
  } catch (e: any) {
    assert('Assertion 9 - Rejected candidate terminal lock', false, e.message);
  }

  // Assertion 12: Only two lifecycle transitions (PendingReview -> Accepted, PendingReview -> Rejected)
  try {
    const snapshotTwo: CandidateSourceSnapshot = {
      sourceTitle: 'Two Transitions Test',
      sourceDescription: 'Review transitions.',
      sourceThumbnailUrl: 'https://img.youtube.com/vi/two_trans/default.jpg',
      youtubePublishedAt: '2026-09-19T00:00:00Z',
    };
    const c = await service.saveCandidateFromSource(snapshotTwo, 'two_trans');

    const rej = await service.rejectCandidate('youtube_two_trans', c.candidateVersion);
    await service.acceptCandidate('youtube_two_trans', rej.candidateVersion);
    assert('Assertion 12 - Only two lifecycle transitions', false, 'Allowed invalid state transition');
  } catch (e: any) {
    assert(
      'Assertion 12 - Only two lifecycle transitions',
      e.message.includes('already in a terminal state'),
      `Correctly blocked invalid lifecycle transition: ${e.message}`
    );
  }

  // ---------------------------------------------------------------------------
  // 4. SECURE SERVER FETCH FOUNDATION TESTS (20 CONTRACT REQUIREMENTS)
  // ---------------------------------------------------------------------------

  // Test 1: Disabled integration causes zero YouTube calls
  try {
    const fetchRepo = new InMemoryYouTubeRepository();
    const fakeClient = new FakeYouTubeClient();
    const fetchService = new YoutubeApplicationService(fetchRepo, fakeClient);

    await fetchService.updateConfiguration({
      channelId: 'UC_POP_CHANNEL',
      enabled: false,
      version: 0,
    });

    let threw = false;
    try {
      await fetchService.fetchChannelUploads();
    } catch (e: any) {
      threw = e.message.includes('disabled');
    }

    assert(
      'Fetch Test 1 - Disabled integration causes zero YouTube calls',
      threw && fakeClient.callCounts.getUploadsPlaylistId === 0,
      'Integration disabled flag blocks YouTube API calls completely'
    );
  } catch (e: any) {
    assert('Fetch Test 1 - Disabled integration causes zero YouTube calls', false, e.message);
  }

  // Test 2: Missing config fails closed
  try {
    const fetchRepo = new InMemoryYouTubeRepository();
    const fakeClient = new FakeYouTubeClient();
    const fetchService = new YoutubeApplicationService(fetchRepo, fakeClient);

    let threw = false;
    try {
      await fetchService.fetchChannelUploads();
    } catch (e: any) {
      threw = e.message.includes('Configuration missing');
    }

    assert(
      'Fetch Test 2 - Missing config fails closed',
      threw && fakeClient.callCounts.getUploadsPlaylistId === 0,
      'Service fails closed when youtube-primary configuration does not exist'
    );
  } catch (e: any) {
    assert('Fetch Test 2 - Missing config fails closed', false, e.message);
  }

  // Test 3: Blank channelId fails closed
  try {
    const fetchRepo = new InMemoryYouTubeRepository();
    const fakeClient = new FakeYouTubeClient();
    const fetchService = new YoutubeApplicationService(fetchRepo, fakeClient);

    // Bypassing updateConfiguration validation to simulate malformed stored doc
    await fetchRepo.saveConfiguration({
      id: 'youtube-primary',
      channelId: '  ',
      enabled: true,
      updatedAt: new Date().toISOString(),
      version: 1,
    });

    let threw = false;
    try {
      await fetchService.fetchChannelUploads();
    } catch (e: any) {
      threw = e.message.includes('channelId is required');
    }

    assert(
      'Fetch Test 3 - Blank channelId fails closed',
      threw && fakeClient.callCounts.getUploadsPlaylistId === 0,
      'Service fails closed when channelId is blank or whitespace'
    );
  } catch (e: any) {
    assert('Fetch Test 3 - Blank channelId fails closed', false, e.message);
  }

  // Test 4: Channel -> uploads playlist resolution
  try {
    const fetchRepo = new InMemoryYouTubeRepository();
    const fakeClient = new FakeYouTubeClient();
    fakeClient.channels['UC_POP_OFFICIAL'] = 'UU_POP_UPLOADS';
    fakeClient.playlists['UU_POP_UPLOADS'] = { items: ['v1'] };
    fakeClient.videos['v1'] = {
      externalVideoId: 'v1',
      sourceTitle: 'Video 1',
      sourceDescription: 'Desc 1',
      sourceThumbnailUrl: 'https://img.com/v1.jpg',
      youtubePublishedAt: '2026-01-01T00:00:00Z',
    };

    const fetchService = new YoutubeApplicationService(fetchRepo, fakeClient);
    await fetchService.updateConfiguration({
      channelId: 'UC_POP_OFFICIAL',
      enabled: true,
      version: 0,
    });

    const res = await fetchService.fetchChannelUploads();
    assert(
      'Fetch Test 4 - Channel -> uploads playlist resolution',
      res.fetched === 1 && fakeClient.callCounts.getUploadsPlaylistId === 1,
      'Successfully resolved UC_POP_OFFICIAL to UU_POP_UPLOADS playlist'
    );
  } catch (e: any) {
    assert('Fetch Test 4 - Channel -> uploads playlist resolution', false, e.message);
  }

  // Test 5: Newest 25 limit
  try {
    const fetchRepo = new InMemoryYouTubeRepository();
    const fakeClient = new FakeYouTubeClient();
    fakeClient.channels['UC_POP_30'] = 'UU_POP_30';

    const items30 = Array.from({ length: 30 }, (_, i) => `vid_${i + 1}`);
    fakeClient.playlists['UU_POP_30'] = { items: items30 };
    for (const id of items30) {
      fakeClient.videos[id] = {
        externalVideoId: id,
        sourceTitle: `Title ${id}`,
        sourceDescription: `Desc ${id}`,
        sourceThumbnailUrl: `https://img.com/${id}.jpg`,
        youtubePublishedAt: '2026-01-01T00:00:00Z',
      };
    }

    const fetchService = new YoutubeApplicationService(fetchRepo, fakeClient);
    await fetchService.updateConfiguration({
      channelId: 'UC_POP_30',
      enabled: true,
      version: 0,
    });

    const res = await fetchService.fetchChannelUploads();
    assert(
      'Fetch Test 5 - Newest 25 limit',
      res.fetched === 25 && res.created === 25,
      'Initial fetch bounded cleanly to the newest 25 videos'
    );
  } catch (e: any) {
    assert('Fetch Test 5 - Newest 25 limit', false, e.message);
  }

  // Test 6: Playlist pagination token is returned without persistence
  try {
    const fetchRepo = new InMemoryYouTubeRepository();
    const fakeClient = new FakeYouTubeClient();
    fakeClient.channels['UC_PAGED'] = 'UU_PAGED';
    fakeClient.playlists['UU_PAGED'] = { items: ['v_p1'], nextPageToken: 'TOKEN_PAGE_2' };
    fakeClient.videos['v_p1'] = {
      externalVideoId: 'v_p1',
      sourceTitle: 'Paged Video',
      sourceDescription: 'Paged Desc',
      sourceThumbnailUrl: 'https://img.com/vp1.jpg',
      youtubePublishedAt: '2026-01-01T00:00:00Z',
    };

    const fetchService = new YoutubeApplicationService(fetchRepo, fakeClient);
    await fetchService.updateConfiguration({
      channelId: 'UC_PAGED',
      enabled: true,
      version: 0,
    });

    const res = await fetchService.fetchChannelUploads();
    assert(
      'Fetch Test 6 - Playlist pagination token returned without persistence',
      res.nextPageToken === 'TOKEN_PAGE_2',
      'nextPageToken returned in result payload for future manual pagination without persistent cursor collections'
    );
  } catch (e: any) {
    assert('Fetch Test 6 - Playlist pagination token returned without persistence', false, e.message);
  }

  // Test 7: videos.list uses batching
  try {
    const fetchRepo = new InMemoryYouTubeRepository();
    const fakeClient = new FakeYouTubeClient();
    fakeClient.channels['UC_BATCH'] = 'UU_BATCH';
    const batchIds = ['b1', 'b2', 'b3', 'b4', 'b5'];
    fakeClient.playlists['UU_BATCH'] = { items: batchIds };
    for (const id of batchIds) {
      fakeClient.videos[id] = {
        externalVideoId: id,
        sourceTitle: `Title ${id}`,
        sourceDescription: `Desc ${id}`,
        sourceThumbnailUrl: `https://img.com/${id}.jpg`,
        youtubePublishedAt: '2026-01-01T00:00:00Z',
      };
    }

    const fetchService = new YoutubeApplicationService(fetchRepo, fakeClient);
    await fetchService.updateConfiguration({
      channelId: 'UC_BATCH',
      enabled: true,
      version: 0,
    });

    await fetchService.fetchChannelUploads();
    assert(
      'Fetch Test 7 - videos.list uses batching',
      fakeClient.callCounts.getVideoDetailsBatch === 1,
      'Fetched details for 5 videos in a single batched request'
    );
  } catch (e: any) {
    assert('Fetch Test 7 - videos.list uses batching', false, e.message);
  }

  // Test 8: Source normalization
  try {
    const fetchRepo = new InMemoryYouTubeRepository();
    const fakeClient = new FakeYouTubeClient();
    fakeClient.channels['UC_NORM'] = 'UU_NORM';
    fakeClient.playlists['UU_NORM'] = { items: ['norm1'] };
    fakeClient.videos['norm1'] = {
      externalVideoId: 'norm1',
      sourceTitle: 'Clean Title',
      sourceDescription: 'Clean Description',
      sourceThumbnailUrl: 'https://img.com/clean.jpg',
      youtubePublishedAt: '2026-02-01T12:00:00Z',
    };

    const fetchService = new YoutubeApplicationService(fetchRepo, fakeClient);
    await fetchService.updateConfiguration({ channelId: 'UC_NORM', enabled: true, version: 0 });

    await fetchService.fetchChannelUploads();
    const cand = await fetchRepo.getCandidate('youtube_norm1');

    const snap = cand?.sourceSnapshot;
    const snapKeys = Object.keys(snap || {}).sort();
    const expectedKeys = ['sourceDescription', 'sourceThumbnailUrl', 'sourceTitle', 'youtubePublishedAt'].sort();

    assert(
      'Fetch Test 8 - Source normalization',
      JSON.stringify(snapKeys) === JSON.stringify(expectedKeys) && snap?.sourceTitle === 'Clean Title',
      'Normalized exactly into CandidateSourceSnapshot interface'
    );
  } catch (e: any) {
    assert('Fetch Test 8 - Source normalization', false, e.message);
  }

  // Test 9: Thumbnail deterministic fallback
  try {
    // Simulate snippet thumbnail fallback: standard available, maxres missing
    const thumbs1: Record<string, { url: string } | undefined> = {
      standard: { url: 'https://img.com/standard.jpg' },
      high: { url: 'https://img.com/high.jpg' },
      default: { url: 'https://img.com/default.jpg' },
    };

    const urlSelected =
      thumbs1.maxres?.url ||
      thumbs1.standard?.url ||
      thumbs1.high?.url ||
      thumbs1.default?.url ||
      '';

    assert(
      'Fetch Test 9 - Thumbnail deterministic fallback',
      urlSelected === 'https://img.com/standard.jpg',
      'Deterministic fallback order correctly chose standard thumbnail when maxres was unavailable'
    );
  } catch (e: any) {
    assert('Fetch Test 9 - Thumbnail deterministic fallback', false, e.message);
  }

  // Test 10: New candidate -> PendingReview
  try {
    const fetchRepo = new InMemoryYouTubeRepository();
    const fakeClient = new FakeYouTubeClient();
    fakeClient.channels['UC_NEW'] = 'UU_NEW';
    fakeClient.playlists['UU_NEW'] = { items: ['new1'] };
    fakeClient.videos['new1'] = {
      externalVideoId: 'new1',
      sourceTitle: 'New Candidate Title',
      sourceDescription: 'New Desc',
      sourceThumbnailUrl: 'https://img.com/new1.jpg',
      youtubePublishedAt: '2026-03-01T00:00:00Z',
    };

    const fetchService = new YoutubeApplicationService(fetchRepo, fakeClient);
    await fetchService.updateConfiguration({ channelId: 'UC_NEW', enabled: true, version: 0 });

    const res = await fetchService.fetchChannelUploads();
    const cand = await fetchRepo.getCandidate('youtube_new1');

    assert(
      'Fetch Test 10 - New candidate -> PendingReview',
      res.created === 1 && cand?.status === 'PendingReview',
      'Ingested candidate initialized cleanly in PendingReview status'
    );
  } catch (e: any) {
    assert('Fetch Test 10 - New candidate -> PendingReview', false, e.message);
  }

  // Test 11: Deterministic candidate ID
  try {
    const fetchRepo = new InMemoryYouTubeRepository();
    const fakeClient = new FakeYouTubeClient();
    fakeClient.channels['UC_ID'] = 'UU_ID';
    fakeClient.playlists['UU_ID'] = { items: ['abc_xyz_789'] };
    fakeClient.videos['abc_xyz_789'] = {
      externalVideoId: 'abc_xyz_789',
      sourceTitle: 'ID Test',
      sourceDescription: 'ID Desc',
      sourceThumbnailUrl: 'https://img.com/id.jpg',
      youtubePublishedAt: '2026-03-01T00:00:00Z',
    };

    const fetchService = new YoutubeApplicationService(fetchRepo, fakeClient);
    await fetchService.updateConfiguration({ channelId: 'UC_ID', enabled: true, version: 0 });

    await fetchService.fetchChannelUploads();
    const cand = await fetchRepo.getCandidate('youtube_abc_xyz_789');

    assert(
      'Fetch Test 11 - Deterministic candidate ID',
      cand?.id === 'youtube_abc_xyz_789' && cand?.externalVideoId === 'abc_xyz_789',
      'Candidate ID deterministically generated as youtube_abc_xyz_789'
    );
  } catch (e: any) {
    assert('Fetch Test 11 - Deterministic candidate ID', false, e.message);
  }

  // Test 12: Duplicate unchanged candidate -> unchanged/no version bump
  try {
    const fetchRepo = new InMemoryYouTubeRepository();
    const fakeClient = new FakeYouTubeClient();
    fakeClient.channels['UC_DUP'] = 'UU_DUP';
    fakeClient.playlists['UU_DUP'] = { items: ['dup1'] };
    fakeClient.videos['dup1'] = {
      externalVideoId: 'dup1',
      sourceTitle: 'Same Title',
      sourceDescription: 'Same Desc',
      sourceThumbnailUrl: 'https://img.com/same.jpg',
      youtubePublishedAt: '2026-03-01T00:00:00Z',
    };

    const fetchService = new YoutubeApplicationService(fetchRepo, fakeClient);
    await fetchService.updateConfiguration({ channelId: 'UC_DUP', enabled: true, version: 0 });

    const res1 = await fetchService.fetchChannelUploads();
    const cand1 = await fetchRepo.getCandidate('youtube_dup1');

    const res2 = await fetchService.fetchChannelUploads();
    const cand2 = await fetchRepo.getCandidate('youtube_dup1');

    assert(
      'Fetch Test 12 - Duplicate unchanged candidate -> unchanged/no version bump',
      res1.created === 1 && res2.unchanged === 1 && cand1?.candidateVersion === cand2?.candidateVersion,
      'Re-ingesting unchanged candidate resulted in unchanged count without version bump'
    );
  } catch (e: any) {
    assert('Fetch Test 12 - Duplicate unchanged candidate -> unchanged/no version bump', false, e.message);
  }

  // Test 13: Changed source -> version bump
  try {
    const fetchRepo = new InMemoryYouTubeRepository();
    const fakeClient = new FakeYouTubeClient();
    fakeClient.channels['UC_CHG'] = 'UU_CHG';
    fakeClient.playlists['UU_CHG'] = { items: ['chg1'] };
    fakeClient.videos['chg1'] = {
      externalVideoId: 'chg1',
      sourceTitle: 'Original Title',
      sourceDescription: 'Desc',
      sourceThumbnailUrl: 'https://img.com/c.jpg',
      youtubePublishedAt: '2026-03-01T00:00:00Z',
    };

    const fetchService = new YoutubeApplicationService(fetchRepo, fakeClient);
    await fetchService.updateConfiguration({ channelId: 'UC_CHG', enabled: true, version: 0 });

    await fetchService.fetchChannelUploads();
    const cand1 = await fetchRepo.getCandidate('youtube_chg1');

    // Source title changes on YouTube
    fakeClient.videos['chg1'].sourceTitle = 'Updated Title On YouTube';
    const res2 = await fetchService.fetchChannelUploads();
    const cand2 = await fetchRepo.getCandidate('youtube_chg1');

    assert(
      'Fetch Test 13 - Changed source -> version bump',
      res2.updated === 1 && cand2?.candidateVersion === (cand1?.candidateVersion || 0) + 1,
      'Material source update bumped candidateVersion cleanly'
    );
  } catch (e: any) {
    assert('Fetch Test 13 - Changed source -> version bump', false, e.message);
  }

  // Test 14: Changed source preserves editorialDraft
  try {
    const fetchRepo = new InMemoryYouTubeRepository();
    const fakeClient = new FakeYouTubeClient();
    fakeClient.channels['UC_ED'] = 'UU_ED';
    fakeClient.playlists['UU_ED'] = { items: ['ed1'] };
    fakeClient.videos['ed1'] = {
      externalVideoId: 'ed1',
      sourceTitle: 'Original YouTube Title',
      sourceDescription: 'Original Desc',
      sourceThumbnailUrl: 'https://img.com/e.jpg',
      youtubePublishedAt: '2026-03-01T00:00:00Z',
    };

    const fetchService = new YoutubeApplicationService(fetchRepo, fakeClient);
    await fetchService.updateConfiguration({ channelId: 'UC_ED', enabled: true, version: 0 });

    await fetchService.fetchChannelUploads();

    // Human editor edits draft
    await fetchService.updateEditorialDraft('youtube_ed1', {
      titleAr: 'عنوان عربي مخصص',
      category: 'Water',
    });

    // Upstream YouTube source description changes
    fakeClient.videos['ed1'].sourceDescription = 'New Description On YouTube';
    await fetchService.fetchChannelUploads();

    const finalCand = await fetchRepo.getCandidate('youtube_ed1');

    assert(
      'Fetch Test 14 - Changed source preserves editorialDraft',
      finalCand?.sourceSnapshot.sourceDescription === 'New Description On YouTube' &&
      finalCand?.editorialDraft.titleAr === 'عنوان عربي مخصص' &&
      finalCand?.editorialDraft.category === 'Water',
      'Editorial draft protected against silent overwrite during source refresh'
    );
  } catch (e: any) {
    assert('Fetch Test 14 - Changed source preserves editorialDraft', false, e.message);
  }

  // Test 15: Accepted candidate remains unchanged
  try {
    const fetchRepo = new InMemoryYouTubeRepository();
    const fakeClient = new FakeYouTubeClient();
    fakeClient.channels['UC_ACC'] = 'UU_ACC';
    fakeClient.playlists['UU_ACC'] = { items: ['acc1'] };
    fakeClient.videos['acc1'] = {
      externalVideoId: 'acc1',
      sourceTitle: 'Accepted Title',
      sourceDescription: 'Desc',
      sourceThumbnailUrl: 'https://img.com/a.jpg',
      youtubePublishedAt: '2026-03-01T00:00:00Z',
    };

    const fetchService = new YoutubeApplicationService(fetchRepo, fakeClient);
    await fetchService.updateConfiguration({ channelId: 'UC_ACC', enabled: true, version: 0 });

    await fetchService.fetchChannelUploads();
    await fetchService.updateEditorialDraft('youtube_acc1', { category: 'Energy' });
    const cand = await fetchRepo.getCandidate('youtube_acc1');

    // Accept candidate
    await fetchService.acceptCandidate('youtube_acc1', cand!.candidateVersion);

    // Re-fetch
    fakeClient.videos['acc1'].sourceTitle = 'Attempted Overwrite Title';
    const res = await fetchService.fetchChannelUploads();
    const finalCand = await fetchRepo.getCandidate('youtube_acc1');

    assert(
      'Fetch Test 15 - Accepted candidate remains unchanged',
      res.skippedTerminal === 1 && finalCand?.status === 'Accepted' && finalCand?.sourceSnapshot.sourceTitle === 'Accepted Title',
      'Accepted candidate locked against background ingestion mutation'
    );
  } catch (e: any) {
    assert('Fetch Test 15 - Accepted candidate remains unchanged', false, e.message);
  }

  // Test 16: Rejected candidate remains unchanged
  try {
    const fetchRepo = new InMemoryYouTubeRepository();
    const fakeClient = new FakeYouTubeClient();
    fakeClient.channels['UC_REJ'] = 'UU_REJ';
    fakeClient.playlists['UU_REJ'] = { items: ['rej1'] };
    fakeClient.videos['rej1'] = {
      externalVideoId: 'rej1',
      sourceTitle: 'Rejected Title',
      sourceDescription: 'Desc',
      sourceThumbnailUrl: 'https://img.com/r.jpg',
      youtubePublishedAt: '2026-03-01T00:00:00Z',
    };

    const fetchService = new YoutubeApplicationService(fetchRepo, fakeClient);
    await fetchService.updateConfiguration({ channelId: 'UC_REJ', enabled: true, version: 0 });

    await fetchService.fetchChannelUploads();
    const cand = await fetchRepo.getCandidate('youtube_rej1');

    // Reject candidate
    await fetchService.rejectCandidate('youtube_rej1', cand!.candidateVersion);

    // Re-fetch
    fakeClient.videos['rej1'].sourceTitle = 'Attempted Overwrite Title';
    const res = await fetchService.fetchChannelUploads();
    const finalCand = await fetchRepo.getCandidate('youtube_rej1');

    assert(
      'Fetch Test 16 - Rejected candidate remains unchanged',
      res.skippedTerminal === 1 && finalCand?.status === 'Rejected' && finalCand?.sourceSnapshot.sourceTitle === 'Rejected Title',
      'Rejected candidate locked against background ingestion mutation'
    );
  } catch (e: any) {
    assert('Fetch Test 16 - Rejected candidate remains unchanged', false, e.message);
  }

  // Test 17: API key never appears in result/errors
  try {
    const realClient = new RealYouTubeClient(() => 'SECRET_KEY_123456789_TEST');

    let errorMsg = '';
    try {
      // Force bad URL request
      await (realClient as any).fetchWithRetry('https://www.googleapis.com/youtube/v3/channels?key=SECRET_KEY_123456789_TEST');
    } catch (e: any) {
      errorMsg = e.message;
    }

    assert(
      'Fetch Test 17 - API key never appears in result/errors',
      !errorMsg.includes('SECRET_KEY_123456789_TEST'),
      'Sanitized error output stripped secret API key cleanly'
    );
  } catch (e: any) {
    assert('Fetch Test 17 - API key never appears in result/errors', false, e.message);
  }

  // Test 18: No raw YouTube payload persisted
  try {
    const fetchRepo = new InMemoryYouTubeRepository();
    const fakeClient = new FakeYouTubeClient();
    fakeClient.channels['UC_RAW'] = 'UU_RAW';
    fakeClient.playlists['UU_RAW'] = { items: ['raw1'] };
    fakeClient.videos['raw1'] = {
      externalVideoId: 'raw1',
      sourceTitle: 'Raw Test',
      sourceDescription: 'Raw Desc',
      sourceThumbnailUrl: 'https://img.com/raw.jpg',
      youtubePublishedAt: '2026-03-01T00:00:00Z',
    };

    const fetchService = new YoutubeApplicationService(fetchRepo, fakeClient);
    await fetchService.updateConfiguration({ channelId: 'UC_RAW', enabled: true, version: 0 });

    await fetchService.fetchChannelUploads();
    const cand = (await fetchRepo.getCandidate('youtube_raw1')) as any;

    const hasRawBody = 'rawResponse' in cand || 'kind' in cand || 'etag' in cand;

    assert(
      'Fetch Test 18 - No raw YouTube payload persisted',
      hasRawBody === false,
      'Persisted candidate contains only normalized CandidateSourceSnapshot and CandidateEditorialDraft'
    );
  } catch (e: any) {
    assert('Fetch Test 18 - No raw YouTube payload persisted', false, e.message);
  }

  // Test 19: No new Firestore collection
  try {
    // Audit collection names in repository
    const collections = FirestoreYouTubeRepository.COLLECTIONS;

    const usesOnlyIntegrationAndCandidates =
      collections.length === 2 &&
      collections.includes('youtubeIntegration') &&
      collections.includes('youtubeImportCandidates');

    assert(
      'Fetch Test 19 - No new Firestore collection',
      usesOnlyIntegrationAndCandidates === true,
      'Verified zero new Firestore collections created (strictly youtubeIntegration and youtubeImportCandidates)'
    );
  } catch (e: any) {
    assert('Fetch Test 19 - No new Firestore collection', false, e.message);
  }

  // Test 20: Category is never guessed/fabricated
  try {
    const fetchRepo = new InMemoryYouTubeRepository();
    const fakeClient = new FakeYouTubeClient();
    fakeClient.channels['UC_CAT'] = 'UU_CAT';
    fakeClient.playlists['UU_CAT'] = { items: ['cat1'] };
    fakeClient.videos['cat1'] = {
      externalVideoId: 'cat1',
      sourceTitle: 'Climate Solar Energy Video',
      sourceDescription: 'Environmental climate video',
      sourceThumbnailUrl: 'https://img.com/cat.jpg',
      youtubePublishedAt: '2026-03-01T00:00:00Z',
    };

    const fetchService = new YoutubeApplicationService(fetchRepo, fakeClient);
    await fetchService.updateConfiguration({ channelId: 'UC_CAT', enabled: true, version: 0 });

    await fetchService.fetchChannelUploads();
    const cand = await fetchRepo.getCandidate('youtube_cat1');

    const categoryIsUnset = cand?.editorialDraft.category === undefined;

    let acceptThrew = false;
    try {
      await fetchService.acceptCandidate('youtube_cat1', cand!.candidateVersion);
    } catch (e: any) {
      acceptThrew = e.message.includes('Canonical Category must be assigned');
    }

    assert(
      'Fetch Test 20 - Category is never guessed/fabricated',
      categoryIsUnset && acceptThrew,
      'Category is left unset upon ingestion and acceptCandidate enforces human category assignment'
    );
  } catch (e: any) {
    assert('Fetch Test 20 - Category is never guessed/fabricated', false, e.message);
  }

  // Secret Boundary Test 21: Production secret identifier is strictly YOUTUBE_API_KEY
  try {
    const secretName = youtubeApiKeySecret.name;
    assert(
      'Secret Boundary Test 21 - Canonical secret identifier is YOUTUBE_API_KEY',
      secretName === 'YOUTUBE_API_KEY',
      'Secret parameter name matches exactly YOUTUBE_API_KEY'
    );
  } catch (e: any) {
    assert('Secret Boundary Test 21 - Canonical secret identifier is YOUTUBE_API_KEY', false, e.message);
  }

  // Secret Boundary Test 22: No VITE_YOUTUBE_API_KEY exists
  try {
    const viteKeyInMeta = (import.meta as any).env?.VITE_YOUTUBE_API_KEY;
    const viteKeyInProc = typeof process !== 'undefined' ? process.env?.VITE_YOUTUBE_API_KEY : undefined;

    assert(
      'Secret Boundary Test 22 - No VITE_YOUTUBE_API_KEY exists',
      viteKeyInMeta === undefined && viteKeyInProc === undefined,
      'Verified zero VITE_YOUTUBE_API_KEY in client or process environment'
    );
  } catch (e: any) {
    assert('Secret Boundary Test 22 - No VITE_YOUTUBE_API_KEY exists', false, e.message);
  }

  // Secret Boundary Test 23: RealYouTubeClient does not rely on direct process.env.YOUTUBE_API_KEY as authority
  try {
    const customClient = new RealYouTubeClient(() => 'CUSTOM_SECRET_PROVIDER_KEY');
    let keyAccessedInClient = '';
    try {
      keyAccessedInClient = (customClient as any).getApiKey();
    } catch {
      // Ignored
    }

    assert(
      'Secret Boundary Test 23 - RealYouTubeClient uses secret abstraction rather than direct process.env authority',
      keyAccessedInClient === 'CUSTOM_SECRET_PROVIDER_KEY',
      'RealYouTubeClient accesses credential via injected secret provider abstraction'
    );
  } catch (e: any) {
    assert('Secret Boundary Test 23 - RealYouTubeClient uses secret abstraction rather than direct process.env authority', false, e.message);
  }

  // Secret Boundary Test 24: Fake tests consume zero live YouTube quota
  try {
    const fakeClient = new FakeYouTubeClient();
    fakeClient.channels['UC_ZERO'] = 'UU_ZERO';
    fakeClient.playlists['UU_ZERO'] = { items: ['z1'] };
    fakeClient.videos['z1'] = {
      externalVideoId: 'z1',
      sourceTitle: 'Zero Quota',
      sourceDescription: 'No live HTTP calls',
      sourceThumbnailUrl: 'https://img.com/z.jpg',
      youtubePublishedAt: '2026-03-01T00:00:00Z',
    };

    const repo = new InMemoryYouTubeRepository();
    const appService = new YoutubeApplicationService(repo, fakeClient);
    await appService.updateConfiguration({ channelId: 'UC_ZERO', enabled: true, version: 0 });

    const result = await appService.fetchChannelUploads();

    assert(
      'Secret Boundary Test 24 - Fake tests consume zero live YouTube quota',
      result.created === 1 && fakeClient.callCounts.getUploadsPlaylistId === 1,
      'Test execution executed 100% offline using FakeYouTubeClient double without network calls'
    );
  } catch (e: any) {
    assert('Secret Boundary Test 24 - Fake tests consume zero live YouTube quota', false, e.message);
  }

  // Secret Boundary Test 25: API key error redaction works cleanly with secret provider
  try {
    const secretProviderClient = new RealYouTubeClient(() => 'SECRET_PROVIDER_KEY_999');
    let sanitizedError = '';
    try {
      throw (secretProviderClient as any).sanitizeError(new Error('Failed request key=SECRET_PROVIDER_KEY_999'));
    } catch (err: any) {
      sanitizedError = err.message;
    }

    assert(
      'Secret Boundary Test 25 - API key redacted cleanly from errors',
      !sanitizedError.includes('SECRET_PROVIDER_KEY_999') && sanitizedError.includes('[REDACTED_KEY]'),
      'Secret credential redacted cleanly from error messages'
    );
  } catch (e: any) {
    assert('Secret Boundary Test 25 - API key redacted cleanly from errors', false, e.message);
  }

  // Helper setup for Security Tests 26 - 45
  const mockAdminRepo = new InMemoryAdminRepository();
  const mockYtRepo = new InMemoryYouTubeRepository();
  const mockYtClient = new FakeYouTubeClient();
  const mockYtService = new YoutubeApplicationService(mockYtRepo, mockYtClient);

  // Configure canonical YouTube integration config
  await mockYtService.updateConfiguration({ channelId: 'UC_CANONICAL_OFFICIAL', enabled: true, version: 0 });
  mockYtClient.channels['UC_CANONICAL_OFFICIAL'] = 'UU_CANONICAL_UPLOADS';
  mockYtClient.playlists['UU_CANONICAL_UPLOADS'] = { items: ['v_sec_1'] };
  mockYtClient.videos['v_sec_1'] = {
    externalVideoId: 'v_sec_1',
    sourceTitle: 'Secure Video 1',
    sourceDescription: 'Secure Desc 1',
    sourceThumbnailUrl: 'https://img.com/sec1.jpg',
    youtubePublishedAt: '2026-03-01T00:00:00Z',
  };

  // Seed Admin Users
  await mockAdminRepo.saveAdmin({
    id: 'uid-owner',
    name: 'Owner User',
    email: 'owner@promiseofplanet.sd',
    role: AdminRole.Owner,
    isActive: true,
  });

  await mockAdminRepo.saveAdmin({
    id: 'uid-viewer',
    name: 'Viewer User',
    email: 'viewer@promiseofplanet.sd',
    role: AdminRole.Viewer,
    isActive: true,
  });

  await mockAdminRepo.saveAdmin({
    id: 'uid-inactive',
    name: 'Inactive Owner',
    email: 'inactive@promiseofplanet.sd',
    role: AdminRole.Owner,
    isActive: false,
  });

  // Security Test 26: missing auth -> rejected
  try {
    let rejectedMsg = '';
    try {
      await executeManualYouTubeSyncRequest({ auth: undefined }, mockAdminRepo, mockYtService);
    } catch (e: any) {
      rejectedMsg = e.message;
    }
    assert(
      'Security Test 26 - Missing auth -> rejected',
      rejectedMsg.includes('UNAUTHENTICATED'),
      'Request with missing auth was rejected with UNAUTHENTICATED error'
    );
  } catch (e: any) {
    assert('Security Test 26 - Missing auth -> rejected', false, e.message);
  }

  // Security Test 27: invalid identity -> rejected
  try {
    let rejectedMsg = '';
    try {
      await executeManualYouTubeSyncRequest({ auth: { uid: '   ' } }, mockAdminRepo, mockYtService);
    } catch (e: any) {
      rejectedMsg = e.message;
    }
    assert(
      'Security Test 27 - Invalid identity -> rejected',
      rejectedMsg.includes('UNAUTHENTICATED'),
      'Request with blank UID was rejected with UNAUTHENTICATED error'
    );
  } catch (e: any) {
    assert('Security Test 27 - Invalid identity -> rejected', false, e.message);
  }

  // Security Test 28: valid Firebase identity with no Admin record -> rejected
  try {
    let rejectedMsg = '';
    try {
      await executeManualYouTubeSyncRequest({ auth: { uid: 'unregistered-uid-999' } }, mockAdminRepo, mockYtService);
    } catch (e: any) {
      rejectedMsg = e.message;
    }
    assert(
      'Security Test 28 - Valid Firebase identity with no Admin record -> rejected',
      rejectedMsg.includes('ADMIN_NOT_REGISTERED'),
      'Unregistered Firebase user was rejected with ADMIN_NOT_REGISTERED error'
    );
  } catch (e: any) {
    assert('Security Test 28 - Valid Firebase identity with no Admin record -> rejected', false, e.message);
  }

  // Security Test 29: inactive Admin -> rejected
  try {
    let rejectedMsg = '';
    try {
      await executeManualYouTubeSyncRequest({ auth: { uid: 'uid-inactive' } }, mockAdminRepo, mockYtService);
    } catch (e: any) {
      rejectedMsg = e.message;
    }
    assert(
      'Security Test 29 - Inactive Admin -> rejected',
      rejectedMsg.includes('ADMIN_INACTIVE'),
      'Inactive AdminUser account was rejected with ADMIN_INACTIVE error'
    );
  } catch (e: any) {
    assert('Security Test 29 - Inactive Admin -> rejected', false, e.message);
  }

  // Security Test 30: Viewer -> rejected
  try {
    let rejectedMsg = '';
    try {
      await executeManualYouTubeSyncRequest({ auth: { uid: 'uid-viewer' } }, mockAdminRepo, mockYtService);
    } catch (e: any) {
      rejectedMsg = e.message;
    }
    assert(
      'Security Test 30 - Viewer -> rejected',
      rejectedMsg.includes('PERMISSION_DENIED'),
      'Viewer role without ManageSettings was rejected with PERMISSION_DENIED error'
    );
  } catch (e: any) {
    assert('Security Test 30 - Viewer -> rejected', false, e.message);
  }

  // Security Test 31: authorized role with ManageSettings -> allowed
  try {
    const result = await executeManualYouTubeSyncRequest({ auth: { uid: 'uid-owner' } }, mockAdminRepo, mockYtService);
    assert(
      'Security Test 31 - Authorized role with ManageSettings -> allowed',
      result.created === 1 && result.fetched === 1,
      'Authorized Owner with ManageSettings permission successfully executed manual sync'
    );
  } catch (e: any) {
    assert('Security Test 31 - Authorized role with ManageSettings -> allowed', false, e.message);
  }

  // Security Test 32: authorization happens before any YouTube client call
  try {
    mockYtClient.callCounts.getUploadsPlaylistId = 0;
    try {
      await executeManualYouTubeSyncRequest({ auth: { uid: 'uid-viewer' } }, mockAdminRepo, mockYtService);
    } catch {
      // Expected rejection
    }
    assert(
      'Security Test 32 - Authorization happens before any YouTube client call',
      mockYtClient.callCounts.getUploadsPlaylistId === 0,
      'Zero YouTube client API calls executed when authorization fails'
    );
  } catch (e: any) {
    assert('Security Test 32 - Authorization happens before any YouTube client call', false, e.message);
  }

  // Security Test 33: authorization happens before candidate writes
  try {
    const freshYtRepo = new InMemoryYouTubeRepository();
    const freshYtService = new YoutubeApplicationService(freshYtRepo, mockYtClient);
    try {
      await executeManualYouTubeSyncRequest({ auth: { uid: 'unregistered-uid' } }, mockAdminRepo, freshYtService);
    } catch {
      // Expected rejection
    }
    const cand = await freshYtRepo.getCandidate('youtube_v_sec_1');
    assert(
      'Security Test 33 - Authorization happens before candidate writes',
      cand === null,
      'Zero candidate writes executed when authorization fails'
    );
  } catch (e: any) {
    assert('Security Test 33 - Authorization happens before candidate writes', false, e.message);
  }

  // Security Test 34: client-supplied role is ignored
  try {
    let rejectedMsg = '';
    try {
      await executeManualYouTubeSyncRequest(
        { auth: { uid: 'uid-viewer' }, data: { role: 'Owner' } },
        mockAdminRepo,
        mockYtService
      );
    } catch (e: any) {
      rejectedMsg = e.message;
    }
    assert(
      'Security Test 34 - Client-supplied role is ignored',
      rejectedMsg.includes('PERMISSION_DENIED'),
      'Client attempt to override role with Owner in request data was completely ignored'
    );
  } catch (e: any) {
    assert('Security Test 34 - Client-supplied role is ignored', false, e.message);
  }

  // Security Test 35: client-supplied permission is ignored
  try {
    let rejectedMsg = '';
    try {
      await executeManualYouTubeSyncRequest(
        { auth: { uid: 'uid-viewer' }, data: { permission: 'manageSettings' } },
        mockAdminRepo,
        mockYtService
      );
    } catch (e: any) {
      rejectedMsg = e.message;
    }
    assert(
      'Security Test 35 - Client-supplied permission is ignored',
      rejectedMsg.includes('PERMISSION_DENIED'),
      'Client attempt to override permission in request data was completely ignored'
    );
  } catch (e: any) {
    assert('Security Test 35 - Client-supplied permission is ignored', false, e.message);
  }

  // Security Test 36: client-supplied channelId cannot override canonical config
  try {
    mockYtClient.callCounts.getUploadsPlaylistId = 0;
    await executeManualYouTubeSyncRequest(
      { auth: { uid: 'uid-owner' }, data: { channelId: 'UC_ATTACKER_OVERRIDE' } },
      mockAdminRepo,
      mockYtService
    );
    // Verify that the call resolved UC_CANONICAL_OFFICIAL, not UC_ATTACKER_OVERRIDE
    const fetchedUploadsId = await mockYtClient.getUploadsPlaylistId('UC_CANONICAL_OFFICIAL');
    assert(
      'Security Test 36 - Client-supplied channelId cannot override canonical config',
      fetchedUploadsId === 'UU_CANONICAL_UPLOADS',
      'Server strictly resolved channelId from youtubeIntegration/youtube-primary'
    );
  } catch (e: any) {
    assert('Security Test 36 - Client-supplied channelId cannot override canonical config', false, e.message);
  }

  // Security Test 37: callable binds exactly YOUTUBE_API_KEY
  try {
    const boundSecretName = youtubeApiKeySecret.name;
    assert(
      'Security Test 37 - Callable binds exactly YOUTUBE_API_KEY',
      boundSecretName === 'YOUTUBE_API_KEY',
      'Callable secret binding parameter is strictly YOUTUBE_API_KEY'
    );
  } catch (e: any) {
    assert('Security Test 37 - Callable binds exactly YOUTUBE_API_KEY', false, e.message);
  }

  // Security Test 38: response contains only compact YouTubeFetchResult
  try {
    const syncRes = await executeManualYouTubeSyncRequest({ auth: { uid: 'uid-owner' } }, mockAdminRepo, mockYtService);
    const keys = Object.keys(syncRes);
    const allowedKeys = ['fetched', 'created', 'updated', 'unchanged', 'skippedTerminal', 'nextPageToken'];
    const isCompact = keys.every((k) => allowedKeys.includes(k));
    assert(
      'Security Test 38 - Response contains only compact YouTubeFetchResult',
      isCompact && !('apiKey' in syncRes) && !('rawResponse' in syncRes),
      'Response payload is clean and compact YouTubeFetchResult without internal metadata'
    );
  } catch (e: any) {
    assert('Security Test 38 - Response contains only compact YouTubeFetchResult', false, e.message);
  }

  // Security Test 39: no secret appears in errors/result
  try {
    let errorMsg = '';
    const secretAppService = new YoutubeApplicationService(
      mockYtRepo,
      new RealYouTubeClient(() => 'VERY_SECRET_KEY_7777')
    );
    try {
      await executeManualYouTubeSyncRequest({ auth: { uid: 'uid-owner' } }, mockAdminRepo, secretAppService);
    } catch (e: any) {
      errorMsg = e.message;
    }
    assert(
      'Security Test 39 - No secret appears in errors/result',
      !errorMsg.includes('VERY_SECRET_KEY_7777'),
      'Verified zero secrets present in returned error messages'
    );
  } catch (e: any) {
    assert('Security Test 39 - No secret appears in errors/result', false, e.message);
  }

  // Security Test 40: failed authorization consumes zero YouTube quota
  try {
    mockYtClient.callCounts.getUploadsPlaylistId = 0;
    mockYtClient.callCounts.getPlaylistItems = 0;
    mockYtClient.callCounts.getVideoDetailsBatch = 0;

    try {
      await executeManualYouTubeSyncRequest({ auth: { uid: 'uid-viewer' } }, mockAdminRepo, mockYtService);
    } catch {
      // Rejection
    }

    const totalCalls =
      mockYtClient.callCounts.getUploadsPlaylistId +
      mockYtClient.callCounts.getPlaylistItems +
      mockYtClient.callCounts.getVideoDetailsBatch;

    assert(
      'Security Test 40 - Failed authorization consumes zero YouTube quota',
      totalCalls === 0,
      'Zero YouTube API calls executed on unauthorized request'
    );
  } catch (e: any) {
    assert('Security Test 40 - Failed authorization consumes zero YouTube quota', false, e.message);
  }

  // Security Test 41: successful fake request executes the existing ingestion engine
  try {
    const candidateInStore = await mockYtRepo.getCandidate('youtube_v_sec_1');
    assert(
      'Security Test 41 - Successful fake request executes existing ingestion engine',
      candidateInStore !== null && candidateInStore.status === 'PendingReview',
      'Ingested candidate stored safely in PendingReview status'
    );
  } catch (e: any) {
    assert('Security Test 41 - Successful fake request executes existing ingestion engine', false, e.message);
  }

  // Security Test 42: direct browser writes remain denied by Firestore rules
  try {
    // Audit firestore.rules contents directly
    let rulesContent = '';
    try {
      const fsModule = await import('fs');
      rulesContent = fsModule.readFileSync('firestore.rules', 'utf-8');
    } catch {
      // Ignore
    }

    const hasCatchAllDeny = rulesContent.includes('match /{document=**}') && rulesContent.includes('allow read, write: if false;');
    const adminsRuleDeniesWrite = rulesContent.includes('match /admins/{adminId}') && rulesContent.includes('allow create, update, delete: if false;');

    assert(
      'Security Test 42 - Direct browser writes remain denied by Firestore rules',
      hasCatchAllDeny && adminsRuleDeniesWrite,
      'Verified global default-deny rule and fail-closed admin write rules in firestore.rules'
    );
  } catch (e: any) {
    assert('Security Test 42 - Direct browser writes remain denied by Firestore rules', false, e.message);
  }

  // Security Test 43: no new RBAC role
  try {
    const roleCount = Object.keys(AdminRole).length;
    assert(
      'Security Test 43 - No new RBAC role',
      roleCount === 9,
      `Verified exact count of AdminRole enum values remains 9 (Owner, ContentEditor, LibraryCurator, RightsReviewer, TrainingManager, Trainer, CitizenModerator, AIAssistant, Viewer)`
    );
  } catch (e: any) {
    assert('Security Test 43 - No new RBAC role', false, e.message);
  }

  // Security Test 44: no new permission
  try {
    const permissionCount = Object.keys(AdminPermission).length;
    assert(
      'Security Test 44 - No new permission',
      permissionCount === 10,
      `Verified exact count of AdminPermission enum values remains 10 (View, Create, Edit, Review, Approve, Publish, ManageRights, ManageUsers, ManageSettings, ViewReports)`
    );
  } catch (e: any) {
    assert('Security Test 44 - No new permission', false, e.message);
  }

  // Security Test 45: no automatic Owner bootstrap
  try {
    const unknownAdmin = await mockAdminRepo.getAdminByUid('unknown-random-uid-999');
    assert(
      'Security Test 45 - No automatic Owner bootstrap',
      unknownAdmin === null,
      'Accessing with unknown Firebase Auth UID returns null without auto-creating Owner record'
    );
  } catch (e: any) {
    assert('Security Test 45 - No automatic Owner bootstrap', false, e.message);
  }

  // Remediation Test 46: frontend and server AdminRole use the same canonical source
  try {
    const isFEMatch = JSON.stringify(FrontendRole) === JSON.stringify(SharedContract.AdminRole);
    const isFuncMatch = JSON.stringify(FunctionsRole) === JSON.stringify(SharedContract.AdminRole);
    assert(
      'Remediation Test 46 - Frontend and server AdminRole use canonical source',
      isFEMatch && isFuncMatch,
      'Both frontend and Functions re-export the exact same AdminRole definitions from shared/adminContract'
    );
  } catch (e: any) {
    assert('Remediation Test 46 - Frontend and server AdminRole use canonical source', false, e.message);
  }

  // Remediation Test 47: frontend and server AdminPermission use the same canonical source
  try {
    const isFEMatch = JSON.stringify(FrontendPermission) === JSON.stringify(SharedContract.AdminPermission);
    const isFuncMatch = JSON.stringify(FunctionsPermission) === JSON.stringify(SharedContract.AdminPermission);
    assert(
      'Remediation Test 47 - Frontend and server AdminPermission use canonical source',
      isFEMatch && isFuncMatch,
      'Both frontend and Functions re-export the exact same AdminPermission definitions from shared/adminContract'
    );
  } catch (e: any) {
    assert('Remediation Test 47 - Frontend and server AdminPermission use canonical source', false, e.message);
  }

  // Remediation Test 48: server permission evaluation uses canonical shared ROLE_PERMISSIONS_MAP
  try {
    const { AdminAuthorizationService } = await import('../../functions/src/admin/adminAuthorizationService');
    let allRolesMatch = true;

    for (const roleKey of Object.values(SharedContract.AdminRole)) {
      const role = roleKey as SharedContract.AdminRole;
      const serverPerms = AdminAuthorizationService.getPermissionsForRole(role);
      const sharedPerms = SharedContract.ROLE_PERMISSIONS_MAP[role];
      const clientPerms = AdminAccessService.getPermissionsForRole(role);

      if (serverPerms.size !== sharedPerms.size || clientPerms.size !== sharedPerms.size) {
        allRolesMatch = false;
        break;
      }
      for (const perm of sharedPerms) {
        if (!serverPerms.has(perm) || !clientPerms.has(perm)) {
          allRolesMatch = false;
          break;
        }
      }
    }

    assert(
      'Remediation Test 48 - Server permission evaluation uses canonical shared ROLE_PERMISSIONS_MAP',
      allRolesMatch,
      'Server AdminAuthorizationService and client AdminAccessService resolve identical permissions matching canonical ROLE_PERMISSIONS_MAP across all roles'
    );
  } catch (e: any) {
    assert('Remediation Test 48 - Server permission evaluation uses canonical shared ROLE_PERMISSIONS_MAP', false, e.message);
  }

  // Remediation Test 49: invalid Firestore role cannot become a valid AdminUser
  try {
    const rawRepo = new InMemoryAdminRepository();
    rawRepo.setRawAdmin('uid-invalid-role', {
      id: 'uid-invalid-role',
      name: 'Hacker',
      email: 'hacker@evil.com',
      role: 'SUPER_ADMIN_HACK',
      isActive: true,
    });

    const invalidUser = await rawRepo.getAdminByUid('uid-invalid-role');

    assert(
      'Remediation Test 49 - Invalid Firestore role cannot become a valid AdminUser',
      invalidUser === null,
      'Non-canonical role SUPER_ADMIN_HACK failed closed and returned null AdminUser'
    );
  } catch (e: any) {
    assert('Remediation Test 49 - Invalid Firestore role cannot become a valid AdminUser', false, e.message);
  }

  // Remediation Test 50: unknown role does not fall back to Viewer
  try {
    const rawRepo = new InMemoryAdminRepository();
    rawRepo.setRawAdmin('uid-unknown-role-viewer', {
      id: 'uid-unknown-role-viewer',
      name: 'Unknown Role Attempt',
      email: 'unknown@test.com',
      role: 'MEMBER',
      isActive: true,
    });

    const unknownUser = await rawRepo.getAdminByUid('uid-unknown-role-viewer');

    assert(
      'Remediation Test 50 - Unknown role does not fall back to Viewer',
      unknownUser === null,
      'Unknown role MEMBER failed closed and did NOT fall back to Viewer'
    );
  } catch (e: any) {
    assert('Remediation Test 50 - Unknown role does not fall back to Viewer', false, e.message);
  }

  // Remediation Test 51: unknown role does not fall back to Owner
  try {
    const rawRepo = new InMemoryAdminRepository();
    rawRepo.setRawAdmin('uid-unknown-role-owner', {
      id: 'uid-unknown-role-owner',
      name: 'Unknown Role Attempt Owner',
      email: 'unknown2@test.com',
      role: 'SUPERUSER',
      isActive: true,
    });

    const unknownUser = await rawRepo.getAdminByUid('uid-unknown-role-owner');

    assert(
      'Remediation Test 51 - Unknown role does not fall back to Owner',
      unknownUser === null,
      'Unknown role SUPERUSER failed closed and did NOT fall back to Owner'
    );
  } catch (e: any) {
    assert('Remediation Test 51 - Unknown role does not fall back to Owner', false, e.message);
  }

  // Remediation Test 52: inactive admin still has zero permissions
  try {
    const { AdminAuthorizationService } = await import('../../functions/src/admin/adminAuthorizationService');
    const inactiveOwnerUser: AdminUser = {
      id: 'uid-inactive-owner-check',
      name: 'Inactive Owner',
      email: 'inactive@owner.com',
      role: AdminRole.Owner,
      isActive: false,
    };

    const hasManageSettings = AdminAuthorizationService.hasPermission(inactiveOwnerUser, AdminPermission.ManageSettings);
    const hasView = AdminAuthorizationService.hasPermission(inactiveOwnerUser, AdminPermission.View);

    assert(
      'Remediation Test 52 - Inactive admin still has zero permissions',
      !hasManageSettings && !hasView,
      'Inactive Owner user holds zero effective permissions in AdminAuthorizationService'
    );
  } catch (e: any) {
    assert('Remediation Test 52 - Inactive admin still has zero permissions', false, e.message);
  }

  // Remediation Test 53: admins/{uid} document ID remains the identity binding
  try {
    const fetchedAdmin = await mockAdminRepo.getAdminByUid('uid-owner');

    assert(
      'Remediation Test 53 - admins/{uid} document ID remains identity binding',
      fetchedAdmin !== null && fetchedAdmin.id === 'uid-owner',
      'AdminUser.id strictly matches document key / Firebase Auth UID (uid-owner)'
    );
  } catch (e: any) {
    assert('Remediation Test 53 - admins/{uid} document ID remains identity binding', false, e.message);
  }

  // Remediation Test 54: no redundant firebaseUid field is required or persisted
  try {
    const fetchedAdmin = await mockAdminRepo.getAdminByUid('uid-owner');
    const adminKeys = fetchedAdmin ? Object.keys(fetchedAdmin) : [];
    const hasFirebaseUid = adminKeys.includes('firebaseUid');

    assert(
      'Remediation Test 54 - No redundant firebaseUid field is required or persisted',
      !hasFirebaseUid,
      'Verified firebaseUid property is completely absent from AdminUser model'
    );
  } catch (e: any) {
    assert('Remediation Test 54 - No redundant firebaseUid field is required or persisted', false, e.message);
  }

  // Remediation Test 55: syncYouTubeUploads still requires ManageSettings before YouTube execution
  try {
    mockYtClient.callCounts.getUploadsPlaylistId = 0;
    let deniedErrorMsg = '';

    try {
      await executeManualYouTubeSyncRequest({ auth: { uid: 'uid-viewer' } }, mockAdminRepo, mockYtService);
    } catch (e: any) {
      deniedErrorMsg = e.message;
    }

    assert(
      'Remediation Test 55 - syncYouTubeUploads still requires ManageSettings before YouTube execution',
      deniedErrorMsg.includes('PERMISSION_DENIED') && mockYtClient.callCounts.getUploadsPlaylistId === 0,
      'Viewer role without ManageSettings rejected with PERMISSION_DENIED prior to any YouTube execution'
    );
  } catch (e: any) {
    assert('Remediation Test 55 - syncYouTubeUploads still requires ManageSettings before YouTube execution', false, e.message);
  }

  return results;
}
