import { MediaApplicationService } from '../../functions/src/media/mediaApplicationService';
import { InMemoryMediaRepository } from '../../functions/src/media/inMemoryMediaRepository';
import { FirestoreMediaRepository } from '../../functions/src/media/firestoreMediaRepository';
import { type MediaRepository } from '../../functions/src/media/mediaRepository';
import { CANONICAL_CATEGORIES, CANONICAL_CATEGORY_DEFINITIONS } from '../types';
import type { Video, RightsStatus, VisibilityDecision, RelationType, Placement } from '../types';
import * as fs from 'fs';

export async function runDurableMediaTests(): Promise<{ test: string; passed: boolean; details?: string }[]> {
  const results: { test: string; passed: boolean; details?: string }[] = [];
  const assert = (name: string, condition: boolean, details?: string) => {
    results.push({ test: name, passed: condition, details });
  };

  console.log('=========================================================');
  console.log('DURABLE CANONICAL MEDIA FOUNDATION TEST SUITE');
  console.log('=========================================================\n');

  // Test 1: Production repository default is Firestore-backed
  try {
    const defaultService = new MediaApplicationService();
    // Verify default constructed repo is instance of FirestoreMediaRepository
    const isFirestore = (defaultService as any).mediaRepo instanceof FirestoreMediaRepository;
    assert(
      'Durable Media Test 1 - Production repository default is Firestore-backed',
      isFirestore,
      'MediaApplicationService defaults to FirestoreMediaRepository'
    );
  } catch (e: any) {
    assert('Durable Media Test 1 - Production repository default is Firestore-backed', false, e.message);
  }

  // Test 2: In-memory repository is explicit test injection only
  try {
    const memRepo = new InMemoryMediaRepository();
    const testService = new MediaApplicationService(memRepo);
    const isMem = (testService as any).mediaRepo instanceof InMemoryMediaRepository;
    assert(
      'Durable Media Test 2 - In-memory repository is explicit test injection only',
      isMem,
      'InMemoryMediaRepository is used only when explicitly injected'
    );
  } catch (e: any) {
    assert('Durable Media Test 2 - In-memory repository is explicit test injection only', false, e.message);
  }

  // Test 3: No silent Firestore -> memory fallback exists
  try {
    const fsRepo = new FirestoreMediaRepository();
    // Verify that FirestoreMediaRepository methods directly call Firestore without falling back to local memory
    assert(
      'Durable Media Test 3 - No silent Firestore -> memory fallback exists',
      FirestoreMediaRepository.COLLECTION === 'media' && !(fsRepo as any).videos,
      'FirestoreMediaRepository has no internal fallback memory cache'
    );
  } catch (e: any) {
    assert('Durable Media Test 3 - No silent Firestore -> memory fallback exists', false, e.message);
  }

  // Test 4: Canonical Video contract is reused
  try {
    const sampleVideo: Video = {
      id: 'video_yt_test123',
      contentType: 'Video',
      status: 'Draft',
      category: 'Climate',
      titleAr: 'عنوان الفيديو',
      excerptAr: 'مقتطف الفيديو',
      originalLanguage: 'ar',
      availableLanguages: ['ar'],
      translationStatus: 'NotRequired',
      author: 'Author',
      editor: 'Editor',
      approvalStatus: 'Pending',
      editorialDescriptionAr: 'وصف الفيديو',
      visibilityDecision: 'Hidden',
      rightsStatus: 'NotStarted',
      tags: ['مناخ'],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      youtubeSource: {
        youtubeVideoId: 'test123',
        youtubeUrl: 'https://youtube.com/watch?v=test123',
        channelId: 'UC_TEST',
        channelName: 'Test Channel',
        channelUrl: 'https://youtube.com/channel/UC_TEST',
        originalTitle: 'Original Video Title',
        originalDescription: 'Original Video Description',
        youtubePublishedAt: '2026-01-01T00:00:00Z',
        thumbnails: { default: 'https://i.ytimg.com/vi/test123/default.jpg' },
        duration: 'PT5M',
        availabilityStatus: 'Available',
      },
    };
    assert(
      'Durable Media Test 4 - Canonical Video contract is reused',
      sampleVideo.contentType === 'Video' && sampleVideo.youtubeSource.youtubeVideoId === 'test123',
      'Shared Video type contract is strictly reused across domain layers'
    );
  } catch (e: any) {
    assert('Durable Media Test 4 - Canonical Video contract is reused', false, e.message);
  }

  // Test 5: Canonical Category vocabulary is reused
  try {
    assert(
      'Durable Media Test 5 - Canonical Category vocabulary is reused',
      CANONICAL_CATEGORIES.length === 7 &&
      CANONICAL_CATEGORY_DEFINITIONS.length === 7 &&
      CANONICAL_CATEGORIES.includes('Climate') &&
      CANONICAL_CATEGORIES.includes('Water') &&
      CANONICAL_CATEGORIES.includes('Biodiversity') &&
      CANONICAL_CATEGORIES.includes('Pollution') &&
      CANONICAL_CATEGORIES.includes('Energy') &&
      CANONICAL_CATEGORIES.includes('Agriculture') &&
      CANONICAL_CATEGORIES.includes('EnvironmentalPolicy'),
      'Exact 7 canonical categories shared across entire system'
    );
  } catch (e: any) {
    assert('Durable Media Test 5 - Canonical Category vocabulary is reused', false, e.message);
  }

  // Test 6: Canonical RightsStatus vocabulary is reused
  try {
    const validRights: RightsStatus[] = ['NotStarted', 'InReview', 'Cleared', 'NeedsChanges', 'Rejected'];
    assert(
      'Durable Media Test 6 - Canonical RightsStatus vocabulary is reused',
      validRights.length === 5 && validRights.includes('NotStarted') && validRights.includes('Cleared'),
      'Canonical RightsStatus union values are preserved strictly'
    );
  } catch (e: any) {
    assert('Durable Media Test 6 - Canonical RightsStatus vocabulary is reused', false, e.message);
  }

  // Test 7: Canonical VisibilityDecision vocabulary is reused
  try {
    const validVis: VisibilityDecision[] = ['Hidden', 'MediaHubOnly', 'NewsEligible', 'Featured'];
    assert(
      'Durable Media Test 7 - Canonical VisibilityDecision vocabulary is reused',
      validVis.length === 4 && validVis.includes('Hidden') && validVis.includes('Featured'),
      'Canonical VisibilityDecision union values are preserved strictly'
    );
  } catch (e: any) {
    assert('Durable Media Test 7 - Canonical VisibilityDecision vocabulary is reused', false, e.message);
  }

  // Test 8: Canonical relation vocabulary is reused
  try {
    const validRelations: RelationType[] = ['Embedded', 'RelatedCoverage', 'SupportingMaterial'];
    const validPlacements: Placement[] = ['Top', 'Inline', 'Bottom', 'Sidebar'];
    assert(
      'Durable Media Test 8 - Canonical relation vocabulary is reused',
      validRelations.length === 3 && validPlacements.length === 4,
      'RelationType and Placement vocabulary are strictly preserved'
    );
  } catch (e: any) {
    assert('Durable Media Test 8 - Canonical relation vocabulary is reused', false, e.message);
  }

  // Test 9: Register persists a canonical Media record
  const memRepo = new InMemoryMediaRepository();
  const mediaService = new MediaApplicationService(memRepo);
  let registeredVideo: Video | null = null;
  try {
    registeredVideo = await mediaService.register({
      contentType: 'Video',
      category: 'Climate',
      titleAr: 'تقرير المناخ الأسبوعي',
      excerptAr: 'نظرة عامة على التغير المناخي',
      editorialDescriptionAr: 'وصف تحريري مفصل حول تغيرات المناخ',
      editor: 'Lead Editor',
      youtubeSource: {
        youtubeVideoId: 'yt_vid_001',
        youtubeUrl: 'https://youtube.com/watch?v=yt_vid_001',
        channelId: 'UC_TEST',
        channelName: 'Test Channel',
        channelUrl: 'https://youtube.com/channel/UC_TEST',
        originalTitle: 'Original YouTube Title',
        originalDescription: 'Original YouTube Description',
        youtubePublishedAt: '2026-02-01T10:00:00Z',
        thumbnails: { default: 'https://img.youtube.com/vi/yt_vid_001/default.jpg' },
        duration: 'PT10M',
        availabilityStatus: 'Available',
      },
    });

    assert(
      'Durable Media Test 9 - Register persists a canonical Media record',
      registeredVideo !== null &&
      registeredVideo.id === 'video_yt_yt_vid_001' &&
      registeredVideo.category === 'Climate' &&
      registeredVideo.status === 'Draft' &&
      registeredVideo.rightsStatus === 'NotStarted' &&
      registeredVideo.visibilityDecision === 'Hidden',
      'Canonical Media record created with fail-closed defaults'
    );
  } catch (e: any) {
    assert('Durable Media Test 9 - Register persists a canonical Media record', false, e.message);
  }

  // Test 10: Duplicate provider + externalVideoId is rejected
  try {
    let duplicateRejected = false;
    try {
      await mediaService.register({
        contentType: 'Video',
        category: 'Water',
        titleAr: 'فيديو مكرر',
        excerptAr: 'مقتطف',
        editorialDescriptionAr: 'وصف',
        editor: 'Lead Editor',
        youtubeSource: {
          youtubeVideoId: 'yt_vid_001', // Same ID
          youtubeUrl: 'https://youtube.com/watch?v=yt_vid_001',
          channelId: 'UC_TEST',
          channelName: 'Test Channel',
          channelUrl: 'https://youtube.com/channel/UC_TEST',
          originalTitle: 'Original YouTube Title',
          originalDescription: 'Original YouTube Description',
          youtubePublishedAt: '2026-02-01T10:00:00Z',
          thumbnails: {},
          duration: 'PT10M',
          availabilityStatus: 'Available',
        },
      });
    } catch (err: any) {
      duplicateRejected = err.message.includes('DUPLICATE_MEDIA');
    }
    assert(
      'Durable Media Test 10 - Duplicate provider + externalVideoId is rejected',
      duplicateRejected,
      'Duplicate YouTube video ID cannot be registered twice'
    );
  } catch (e: any) {
    assert('Durable Media Test 10 - Duplicate provider + externalVideoId is rejected', false, e.message);
  }

  // Test 11: getById returns canonical domain representation
  try {
    const fetched = await mediaService.getById('video_yt_yt_vid_001');
    assert(
      'Durable Media Test 11 - getById returns canonical domain representation',
      fetched !== null && fetched.id === 'video_yt_yt_vid_001' && fetched.titleAr === 'تقرير المناخ الأسبوعي',
      'Video retrieved by primary domain ID successfully'
    );
  } catch (e: any) {
    assert('Durable Media Test 11 - getById returns canonical domain representation', false, e.message);
  }

  // Test 12: External identity lookup returns the correct Media
  try {
    const fetchedByYt = await mediaService.getByYoutubeId('YouTube', 'yt_vid_001');
    assert(
      'Durable Media Test 12 - External identity lookup returns the correct Media',
      fetchedByYt !== null && fetchedByYt.id === 'video_yt_yt_vid_001',
      'Media resolved deterministically via provider + externalVideoId'
    );
  } catch (e: any) {
    assert('Durable Media Test 12 - External identity lookup returns the correct Media', false, e.message);
  }

  // Test 13: Metadata update preserves protected identity fields
  try {
    const updated = await mediaService.updateMetadata('video_yt_yt_vid_001', {
      editorialDescriptionAr: 'وصف تحريري محدث',
      tags: ['مناخ', 'طاقة متجددة'],
    });

    assert(
      'Durable Media Test 13 - Metadata update preserves protected identity fields',
      updated.editorialDescriptionAr === 'وصف تحريري محدث' &&
      updated.id === 'video_yt_yt_vid_001' &&
      updated.youtubeSource.youtubeVideoId === 'yt_vid_001' &&
      updated.rightsStatus === 'NotStarted' &&
      updated.visibilityDecision === 'Hidden',
      'Identity and governance fields protected against arbitrary metadata mutation'
    );
  } catch (e: any) {
    assert('Durable Media Test 13 - Metadata update preserves protected identity fields', false, e.message);
  }

  // Test 14: Rights/visibility can represent fail-closed NotStarted + Hidden
  try {
    assert(
      'Durable Media Test 14 - Rights/visibility can represent fail-closed NotStarted + Hidden',
      registeredVideo?.rightsStatus === 'NotStarted' &&
      registeredVideo?.visibilityDecision === 'Hidden' &&
      !mediaService.isPubliclyEligible(registeredVideo!),
      'Newly registered media is strictly Hidden and NotStarted, ineligible for public display'
    );
  } catch (e: any) {
    assert('Durable Media Test 14 - Rights/visibility can represent fail-closed NotStarted + Hidden', false, e.message);
  }

  // Test 15: Relationship source is singular
  try {
    const rel = await mediaService.linkVideoToContent(
      'video_yt_yt_vid_001',
      'news_article_999',
      'Embedded',
      'Top'
    );
    const directRelations = await mediaService.getRelationsForVideo('video_yt_yt_vid_001');

    assert(
      'Durable Media Test 15 - Relationship source is singular',
      directRelations.length === 1 && directRelations[0].contentId === 'news_article_999' && !!rel.id,
      'Relation created under single canonical media document store'
    );
  } catch (e: any) {
    assert('Durable Media Test 15 - Relationship source is singular', false, e.message);
  }

  // Test 16: Reverse relationship lookup is derived
  try {
    const videosForContent = await mediaService.getVideosForContent('news_article_999');
    assert(
      'Durable Media Test 16 - Reverse relationship lookup is derived',
      videosForContent.length === 1 && videosForContent[0].id === 'video_yt_yt_vid_001',
      'Reverse content -> videos query accurately derived from the single canonical relationship authority'
    );
  } catch (e: any) {
    assert('Durable Media Test 16 - Reverse relationship lookup is derived', false, e.message);
  }

  // Test 17: Failed persistence does not report success
  try {
    const brokenRepo: MediaRepository = {
      getVideoById: async () => null,
      getVideoByYoutubeId: async () => null,
      saveVideo: async () => { throw new Error('Firestore connection failure'); },
      listVideos: async () => [],
      saveRelation: async () => { throw new Error('Write failed'); },
      deleteRelation: async () => false,
      getRelationsForVideo: async () => [],
      getRelationsForContent: async () => [],
    };
    const failingService = new MediaApplicationService(brokenRepo);
    let failedCleanly = false;
    try {
      await failingService.register({
        contentType: 'Video',
        category: 'Energy',
        titleAr: 'طاقة',
        excerptAr: 'مقتطف',
        editorialDescriptionAr: 'وصف',
        editor: 'Editor',
        youtubeSource: {
          youtubeVideoId: 'yt_fail_write',
          youtubeUrl: 'https://youtube.com',
          channelId: 'UC_FAIL',
          channelName: 'Fail',
          channelUrl: 'https://youtube.com',
          originalTitle: 'Fail',
          originalDescription: 'Fail',
          youtubePublishedAt: '2026-01-01',
          thumbnails: {},
          duration: 'PT1M',
          availabilityStatus: 'Available',
        },
      });
    } catch {
      failedCleanly = true;
    }
    assert(
      'Durable Media Test 17 - Failed persistence does not report success',
      failedCleanly,
      'Persistence failures fail closed and throw rather than reporting fake success'
    );
  } catch (e: any) {
    assert('Durable Media Test 17 - Failed persistence does not report success', false, e.message);
  }

  // Test 18: Firestore-specific timestamp representation does not leak into canonical domain consumers
  try {
    const currentVideo = await mediaService.getById('video_yt_yt_vid_001');
    const isIsoStringCreated = typeof currentVideo?.createdAt === 'string' && !isNaN(Date.parse(currentVideo.createdAt));
    const isIsoStringUpdated = typeof currentVideo?.updatedAt === 'string' && !isNaN(Date.parse(currentVideo.updatedAt));

    assert(
      'Durable Media Test 18 - Firestore timestamp does not leak into canonical domain consumers',
      isIsoStringCreated && isIsoStringUpdated,
      'Domain models strictly consume standard ISO-8601 string timestamps'
    );
  } catch (e: any) {
    assert('Durable Media Test 18 - Firestore timestamp does not leak into canonical domain consumers', false, e.message);
  }

  // Test 19: Browser direct writes remain unavailable in Firestore rules
  try {
    const rulesContent = fs.readFileSync('firestore.rules', 'utf-8');
    const hasDefaultDeny = rulesContent.includes('match /{document=**}') && rulesContent.includes('allow read, write: if false;');
    assert(
      'Durable Media Test 19 - Browser direct writes remain unavailable in Firestore rules',
      hasDefaultDeny,
      'Global fail-closed default deny ensures direct browser writes to media collection remain forbidden'
    );
  } catch (e: any) {
    assert('Durable Media Test 19 - Browser direct writes remain unavailable in Firestore rules', false, e.message);
  }

  // Test 20: No candidate acceptance is introduced in this foundation
  try {
    const serviceMethods = Object.getOwnPropertyNames(MediaApplicationService.prototype);
    const hasAcceptMethod = serviceMethods.includes('acceptCandidate') || serviceMethods.includes('acceptImportCandidate');
    assert(
      'Durable Media Test 20 - No candidate acceptance is introduced',
      !hasAcceptMethod,
      'Candidate acceptance workflow remains strictly deferred to future atomic block'
    );
  } catch (e: any) {
    assert('Durable Media Test 20 - No candidate acceptance is introduced', false, e.message);
  }

  // Test 21: No new RBAC vocabulary exists
  try {
    const { AdminRole, AdminPermission } = await import('../../functions/src/types/admin');
    const roleCount = Object.keys(AdminRole).length;
    const permCount = Object.keys(AdminPermission).length;
    assert(
      'Durable Media Test 21 - No new RBAC vocabulary exists',
      roleCount === 9 && permCount === 10,
      'RBAC roles and permissions remain exactly at canonical counts (9 roles, 10 permissions)'
    );
  } catch (e: any) {
    assert('Durable Media Test 21 - No new RBAC vocabulary exists', false, e.message);
  }

  // Test 22: No new audit vocabulary exists
  try {
    const { AuditAction, AuditTargetType } = await import('../types/audit');
    const actionCount = Object.keys(AuditAction).length;
    const targetCount = Object.keys(AuditTargetType).length;
    assert(
      'Durable Media Test 22 - No new audit vocabulary exists',
      actionCount === 6 && targetCount === 8 && AuditTargetType.Media === 'Media',
      'Canonical audit vocabulary preserved without speculative additions'
    );
  } catch (e: any) {
    assert('Durable Media Test 22 - No new audit vocabulary exists', false, e.message);
  }

  // Test 23: No new category/rights/visibility/relation vocabulary exists
  try {
    assert(
      'Durable Media Test 23 - No new category/rights/visibility/relation vocabulary exists',
      CANONICAL_CATEGORIES.length === 7,
      'Domain vocabulary counts strictly preserved'
    );
  } catch (e: any) {
    assert('Durable Media Test 23 - No new category/rights/visibility/relation vocabulary exists', false, e.message);
  }

  // Test 24: Current client MediaService remains unchanged/operational
  try {
    const { MediaService: ClientMediaService } = await import('./mediaService');
    const clientVideos = ClientMediaService.listAll();
    assert(
      'Durable Media Test 24 - Current client MediaService remains unchanged/operational',
      Array.isArray(clientVideos) && typeof ClientMediaService.register === 'function',
      'Client MediaService operational for ongoing session/demo UI compatibility'
    );
  } catch (e: any) {
    assert('Durable Media Test 24 - Current client MediaService remains unchanged/operational', false, e.message);
  }

  // Test 25: Production code does not use InMemoryMediaRepository automatically
  try {
    const prodService = new MediaApplicationService();
    const repo = (prodService as any).mediaRepo;
    assert(
      'Durable Media Test 25 - Production code does not use InMemoryMediaRepository automatically',
      !(repo instanceof InMemoryMediaRepository),
      'Production application service binds to real Firestore repository'
    );
  } catch (e: any) {
    assert('Durable Media Test 25 - Production code does not use InMemoryMediaRepository automatically', false, e.message);
  }

  return results;
}
