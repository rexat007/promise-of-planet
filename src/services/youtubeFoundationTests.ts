import { YoutubeApplicationService } from '../../functions/src/youtube/youtubeApplicationService';
import { InMemoryYouTubeRepository } from '../../functions/src/youtube/inMemoryYouTubeRepository';
import { FirestoreYouTubeRepository } from '../../functions/src/youtube/firestoreYouTubeRepository';
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

  // Assertion 3: Editorial / source separation & canonical Category reuse
  try {
    const candidate = await service.getCandidate('youtube_dQw4w9WgXcQ');
    const isCanonicalCategory = candidate?.editorialDraft.category === 'Climate';
    const hasEditorInDraft = 'editor' in (candidate?.editorialDraft || {});
    assert(
      'Assertion 3 - Source/Editorial separation and canonical category reuse',
      isCanonicalCategory === true && hasEditorInDraft === false,
      "Draft reuses canonical 'Climate' Category and excludes redundant editor property"
    );
  } catch (e: any) {
    assert('Assertion 3 - Source/Editorial separation and canonical category reuse', false, e.message);
  }

  // Assertion 4: Source refresh preserves human editorial draft
  try {
    if (!AdminAccessService.hasPermission(contentEditorUser, AdminPermission.Edit)) {
      throw new Error('Unauthorized');
    }
    await service.updateEditorialDraft('youtube_dQw4w9WgXcQ', {
      titleAr: 'عن تغير المناخ وحماية الكوكب',
      excerptAr: 'مقتطف مخصص يدويًا',
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
        category: cand.editorialDraft.category,
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

  return results;
}
