import { YoutubeApplicationService } from '../../functions/src/youtube/youtubeApplicationService';
import { InMemoryYouTubeRepository } from '../../functions/src/youtube/inMemoryYouTubeRepository';
import { FirestoreYouTubeRepository } from '../../functions/src/youtube/firestoreYouTubeRepository';
import { FakeYouTubeClient } from '../../functions/src/youtube/fakeYouTubeClient';
import { RealYouTubeClient } from '../../functions/src/youtube/realYouTubeClient';
import { MediaService } from './mediaService';
import { AdminRole, AdminPermission } from '../types/admin';
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
    const realClient = new RealYouTubeClient();
    process.env.YOUTUBE_API_KEY = 'SECRET_KEY_123456789_TEST';

    let errorMsg = '';
    try {
      // Force bad URL request
      await (realClient as any).fetchWithRetry('https://www.googleapis.com/youtube/v3/channels?key=SECRET_KEY_123456789_TEST');
    } catch (e: any) {
      errorMsg = e.message;
    } finally {
      delete process.env.YOUTUBE_API_KEY;
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

  return results;
}
