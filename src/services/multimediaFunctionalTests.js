"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMultimediaFunctionalVerification = runMultimediaFunctionalVerification;
const fakeYouTubeClient_1 = require("../../functions/src/youtube/fakeYouTubeClient");
const inMemoryYouTubeRepository_1 = require("../../functions/src/youtube/inMemoryYouTubeRepository");
const inMemoryMediaRepository_1 = require("../../functions/src/media/inMemoryMediaRepository");
const youtubeApplicationService_1 = require("../../functions/src/youtube/youtubeApplicationService");
const contentVisibility_1 = require("./contentVisibility");
const publicMediaClient_1 = require("./publicMediaClient");
async function runMultimediaFunctionalVerification() {
    const results = [];
    function assert(name, condition, details) {
        results.push({
            test: name,
            passed: condition,
            details: condition ? details || 'PASSED' : details || 'FAILED',
        });
    }
    // Setup test fixtures
    const fakeYt = new fakeYouTubeClient_1.FakeYouTubeClient();
    const inMemoryYtRepo = new inMemoryYouTubeRepository_1.InMemoryYouTubeRepository();
    const inMemoryMediaRepo = new inMemoryMediaRepository_1.InMemoryMediaRepository();
    const appService = new youtubeApplicationService_1.YoutubeApplicationService(inMemoryYtRepo, fakeYt, inMemoryMediaRepo);
    // Configure primary channel
    await inMemoryYtRepo.saveConfiguration({
        id: 'youtube-primary',
        channelId: 'UC_POP_OFFICIAL',
        enabled: true,
        updatedAt: new Date().toISOString(),
        version: 1,
    });
    // Mock Playlists
    const mockPlaylists = [
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
    const plCop28Items = [
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
    const plFieldItems = [
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
        assert('Test 1 - Channel Playlist Discovery', discovered.length === 2 && discovered[0].id === 'PL_COP28', `Discovered ${discovered.length} playlists for channel UC_POP_OFFICIAL`);
    }
    catch (err) {
        assert('Test 1 - Channel Playlist Discovery', false, err.message);
    }
    // ---------------------------------------------------------------------------
    // Test 2: Playlist Membership Retrieval
    // ---------------------------------------------------------------------------
    try {
        const memberships = await fakeYt.getPlaylistMemberships('PL_COP28');
        assert('Test 2 - Playlist Membership Retrieval', memberships.items.length === 2 && memberships.items[0].videoId === 'vid_cop_01', `Retrieved ${memberships.items.length} items from PL_COP28`);
    }
    catch (err) {
        assert('Test 2 - Playlist Membership Retrieval', false, err.message);
    }
    // ---------------------------------------------------------------------------
    // Test 3: Sync Channel Playlists & Separation of Timestamps
    // ---------------------------------------------------------------------------
    try {
        const syncRes = await appService.syncChannelPlaylists();
        assert('Test 3 - Sync Channel Playlists Orchestration', syncRes.playlistsDiscovered === 2 && syncRes.videosIngested === 3 && syncRes.itemsAssociated === 3, `Playlists discovered: ${syncRes.playlistsDiscovered}, Videos ingested: ${syncRes.videosIngested}`);
        // Verify Candidate has true video publishedAt (not playlist-addition date)
        const candidate = await inMemoryYtRepo.getCandidate('youtube_vid_cop_01');
        assert('Test 3b - Separate Video Published Date from Playlist Addition Date', candidate !== null && candidate.sourceSnapshot.youtubePublishedAt === '2023-12-01T08:00:00Z', `Candidate preserved true video publishedAt: ${candidate?.sourceSnapshot.youtubePublishedAt} (distinct from playlist added: 2023-12-05T14:30:00Z)`);
        // Verify candidate was ingested as PendingReview (never auto-published)
        assert('Test 3c - Candidate Ingestion Isolation (Advisory / PendingReview)', candidate?.status === 'PendingReview', `Candidate status is strictly PendingReview; human review preserved.`);
        // Verify CanonicalPlaylist was persisted
        const savedPlaylist = await inMemoryMediaRepo.getPlaylistById('playlist_yt_PL_COP28');
        assert('Test 3d - Canonical Playlist Persistence', savedPlaylist !== null && savedPlaylist.videoIds.includes('video_yt_vid_cop_01'), `Playlist PL_COP28 persisted with canonical video IDs: ${savedPlaylist?.videoIds.join(', ')}`);
    }
    catch (err) {
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
        assert('Test 4 - Video Deduplication across Playlists', syncRes2.videosIngested === 0, `No duplicate candidate created for existing vid_cop_01`);
    }
    catch (err) {
        assert('Test 4 - Video Deduplication across Playlists', false, err.message);
    }
    // ---------------------------------------------------------------------------
    // Test 5: Canonical Visibility Filtering Engine (isVideoVisibleInMediaHub)
    // ---------------------------------------------------------------------------
    const baseValidVideo = {
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
    const resValid = (0, contentVisibility_1.isVideoVisibleInMediaHub)(baseValidVideo, 'ar');
    assert('Test 5a - Canonical Visibility (Fully Cleared & Published)', resValid.visible);
    // 5b: Draft video -> HIDDEN
    const resDraft = (0, contentVisibility_1.isVideoVisibleInMediaHub)({ ...baseValidVideo, status: 'Draft' }, 'ar');
    assert('Test 5b - Visibility Filter: Rejects Drafts', !resDraft.visible && resDraft.reason === 'NOT_PUBLISHED');
    // 5c: Unapproved video -> HIDDEN
    const resUnapproved = (0, contentVisibility_1.isVideoVisibleInMediaHub)({ ...baseValidVideo, approvalStatus: 'Pending' }, 'ar');
    assert('Test 5c - Visibility Filter: Rejects Unapproved', !resUnapproved.visible && resUnapproved.reason === 'NOT_APPROVED');
    // 5d: Rights not cleared -> HIDDEN
    const resRights = (0, contentVisibility_1.isVideoVisibleInMediaHub)({ ...baseValidVideo, rightsStatus: 'NotStarted' }, 'ar');
    assert('Test 5d - Visibility Filter: Rejects Rights Not Cleared', !resRights.visible && resRights.reason === 'RIGHTS_NOT_CLEARED');
    // 5e: Editorial Hidden decision -> HIDDEN
    const resHidden = (0, contentVisibility_1.isVideoVisibleInMediaHub)({ ...baseValidVideo, visibilityDecision: 'Hidden' }, 'ar');
    assert('Test 5e - Visibility Filter: Rejects Hidden Visibility Decision', !resHidden.visible && resHidden.reason === 'HIDDEN_BY_EDITORIAL_DECISION');
    // 5f: Private/Unavailable YouTube video -> HIDDEN
    const resPrivate = (0, contentVisibility_1.isVideoVisibleInMediaHub)({
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
            await publicMediaClient_1.PublicMediaClient.fetchPublicMultimedia('ar');
        }
        catch {
            threw = true;
        }
        assert('Test 6 - PublicMediaClient Fail-Closed on Firestore Permission Error (No Mock Leak)', threw, 'PublicMediaClient correctly threw error instead of falling back to mock fixtures');
    }
    catch (err) {
        assert('Test 6 - PublicMediaClient Integration', false, err.message);
    }
    return results;
}
//# sourceMappingURL=multimediaFunctionalTests.js.map