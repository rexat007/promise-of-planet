import { FakeYouTubeClient } from '../../functions/src/youtube/fakeYouTubeClient';
import { InMemoryYouTubeRepository } from '../../functions/src/youtube/inMemoryYouTubeRepository';
import { InMemoryMediaRepository } from '../../functions/src/media/inMemoryMediaRepository';
import { PublicMediaRepository } from '../../functions/src/media/publicMediaRepository';
import { YoutubeApplicationService } from '../../functions/src/youtube/youtubeApplicationService';
import { isVideoVisibleInMediaHub } from './contentVisibility';
import { PublicMediaClient, sanitizePublicMultimediaPayload } from './publicMediaClient';
import type { Video, CanonicalPlaylist } from '../types';
import type { YouTubePlaylist, YouTubePlaylistItemWithDetails } from '../../functions/src/types/youtube';
import * as fs from 'fs';

export interface TestResult {
  test: string;
  passed: boolean;
  details?: string;
}

export async function runMultimediaFunctionalVerification(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  function assert(name: string, condition: boolean, details?: string) {
    results.push({
      test: name,
      passed: condition,
      details: condition ? details || 'PASSED' : details || 'FAILED',
    });
  }

  // Setup test fixtures
  const fakeYt = new FakeYouTubeClient();
  const inMemoryYtRepo = new InMemoryYouTubeRepository();
  const inMemoryMediaRepo = new InMemoryMediaRepository();
  const appService = new YoutubeApplicationService(inMemoryYtRepo, fakeYt, inMemoryMediaRepo);

  // Configure primary channel
  await inMemoryYtRepo.saveConfiguration({
    id: 'youtube-primary',
    channelId: 'UC_POP_OFFICIAL',
    enabled: true,
    updatedAt: new Date().toISOString(),
    version: 1,
  });

  // Mock Playlists
  const mockPlaylists: YouTubePlaylist[] = [
    {
      id: 'PL_COP28',
      title: 'مؤتمر المناخ COP28',
      description: 'تغطيات خاصة لمفاوضات المناخ',
      thumbnailUrl: 'https://i.ytimg.com/vi/mock1/hqdefault.jpg',
      itemCount: 2,
      publishedAt: '2023-11-30T10:00:00Z',
    },
    {
      id: 'PL_FIELD',
      title: 'تحقيقات ميدانية',
      description: 'توثيق قضايا التصحر ونقص المياه',
      thumbnailUrl: 'https://i.ytimg.com/vi/mock2/hqdefault.jpg',
      itemCount: 1,
      publishedAt: '2023-10-01T10:00:00Z',
    },
  ];
  fakeYt.channelPlaylists['UC_POP_OFFICIAL'] = mockPlaylists;

  // Mock Playlist Memberships with explicit addedToPlaylistAt timestamps
  const plCop28Items: YouTubePlaylistItemWithDetails[] = [
    {
      videoId: 'vid_cop_01',
      playlistItemId: 'item_cop_01',
      position: 0,
      addedToPlaylistAt: '2023-12-05T14:30:00Z', // Added to playlist on Dec 5
    },
    {
      videoId: 'vid_cop_02',
      playlistItemId: 'item_cop_02',
      position: 1,
      addedToPlaylistAt: '2023-12-06T10:00:00Z',
    },
  ];
  fakeYt.playlistMemberships['PL_COP28'] = { items: plCop28Items };

  const plFieldItems: YouTubePlaylistItemWithDetails[] = [
    {
      videoId: 'vid_field_01',
      playlistItemId: 'item_field_01',
      position: 0,
      addedToPlaylistAt: '2023-10-15T09:00:00Z',
    },
  ];
  fakeYt.playlistMemberships['PL_FIELD'] = { items: plFieldItems };

  // Mock Video details batch with TRUE original publication dates (different from playlist addition)
  fakeYt.videos['vid_cop_01'] = {
    externalVideoId: 'vid_cop_01',
    sourceTitle: 'افتتاحية مؤتمر COP28',
    sourceDescription: 'تقرير اليوم الأول من مؤتمر الأطراف',
    sourceThumbnailUrl: 'https://i.ytimg.com/vi/vid_cop_01/hqdefault.jpg',
    youtubePublishedAt: '2023-12-01T08:00:00Z', // Original YouTube upload date!
  };
  fakeYt.videos['vid_cop_02'] = {
    externalVideoId: 'vid_cop_02',
    sourceTitle: 'تمويل الخسائر والأضرار',
    sourceDescription: 'تحليل صندوق تمويل الخسائر والأضرار البيئية',
    sourceThumbnailUrl: 'https://i.ytimg.com/vi/vid_cop_02/hqdefault.jpg',
    youtubePublishedAt: '2023-12-02T12:00:00Z',
  };
  fakeYt.videos['vid_field_01'] = {
    externalVideoId: 'vid_field_01',
    sourceTitle: 'أزمة الجفاف في الشرق',
    sourceDescription: 'تحقيق استقصائي عن الجفاف',
    sourceThumbnailUrl: 'https://i.ytimg.com/vi/vid_field_01/hqdefault.jpg',
    youtubePublishedAt: '2023-10-10T16:00:00Z',
  };

  // ---------------------------------------------------------------------------
  // Test 1: YouTube Channel Playlist Discovery
  // ---------------------------------------------------------------------------
  try {
    const discovered = await fakeYt.getChannelPlaylists('UC_POP_OFFICIAL');
    assert(
      'Test 1 - Channel Playlist Discovery',
      discovered.length === 2 && discovered[0].id === 'PL_COP28',
      `Discovered ${discovered.length} playlists for channel UC_POP_OFFICIAL`
    );
  } catch (err: any) {
    assert('Test 1 - Channel Playlist Discovery', false, err.message);
  }

  // ---------------------------------------------------------------------------
  // Test 2: Playlist Membership Retrieval
  // ---------------------------------------------------------------------------
  try {
    const memberships = await fakeYt.getPlaylistMemberships('PL_COP28');
    assert(
      'Test 2 - Playlist Membership Retrieval',
      memberships.items.length === 2 && memberships.items[0].videoId === 'vid_cop_01',
      `Retrieved ${memberships.items.length} items from PL_COP28`
    );
  } catch (err: any) {
    assert('Test 2 - Playlist Membership Retrieval', false, err.message);
  }

  // ---------------------------------------------------------------------------
  // Test 3: Sync Channel Playlists & Separation of Timestamps
  // ---------------------------------------------------------------------------
  try {
    const syncRes = await appService.syncChannelPlaylists();
    assert(
      'Test 3 - Sync Channel Playlists Orchestration',
      syncRes.playlistsDiscovered === 2 && syncRes.videosIngested === 3 && syncRes.itemsAssociated === 3,
      `Playlists discovered: ${syncRes.playlistsDiscovered}, Videos ingested: ${syncRes.videosIngested}`
    );

    // Verify Candidate has true video publishedAt (not playlist-addition date)
    const candidate = await inMemoryYtRepo.getCandidate('youtube_vid_cop_01');
    assert(
      'Test 3b - Separate Video Published Date from Playlist Addition Date',
      candidate !== null && candidate.sourceSnapshot.youtubePublishedAt === '2023-12-01T08:00:00Z',
      `Candidate preserved true video publishedAt: ${candidate?.sourceSnapshot.youtubePublishedAt} (distinct from playlist added: 2023-12-05T14:30:00Z)`
    );

    // Verify candidate was ingested as PendingReview (never auto-published)
    assert(
      'Test 3c - Candidate Ingestion Isolation (Advisory / PendingReview)',
      candidate?.status === 'PendingReview',
      `Candidate status is strictly PendingReview; human review preserved.`
    );

    // Verify CanonicalPlaylist was persisted
    const savedPlaylist = await inMemoryMediaRepo.getPlaylistById('playlist_yt_PL_COP28');
    assert(
      'Test 3d - Canonical Playlist Persistence',
      savedPlaylist !== null && savedPlaylist.videoIds.includes('video_yt_vid_cop_01'),
      `Playlist PL_COP28 persisted with canonical video IDs: ${savedPlaylist?.videoIds.join(', ')}`
    );
  } catch (err: any) {
    assert('Test 3 - Sync Channel Playlists Orchestration', false, err.message);
  }

  // ---------------------------------------------------------------------------
  // Test 4: Deduplication of Video Candidates across Multiple Playlists
  // ---------------------------------------------------------------------------
  try {
    // Add same video 'vid_cop_01' to another playlist
    fakeYt.channelPlaylists['UC_POP_OFFICIAL'].push({
      id: 'PL_HIGHLIGHTS',
      title: 'مقتطفات مميزة',
      description: 'أفضل اللقطات',
      thumbnailUrl: '',
      itemCount: 1,
      publishedAt: '2023-12-10T00:00:00Z',
    });
    fakeYt.playlistMemberships['PL_HIGHLIGHTS'] = {
      items: [{ videoId: 'vid_cop_01', addedToPlaylistAt: '2023-12-10T12:00:00Z' }],
    };

    const syncRes2 = await appService.syncChannelPlaylists();
    // vid_cop_01 is already ingested, so videosIngested should be 0 for this run
    assert(
      'Test 4 - Video Deduplication across Playlists',
      syncRes2.videosIngested === 0,
      `No duplicate candidate created for existing vid_cop_01`
    );
  } catch (err: any) {
    assert('Test 4 - Video Deduplication across Playlists', false, err.message);
  }

  // ---------------------------------------------------------------------------
  // Test 5: Canonical Visibility Filtering Engine (isVideoVisibleInMediaHub)
  // ---------------------------------------------------------------------------
  const baseValidVideo: Video = {
    id: 'video-valid-01',
    contentType: 'Video',
    status: 'Published',
    approvalStatus: 'Approved',
    rightsStatus: 'Cleared',
    visibilityDecision: 'Featured',
    category: 'Climate',
    titleAr: 'تغطية بيئية معتمدة',
    titleEn: 'Verified Environmental Coverage',
    excerptAr: 'موجز المادة',
    editorialDescriptionAr: 'الوصف الكامل',
    tags: ['مناخ'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    youtubeSource: {
      youtubeVideoId: 'valid123',
      youtubeUrl: 'https://youtube.com/watch?v=valid123',
      originalTitle: 'Original Title',
      originalDescription: 'Original Desc',
      youtubePublishedAt: '2023-01-01T00:00:00Z',
      availabilityStatus: 'Available',
      thumbnails: {},
    },
  };

  // 5a: Fully cleared published video -> VISIBLE
  const resValid = isVideoVisibleInMediaHub(baseValidVideo, 'ar');
  assert('Test 5a - Canonical Visibility (Fully Cleared & Published)', resValid.visible);

  // 5b: Draft video -> HIDDEN
  const resDraft = isVideoVisibleInMediaHub({ ...baseValidVideo, status: 'Draft' }, 'ar');
  assert('Test 5b - Visibility Filter: Rejects Drafts', !resDraft.visible && resDraft.reason === 'NOT_PUBLISHED');

  // 5c: Unapproved video -> HIDDEN
  const resUnapproved = isVideoVisibleInMediaHub({ ...baseValidVideo, approvalStatus: 'Pending' }, 'ar');
  assert('Test 5c - Visibility Filter: Rejects Unapproved', !resUnapproved.visible && resUnapproved.reason === 'NOT_APPROVED');

  // 5d: Rights not cleared -> HIDDEN
  const resRights = isVideoVisibleInMediaHub({ ...baseValidVideo, rightsStatus: 'NotStarted' }, 'ar');
  assert('Test 5d - Visibility Filter: Rejects Rights Not Cleared', !resRights.visible && resRights.reason === 'RIGHTS_NOT_CLEARED');

  // 5e: Editorial Hidden decision -> HIDDEN
  const resHidden = isVideoVisibleInMediaHub({ ...baseValidVideo, visibilityDecision: 'Hidden' }, 'ar');
  assert('Test 5e - Visibility Filter: Rejects Hidden Visibility Decision', !resHidden.visible && resHidden.reason === 'HIDDEN_BY_EDITORIAL_DECISION');

  // 5f: Private/Unavailable YouTube video -> HIDDEN
  const resPrivate = isVideoVisibleInMediaHub({
    ...baseValidVideo,
    youtubeSource: { ...baseValidVideo.youtubeSource, availabilityStatus: 'Private' },
  }, 'ar');
  assert('Test 5f - Visibility Filter: Rejects Private/Unavailable Video', !resPrivate.visible && resPrivate.reason === 'VIDEO_NOT_AVAILABLE');

  // ---------------------------------------------------------------------------
  // Test 6: PublicMediaClient Fail-Closed Production Behavior (No Mock Fallback)
  // ---------------------------------------------------------------------------
  try {
    let threw = false;
    try {
      await PublicMediaClient.fetchPublicMultimedia('ar');
    } catch {
      threw = true;
    }
    assert(
      'Test 6 - PublicMediaClient Fail-Closed on Firestore Permission Error (No Mock Leak)',
      threw,
      'PublicMediaClient correctly threw error instead of falling back to mock fixtures'
    );
  } catch (err: any) {
    assert('Test 6 - PublicMediaClient Integration', false, err.message);
  }

  // ---------------------------------------------------------------------------
  // Test 7: PublicMediaRepository Server-Side Eligibility Filtering
  // ---------------------------------------------------------------------------
  const pubMediaSeedRepo = new InMemoryMediaRepository();
  const publicMediaRepo = new PublicMediaRepository(pubMediaSeedRepo);

  const eligibleSeedVideo: Video & Record<string, unknown> = {
    ...baseValidVideo,
    id: 'video_yt_eligible_01',
    titleEn: 'Verified Coverage EN',
    excerptEn: 'Excerpt EN',
    editorialDescriptionEn: 'Description EN',
    producer: 'Environmental Documentary Unit',
    author: 'Internal Author Identity',
    editor: 'admin_editor_uid_01',
    rightsNotes: 'INTERNAL LEGAL CLEARANCE NOTE - DO NOT LEAK',
    reviewNotes: 'INTERNAL EDITORIAL REVIEW NOTE - DO NOT LEAK',
    translationStatus: 'Completed',
    playlistIds: ['playlist_yt_internal'],
    _relations: [{ id: 'rel_1', contentId: 'news_1', videoId: 'video_yt_eligible_01' }],
    sources: [
      {
        id: 'src_unsafe',
        sourceName: 'Unsafe Link Source',
        sourceType: 'OfficialGovernment',
        sourceUrl: 'javascript:alert(1)',
      },
      {
        id: 'src_safe',
        sourceName: 'Ministry of Environment Report',
        sourceType: 'OfficialGovernment',
        sourceUrl: 'https://environment.gov.sd/report-2026',
        isPrimarySource: true,
      },
    ],
    youtubeSource: {
      ...baseValidVideo.youtubeSource,
      youtubeVideoId: 'eligible_01',
      lastSyncedAt: '2026-03-01T00:00:00Z',
    },
  };

  await pubMediaSeedRepo.createVideo(eligibleSeedVideo as Video);
  await pubMediaSeedRepo.createVideo({
    ...baseValidVideo,
    id: 'video_yt_draft_02',
    status: 'Draft',
    youtubeSource: { ...baseValidVideo.youtubeSource, youtubeVideoId: 'draft_02' },
  });
  await pubMediaSeedRepo.createVideo({
    ...baseValidVideo,
    id: 'video_yt_unapproved_03',
    approvalStatus: 'Pending',
    youtubeSource: { ...baseValidVideo.youtubeSource, youtubeVideoId: 'unapproved_03' },
  });
  await pubMediaSeedRepo.createVideo({
    ...baseValidVideo,
    id: 'video_yt_uncleared_04',
    rightsStatus: 'InReview',
    youtubeSource: { ...baseValidVideo.youtubeSource, youtubeVideoId: 'uncleared_04' },
  });
  await pubMediaSeedRepo.createVideo({
    ...baseValidVideo,
    id: 'video_yt_hidden_05',
    visibilityDecision: 'Hidden',
    youtubeSource: { ...baseValidVideo.youtubeSource, youtubeVideoId: 'hidden_05' },
  });
  await pubMediaSeedRepo.createVideo({
    ...baseValidVideo,
    id: 'video_yt_private_06',
    youtubeSource: {
      ...baseValidVideo.youtubeSource,
      youtubeVideoId: 'private_06',
      availabilityStatus: 'Private',
    },
  });

  try {
    const publicVideos = await publicMediaRepo.listPublicVideos();
    assert(
      'Test 7 - PublicMediaRepository Server-Side Eligibility Filtering',
      publicVideos.length === 1 && publicVideos[0].id === 'video_yt_eligible_01',
      `Returned ${publicVideos.length} eligible video(s); rejected Draft, Pending, InReview, Hidden, and Private records`
    );

    // ---------------------------------------------------------------------------
    // Test 8: PublicMediaRepository DTO Allowlist Sanitization (No Internal Leak)
    // ---------------------------------------------------------------------------
    const pubVid = publicVideos[0] as unknown as Record<string, any>;
    const noInternalFields =
      !('rightsNotes' in pubVid) &&
      !('reviewNotes' in pubVid) &&
      !('editor' in pubVid) &&
      !('author' in pubVid) &&
      !('translationStatus' in pubVid) &&
      !('_relations' in pubVid) &&
      !('playlistIds' in pubVid) &&
      !('lastSyncedAt' in (pubVid.youtubeSource || {}));
    const unsafeUrlStripped =
      Array.isArray(pubVid.sources) &&
      pubVid.sources.length === 2 &&
      !('sourceUrl' in pubVid.sources[0]) &&
      pubVid.sources[1].sourceUrl === 'https://environment.gov.sd/report-2026';

    assert(
      'Test 8 - PublicMediaRepository DTO Allowlist Sanitization',
      noInternalFields && unsafeUrlStripped && pubVid.producer === 'Environmental Documentary Unit',
      'Stripped rightsNotes, reviewNotes, editor, author, translationStatus, _relations, playlistIds, lastSyncedAt, and unsafe URLs'
    );
  } catch (err: any) {
    assert('Test 7 - PublicMediaRepository Server-Side Eligibility Filtering', false, err.message);
    assert('Test 8 - PublicMediaRepository DTO Allowlist Sanitization', false, err.message);
  }

  // ---------------------------------------------------------------------------
  // Test 9: PublicMediaRepository Playlist Filtering & Sanitization
  // ---------------------------------------------------------------------------
  try {
    const publishedMixedPlaylist: CanonicalPlaylist & Record<string, unknown> = {
      id: 'playlist_yt_mixed',
      externalPlaylistId: 'PL_MIXED',
      titleAr: 'سلسلة تحقيقات المناخ',
      titleEn: 'Climate Investigations Series',
      descriptionAr: 'تغطيات مرئية معتمدة',
      descriptionEn: 'Verified visual coverage',
      thumbnailUrl: 'https://i.ytimg.com/vi/eligible_01/hqdefault.jpg',
      itemCount: 3,
      status: 'Published',
      videoIds: ['video_yt_eligible_01', 'video_yt_draft_02', 'video_yt_hidden_05'],
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
      _internalNotes: 'INTERNAL PLAYLIST CURATION NOTE',
    };

    const publishedEmptyEligiblePlaylist: CanonicalPlaylist = {
      id: 'playlist_yt_only_drafts',
      titleAr: 'قائمة مسودات فقط',
      descriptionAr: 'لا تحتوي على فيديو منشور',
      itemCount: 1,
      status: 'Published',
      videoIds: ['video_yt_draft_02'],
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    };

    const draftPlaylist: CanonicalPlaylist = {
      id: 'playlist_yt_draft_pl',
      titleAr: 'قائمة قيد الإعداد',
      descriptionAr: 'مسودة قائمة',
      itemCount: 1,
      status: 'Draft',
      videoIds: ['video_yt_eligible_01'],
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    };

    await pubMediaSeedRepo.createPlaylist(publishedMixedPlaylist as CanonicalPlaylist);
    await pubMediaSeedRepo.createPlaylist(publishedEmptyEligiblePlaylist);
    await pubMediaSeedRepo.createPlaylist(draftPlaylist);

    const publicPlaylists = await publicMediaRepo.listPublicPlaylists();
    const pl = publicPlaylists[0] as unknown as Record<string, any>;
    assert(
      'Test 9 - PublicMediaRepository Playlist Filtering & Sanitization',
      publicPlaylists.length === 1 &&
        pl.id === 'playlist_yt_mixed' &&
        pl.videoIds.length === 1 &&
        pl.videoIds[0] === 'video_yt_eligible_01' &&
        pl.itemCount === 1 &&
        !('_internalNotes' in pl),
      'Filtered out Draft playlists, playlists with zero eligible videos, non-public videoIds, and internal playlist fields'
    );
  } catch (err: any) {
    assert('Test 9 - PublicMediaRepository Playlist Filtering & Sanitization', false, err.message);
  }

  // ---------------------------------------------------------------------------
  // Test 10: PublicMediaClient Defense-in-Depth Payload Sanitization
  // ---------------------------------------------------------------------------
  try {
    const sanitizedClientData = sanitizePublicMultimediaPayload(
      {
        videos: [
          eligibleSeedVideo,
          { ...baseValidVideo, id: 'video_yt_draft_leak', status: 'Draft' },
        ],
        playlists: [
          {
            id: 'playlist_yt_client_test',
            titleAr: 'قائمة اختبار',
            descriptionAr: 'وصف',
            itemCount: 2,
            status: 'Published',
            videoIds: ['video_yt_eligible_01', 'video_yt_draft_leak'],
            createdAt: '2026-03-01T00:00:00Z',
            updatedAt: '2026-03-01T00:00:00Z',
          },
        ],
      },
      'ar'
    );

    const clientVid = sanitizedClientData.videos[0] as unknown as Record<string, any>;
    assert(
      'Test 10 - PublicMediaClient Defense-in-Depth Sanitization',
      sanitizedClientData.videos.length === 1 &&
        !('rightsNotes' in clientVid) &&
        !('reviewNotes' in clientVid) &&
        !('editor' in clientVid) &&
        !('_relations' in clientVid) &&
        sanitizedClientData.playlists.length === 1 &&
        sanitizedClientData.playlists[0].videoIds.length === 1 &&
        sanitizedClientData.playlists[0].videoIds[0] === 'video_yt_eligible_01',
      'Client boundary strips internal fields and non-eligible videos/playlists as defense-in-depth'
    );
  } catch (err: any) {
    assert('Test 10 - PublicMediaClient Defense-in-Depth Sanitization', false, err.message);
  }

  // ---------------------------------------------------------------------------
  // Test 11: Callable Protocol Alignment (getPublicMultimedia uses onCall)
  // ---------------------------------------------------------------------------
  try {
    const indexSource = fs.readFileSync('functions/src/index.ts', 'utf-8');
    const clientSource = fs.readFileSync('src/services/publicMediaClient.ts', 'utf-8');
    const usesOnCallInIndex =
      /export\s+const\s+getPublicMultimedia\s*=\s*onCall\(/.test(indexSource) &&
      !/export\s+const\s+getPublicMultimedia\s*=\s*onRequest\(/.test(indexSource);
    const usesHttpsCallableInClient =
      clientSource.includes('httpsCallable') && clientSource.includes("'getPublicMultimedia'");

    assert(
      'Test 11 - Callable Protocol Alignment (getPublicMultimedia onCall <-> httpsCallable)',
      usesOnCallInIndex && usesHttpsCallableInClient,
      'getPublicMultimedia in functions/src/index.ts uses onCall matching httpsCallable in PublicMediaClient'
    );
  } catch (err: any) {
    assert('Test 11 - Callable Protocol Alignment (getPublicMultimedia onCall <-> httpsCallable)', false, err.message);
  }

  // ---------------------------------------------------------------------------
  // Test 12: Firestore Rules Delegate Reads to isAdmin() & Deny Client Writes
  // (SOURCE ASSERTION: Static analysis of firestore.rules canonical security boundary)
  // ---------------------------------------------------------------------------
  try {
    const rulesSource = fs.readFileSync('firestore.rules', 'utf-8');
    const mediaBlockMatch = rulesSource.match(/match\s+\/media\/\{mediaId\}\s*\{([\s\S]*?)\}/);
    const playlistsBlockMatch = rulesSource.match(/match\s+\/playlists\/\{playlistId\}\s*\{([\s\S]*?)\}/);

    const mediaBlock = mediaBlockMatch ? mediaBlockMatch[1] : '';
    const playlistsBlock = playlistsBlockMatch ? playlistsBlockMatch[1] : '';

    // 1. Both media and playlist rules delegate reads exclusively to isAdmin()
    const mediaDelegatesReadsToAdmin = mediaBlock.includes('allow get, list: if isAdmin();');
    const playlistsDelegatesReadsToAdmin = playlistsBlock.includes('allow get, list: if isAdmin();');

    // 2. Anonymous and ordinary users have no public read exception
    const noPublicReadException =
      !mediaBlock.includes("resource.data.status == 'Published'") &&
      !playlistsBlock.includes("resource.data.status == 'Published'") &&
      !mediaBlock.includes('allow get, list: if true') &&
      !playlistsBlock.includes('allow get, list: if true');

    // 3. Existing isAdmin() helper requires an authenticated, active administrator
    const isAdminHelperRequiresActiveAuth =
      rulesSource.includes('function isAdmin()') &&
      rulesSource.includes('isSignedIn()') &&
      rulesSource.includes('isActive == true');

    // 4. Neither media nor playlist rule permits client writes
    const deniesClientWrites =
      mediaBlock.includes('allow create, update, delete: if false;') &&
      playlistsBlock.includes('allow create, update, delete: if false;');

    const passed =
      mediaDelegatesReadsToAdmin &&
      playlistsDelegatesReadsToAdmin &&
      noPublicReadException &&
      isAdminHelperRequiresActiveAuth &&
      deniesClientWrites;

    assert(
      'Test 12 - Firestore Rules Exclusively Delegate Reads to isAdmin and Deny Client Writes [SOURCE ASSERTION]',
      passed,
      'SOURCE ASSERTION: Direct Firestore reads on /media and /playlists delegate strictly to isAdmin(), public reads are denied to enforce server DTO sanitization, and client writes are forbidden'
    );
  } catch (err: any) {
    assert('Test 12 - Firestore Rules Exclusively Delegate Reads to isAdmin and Deny Client Writes [SOURCE ASSERTION]', false, err.message);
  }

  return results;
}
