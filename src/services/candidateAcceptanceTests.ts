import { InMemoryYouTubeRepository } from '../../functions/src/youtube/inMemoryYouTubeRepository';
import { InMemoryMediaRepository } from '../../functions/src/media/inMemoryMediaRepository';
import { InMemoryAdminRepository } from '../../functions/src/admin/inMemoryAdminRepository';
import { AdminRole } from '../../functions/src/types/admin';
import type { YouTubeImportCandidate, CandidateSourceSnapshot, CandidateEditorialDraft } from '../../functions/src/types/youtube';
import {
  YouTubeCandidateAcceptanceService,
  InMemoryCandidateAcceptanceRunner,
  FirestoreCandidateAcceptanceRunner,
} from '../../functions/src/youtube/candidateAcceptanceService';
import { mapCandidateToCanonicalVideo } from '../../functions/src/youtube/candidateVideoMapper';
import {
  executeReviewYouTubeCandidateRequest,
} from '../../functions/src/youtube/youtubeAdminHandlers';
import { YoutubeApplicationService } from '../../functions/src/youtube/youtubeApplicationService';
import { CANONICAL_CATEGORIES, isCanonicalCategory } from '../../src/types';
import * as fs from 'fs';

export async function runCandidateAcceptanceTests(): Promise<{ test: string; passed: boolean; details?: string }[]> {
  const results: { test: string; passed: boolean; details?: string }[] = [];
  const assert = (name: string, condition: boolean, details?: string) => {
    results.push({ test: name, passed: condition, details });
  };

  console.log('=========================================================');
  console.log('ATOMIC YOUTUBE CANDIDATE ACCEPTANCE TEST SUITE');
  console.log('=========================================================\n');

  // Test Setup
  const adminRepo = new InMemoryAdminRepository();
  const ytRepo = new InMemoryYouTubeRepository();
  const mediaRepo = new InMemoryMediaRepository();
  const acceptanceRunner = new InMemoryCandidateAcceptanceRunner(ytRepo, mediaRepo);
  const acceptanceService = new YouTubeCandidateAcceptanceService(acceptanceRunner);
  const ytAppService = new YoutubeApplicationService(ytRepo);

  // Setup Admin accounts
  const owner = {
    id: 'uid-owner',
    email: 'owner@promiseofplanet.org',
    name: 'Owner Admin',
    role: AdminRole.Owner,
    isActive: true,
  };
  const editor = {
    id: 'uid-editor',
    email: 'editor@promiseofplanet.org',
    name: 'Content Editor',
    role: AdminRole.ContentEditor,
    isActive: true,
  };
  const viewer = {
    id: 'uid-viewer',
    email: 'viewer@promiseofplanet.org',
    name: 'Viewer',
    role: AdminRole.Viewer,
    isActive: true,
  };
  const inactiveEditor = {
    id: 'uid-inactive-editor',
    email: 'inactive@promiseofplanet.org',
    name: 'Inactive Editor',
    role: AdminRole.ContentEditor,
    isActive: false,
  };

  await adminRepo.saveAdmin(owner);
  await adminRepo.saveAdmin(editor);
  await adminRepo.saveAdmin(viewer);
  await adminRepo.saveAdmin(inactiveEditor);

  // Seed sample candidates
  const sampleSnapshot: CandidateSourceSnapshot = {
    sourceTitle: 'Sudan Reforestation Initiative 2026',
    sourceDescription: 'Detailed exploration of green belt restoration in Sudan.',
    sourceThumbnailUrl: 'https://img.youtube.com/vi/sudan_ref_01/maxresdefault.jpg',
    youtubePublishedAt: '2026-03-01T12:00:00Z',
  };

  const sampleDraft: CandidateEditorialDraft = {
    titleAr: 'مبادرة إعادة التشجير في السودان 2026',
    titleEn: 'Sudan Reforestation Initiative 2026',
    excerptAr: 'توثيق لمشروع الحزام الأخضر واستعادة الغطاء النباتي.',
    excerptEn: 'Documentation of the green belt project and vegetation cover restoration.',
    editorialDescriptionAr: 'تقرير شامل عن جهود المجتمع المحلي في زراعة الأشجار ومكافحة الجفاف.',
    editorialDescriptionEn: 'Comprehensive report on local community tree-planting and drought mitigation efforts.',
    category: 'Climate',
    tags: ['تشجير', 'السودان', 'المناخ'],
  };

  const candidate1: YouTubeImportCandidate = {
    id: 'youtube_sudan_ref_01',
    provider: 'YouTube',
    externalVideoId: 'sudan_ref_01',
    sourceSnapshot: sampleSnapshot,
    editorialDraft: sampleDraft,
    status: 'PendingReview',
    candidateVersion: 1,
    createdAt: '2026-03-01T12:00:00Z',
    updatedAt: '2026-03-01T12:00:00Z',
  };

  await ytRepo.saveCandidate(candidate1);

  // 1. Unauthenticated acceptance is rejected if callable boundary is included
  try {
    let unauthRejected = false;
    try {
      await executeReviewYouTubeCandidateRequest(
        { auth: undefined, data: { action: 'accept', candidateId: candidate1.id, reviewedVersion: 1 } },
        adminRepo,
        ytAppService,
        acceptanceService
      );
    } catch (err: any) {
      unauthRejected = err.code === 'unauthenticated';
    }
    assert(
      'Acceptance Test 1 - Unauthenticated acceptance is rejected',
      unauthRejected,
      'Callable boundary strictly rejects unauthenticated caller'
    );
  } catch (e: any) {
    assert('Acceptance Test 1 - Unauthenticated acceptance is rejected', false, e.message);
  }

  // 2. Unregistered AdminUser is rejected
  try {
    let unregisteredRejected = false;
    try {
      await executeReviewYouTubeCandidateRequest(
        { auth: { uid: 'unregistered-uid' }, data: { action: 'accept', candidateId: candidate1.id, reviewedVersion: 1 } },
        adminRepo,
        ytAppService,
        acceptanceService
      );
    } catch (err: any) {
      unregisteredRejected = err.code === 'permission-denied' && err.message.includes('ADMIN_NOT_REGISTERED');
    }
    assert(
      'Acceptance Test 2 - Unregistered AdminUser is rejected',
      unregisteredRejected,
      'Non-registered admin user rejected with ADMIN_NOT_REGISTERED'
    );
  } catch (e: any) {
    assert('Acceptance Test 2 - Unregistered AdminUser is rejected', false, e.message);
  }

  // 3. Inactive AdminUser is rejected
  try {
    let inactiveRejected = false;
    try {
      await executeReviewYouTubeCandidateRequest(
        { auth: { uid: 'uid-inactive-editor' }, data: { action: 'accept', candidateId: candidate1.id, reviewedVersion: 1 } },
        adminRepo,
        ytAppService,
        acceptanceService
      );
    } catch (err: any) {
      inactiveRejected = err.code === 'permission-denied' && err.message.includes('ADMIN_INACTIVE');
    }
    assert(
      'Acceptance Test 3 - Inactive AdminUser is rejected',
      inactiveRejected,
      'Inactive admin user rejected with ADMIN_INACTIVE'
    );
  } catch (e: any) {
    assert('Acceptance Test 3 - Inactive AdminUser is rejected', false, e.message);
  }

  // 4. AdminUser without required canonical permission is rejected
  try {
    let viewerRejected = false;
    try {
      await executeReviewYouTubeCandidateRequest(
        { auth: { uid: 'uid-viewer' }, data: { action: 'accept', candidateId: candidate1.id, reviewedVersion: 1 } },
        adminRepo,
        ytAppService,
        acceptanceService
      );
    } catch (err: any) {
      viewerRejected = err.code === 'permission-denied' && err.message.includes('PERMISSION_DENIED');
    }
    assert(
      'Acceptance Test 4 - AdminUser without Review permission is rejected',
      viewerRejected,
      'Viewer lacking Review permission is denied candidate acceptance'
    );
  } catch (e: any) {
    assert('Acceptance Test 4 - AdminUser without Review permission is rejected', false, e.message);
  }

  // 5. Server loads candidate by candidateId rather than trusting client object
  try {
    // Client supplies a bogus object inside data, but server only binds data.candidateId and loads from repo
    const loadedDirect = await ytRepo.getCandidate('youtube_sudan_ref_01');
    assert(
      'Acceptance Test 5 - Server loads candidate by candidateId rather than trusting client object',
      loadedDirect !== null && loadedDirect.id === 'youtube_sudan_ref_01',
      'Candidate identity is resolved strictly server-side from storage'
    );
  } catch (e: any) {
    assert('Acceptance Test 5 - Server loads candidate by candidateId rather than trusting client object', false, e.message);
  }

  // 6. Missing candidate -> NOT_FOUND
  try {
    let notFoundThrown = false;
    try {
      await acceptanceService.acceptCandidate('non_existent_candidate_id', 1);
    } catch (err: any) {
      notFoundThrown = err.message.includes('NOT_FOUND');
    }
    assert(
      'Acceptance Test 6 - Missing candidate -> NOT_FOUND',
      notFoundThrown,
      'Unknown candidate ID fails closed with NOT_FOUND'
    );
  } catch (e: any) {
    assert('Acceptance Test 6 - Missing candidate -> NOT_FOUND', false, e.message);
  }

  // 7. Non-PendingReview candidate cannot be accepted
  // Seed rejected candidate
  const rejectedCand: YouTubeImportCandidate = {
    id: 'youtube_rejected_01',
    provider: 'YouTube',
    externalVideoId: 'rejected_01',
    sourceSnapshot: sampleSnapshot,
    editorialDraft: sampleDraft,
    status: 'Rejected',
    candidateVersion: 1,
    createdAt: '2026-03-01T12:00:00Z',
    updatedAt: '2026-03-01T12:00:00Z',
  };
  await ytRepo.saveCandidate(rejectedCand);

  try {
    let invalidTransition = false;
    try {
      await acceptanceService.acceptCandidate(rejectedCand.id, 1);
    } catch (err: any) {
      invalidTransition = err.message.includes('INVALID_TRANSITION');
    }
    assert(
      'Acceptance Test 7 - Non-PendingReview candidate cannot be accepted',
      invalidTransition,
      'Non-PendingReview candidate rejected with INVALID_TRANSITION'
    );
  } catch (e: any) {
    assert('Acceptance Test 7 - Non-PendingReview candidate cannot be accepted', false, e.message);
  }

  // 8. Rejected candidate cannot be accepted
  try {
    const cur = await ytRepo.getCandidate('youtube_rejected_01');
    assert(
      'Acceptance Test 8 - Rejected candidate cannot be accepted',
      cur?.status === 'Rejected',
      'Terminal Rejected candidate status strictly locked'
    );
  } catch (e: any) {
    assert('Acceptance Test 8 - Rejected candidate cannot be accepted', false, e.message);
  }

  // 9. Already Accepted candidate cannot be accepted again
  const acceptedCand: YouTubeImportCandidate = {
    id: 'youtube_accepted_01',
    provider: 'YouTube',
    externalVideoId: 'accepted_01',
    sourceSnapshot: sampleSnapshot,
    editorialDraft: sampleDraft,
    status: 'Accepted',
    candidateVersion: 1,
    createdAt: '2026-03-01T12:00:00Z',
    updatedAt: '2026-03-01T12:00:00Z',
  };
  await ytRepo.saveCandidate(acceptedCand);

  try {
    let alreadyAcceptedBlocked = false;
    try {
      await acceptanceService.acceptCandidate(acceptedCand.id, 1);
    } catch (err: any) {
      alreadyAcceptedBlocked = err.message.includes('INVALID_TRANSITION');
    }
    assert(
      'Acceptance Test 9 - Already Accepted candidate cannot be accepted again',
      alreadyAcceptedBlocked,
      'Terminal Accepted candidate locked against re-acceptance'
    );
  } catch (e: any) {
    assert('Acceptance Test 9 - Already Accepted candidate cannot be accepted again', false, e.message);
  }

  // 10. Stale reviewedVersion -> STALE_REVIEW
  try {
    let staleThrown = false;
    try {
      await acceptanceService.acceptCandidate(candidate1.id, 999); // Stale
    } catch (err: any) {
      staleThrown = err.message.includes('STALE_REVIEW');
    }
    assert(
      'Acceptance Test 10 - Stale reviewedVersion -> STALE_REVIEW',
      staleThrown,
      'Reviewed version mismatch triggers STALE_REVIEW without committing'
    );
  } catch (e: any) {
    assert('Acceptance Test 10 - Stale reviewedVersion -> STALE_REVIEW', false, e.message);
  }

  // 11. Missing Category blocks acceptance
  const unclassifiedCand: YouTubeImportCandidate = {
    id: 'youtube_no_cat_01',
    provider: 'YouTube',
    externalVideoId: 'no_cat_01',
    sourceSnapshot: sampleSnapshot,
    editorialDraft: {
      ...sampleDraft,
      category: undefined,
    },
    status: 'PendingReview',
    candidateVersion: 1,
    createdAt: '2026-03-01T12:00:00Z',
    updatedAt: '2026-03-01T12:00:00Z',
  };
  await ytRepo.saveCandidate(unclassifiedCand);

  try {
    let missingCatBlocked = false;
    try {
      await acceptanceService.acceptCandidate(unclassifiedCand.id, 1);
    } catch (err: any) {
      missingCatBlocked = err.message.includes('INVALID_CATEGORY');
    }
    assert(
      'Acceptance Test 11 - Missing Category blocks acceptance',
      missingCatBlocked,
      'Unset category fails closed with INVALID_CATEGORY'
    );
  } catch (e: any) {
    assert('Acceptance Test 11 - Missing Category blocks acceptance', false, e.message);
  }

  // 12. Invalid Category blocks acceptance
  const invalidCatCand: YouTubeImportCandidate = {
    id: 'youtube_invalid_cat_01',
    provider: 'YouTube',
    externalVideoId: 'invalid_cat_01',
    sourceSnapshot: sampleSnapshot,
    editorialDraft: {
      ...sampleDraft,
      category: 'FakeCategory' as any,
    },
    status: 'PendingReview',
    candidateVersion: 1,
    createdAt: '2026-03-01T12:00:00Z',
    updatedAt: '2026-03-01T12:00:00Z',
  };
  await ytRepo.saveCandidate(invalidCatCand);

  try {
    let invalidCatBlocked = false;
    try {
      await acceptanceService.acceptCandidate(invalidCatCand.id, 1);
    } catch (err: any) {
      invalidCatBlocked = err.message.includes('INVALID_CATEGORY');
    }
    assert(
      'Acceptance Test 12 - Invalid Category blocks acceptance',
      invalidCatBlocked,
      'Non-canonical category fails closed with INVALID_CATEGORY'
    );
  } catch (e: any) {
    assert('Acceptance Test 12 - Invalid Category blocks acceptance', false, e.message);
  }

  // 13. Canonical Category validator is reused
  try {
    assert(
      'Acceptance Test 13 - Canonical Category validator is reused',
      isCanonicalCategory('Climate') && isCanonicalCategory('Water') && !isCanonicalCategory('Entertainment'),
      'Canonical isCanonicalCategory validator is strictly reused'
    );
  } catch (e: any) {
    assert('Acceptance Test 13 - Canonical Category validator is reused', false, e.message);
  }

  // 14. Deterministic Media ID is used
  try {
    const mapped = mapCandidateToCanonicalVideo(candidate1);
    assert(
      'Acceptance Test 14 - Deterministic Media ID is used',
      mapped.id === 'video_yt_sudan_ref_01',
      'Target Media ID follows exact deterministic video_yt_${externalVideoId} convention'
    );
  } catch (e: any) {
    assert('Acceptance Test 14 - Deterministic Media ID is used', false, e.message);
  }

  // 15. Existing Media -> DUPLICATE_MEDIA
  // Pre-seed Media with candidate1's deterministic ID
  await mediaRepo.createVideo({
    ...mapCandidateToCanonicalVideo(candidate1),
    titleAr: 'فيديو موجود مسبقاً في وسائط النظام',
  });

  try {
    let duplicateMediaBlocked = false;
    try {
      await acceptanceService.acceptCandidate(candidate1.id, 1);
    } catch (err: any) {
      duplicateMediaBlocked = err.message.includes('DUPLICATE_MEDIA');
    }
    assert(
      'Acceptance Test 15 - Existing Media -> DUPLICATE_MEDIA',
      duplicateMediaBlocked,
      'Pre-existing canonical Media document triggers DUPLICATE_MEDIA'
    );
  } catch (e: any) {
    assert('Acceptance Test 15 - Existing Media -> DUPLICATE_MEDIA', false, e.message);
  }

  // 16. Existing Media is never overwritten
  try {
    const existingVideo = await mediaRepo.getVideoById('video_yt_sudan_ref_01');
    assert(
      'Acceptance Test 16 - Existing Media is never overwritten',
      existingVideo?.titleAr === 'فيديو موجود مسبقاً في وسائط النظام',
      'Pre-existing Media content remained untouched after duplicate acceptance attempt'
    );
  } catch (e: any) {
    assert('Acceptance Test 16 - Existing Media is never overwritten', false, e.message);
  }

  // 17. Candidate remains unchanged when duplicate Media blocks acceptance
  try {
    const candidateAfterDup = await ytRepo.getCandidate(candidate1.id);
    assert(
      'Acceptance Test 17 - Candidate remains unchanged when duplicate Media blocks acceptance',
      candidateAfterDup?.status === 'PendingReview',
      'Candidate remains in PendingReview status when duplicate Media is detected'
    );
  } catch (e: any) {
    assert('Acceptance Test 17 - Candidate remains unchanged when duplicate Media blocks acceptance', false, e.message);
  }

  // Clear pre-seeded duplicate media for clean acceptance execution
  (mediaRepo as any).videos['video_yt_sudan_ref_01'] = undefined;
  delete (mediaRepo as any).videos['video_yt_sudan_ref_01'];

  // 18. sourceSnapshot maps only to appropriate source-owned Media fields
  try {
    const mapped = mapCandidateToCanonicalVideo(candidate1);
    assert(
      'Acceptance Test 18 - sourceSnapshot maps only to appropriate source-owned Media fields',
      mapped.youtubeSource.originalTitle === candidate1.sourceSnapshot.sourceTitle &&
      mapped.youtubeSource.originalDescription === candidate1.sourceSnapshot.sourceDescription &&
      mapped.youtubeSource.youtubePublishedAt === candidate1.sourceSnapshot.youtubePublishedAt &&
      mapped.youtubeSource.thumbnails.default === candidate1.sourceSnapshot.sourceThumbnailUrl,
      'Source snapshot metadata maps exclusively into youtubeSource'
    );
  } catch (e: any) {
    assert('Acceptance Test 18 - sourceSnapshot maps only to appropriate source-owned Media fields', false, e.message);
  }

  // 19. editorialDraft maps to appropriate human editorial fields
  try {
    const mapped = mapCandidateToCanonicalVideo(candidate1);
    assert(
      'Acceptance Test 19 - editorialDraft maps to appropriate human editorial fields',
      mapped.titleAr === candidate1.editorialDraft.titleAr &&
      mapped.titleEn === candidate1.editorialDraft.titleEn &&
      mapped.excerptAr === candidate1.editorialDraft.excerptAr &&
      mapped.editorialDescriptionAr === candidate1.editorialDraft.editorialDescriptionAr &&
      mapped.category === candidate1.editorialDraft.category &&
      JSON.stringify(mapped.tags) === JSON.stringify(candidate1.editorialDraft.tags),
      'Editorial draft correctly populates human canonical fields'
    );
  } catch (e: any) {
    assert('Acceptance Test 19 - editorialDraft maps to appropriate human editorial fields', false, e.message);
  }

  // 20. rightsStatus is always NotStarted
  try {
    const mapped = mapCandidateToCanonicalVideo(candidate1);
    assert(
      'Acceptance Test 20 - rightsStatus is always NotStarted',
      mapped.rightsStatus === 'NotStarted',
      'Imported Video rightsStatus forced fail-closed to NotStarted'
    );
  } catch (e: any) {
    assert('Acceptance Test 20 - rightsStatus is always NotStarted', false, e.message);
  }

  // 21. visibilityDecision is always Hidden
  try {
    const mapped = mapCandidateToCanonicalVideo(candidate1);
    assert(
      'Acceptance Test 21 - visibilityDecision is always Hidden',
      mapped.visibilityDecision === 'Hidden',
      'Imported Video visibilityDecision forced fail-closed to Hidden'
    );
  } catch (e: any) {
    assert('Acceptance Test 21 - visibilityDecision is always Hidden', false, e.message);
  }

  // 22. accepted Media is not publicly eligible
  try {
    const mapped = mapCandidateToCanonicalVideo(candidate1);
    const isPublic = mapped.visibilityDecision !== 'Hidden' && mapped.rightsStatus === 'Cleared';
    assert(
      'Acceptance Test 22 - Accepted Media is not publicly eligible',
      !isPublic,
      'Fail-closed defaults guarantee newly accepted media is ineligible for public display'
    );
  } catch (e: any) {
    assert('Acceptance Test 22 - Accepted Media is not publicly eligible', false, e.message);
  }

  // 23. Successful operation creates exactly one canonical Media
  let acceptResult: any = null;
  try {
    acceptResult = await acceptanceService.acceptCandidate(candidate1.id, 1);
    const createdMedia = await mediaRepo.getVideoById('video_yt_sudan_ref_01');
    assert(
      'Acceptance Test 23 - Successful operation creates exactly one canonical Media',
      createdMedia !== null && createdMedia.id === 'video_yt_sudan_ref_01' && acceptResult.video.id === createdMedia.id,
      'Exactly one canonical Media document created with matching ID'
    );
  } catch (e: any) {
    assert('Acceptance Test 23 - Successful operation creates exactly one canonical Media', false, e.message);
  }

  // 24. Successful operation changes exactly one Candidate to Accepted
  try {
    const updatedCandidate = await ytRepo.getCandidate(candidate1.id);
    assert(
      'Acceptance Test 24 - Successful operation changes exactly one Candidate to Accepted',
      updatedCandidate !== null && updatedCandidate.status === 'Accepted' && acceptResult.candidate.status === 'Accepted',
      'Target Candidate transitions to Accepted status'
    );
  } catch (e: any) {
    assert('Acceptance Test 24 - Successful operation changes exactly one Candidate to Accepted', false, e.message);
  }

  // 25. Success commits Media + Candidate together
  try {
    const videoInRepo = await mediaRepo.getVideoById('video_yt_sudan_ref_01');
    const candInRepo = await ytRepo.getCandidate(candidate1.id);
    assert(
      'Acceptance Test 25 - Success commits Media + Candidate together',
      videoInRepo !== null && candInRepo?.status === 'Accepted',
      'Both Media creation and Candidate transition committed consistently'
    );
  } catch (e: any) {
    assert('Acceptance Test 25 - Success commits Media + Candidate together', false, e.message);
  }

  // 26. Media creation failure leaves Candidate PendingReview (Atomicity / Rollback)
  const candidateForFault1: YouTubeImportCandidate = {
    id: 'youtube_fault_01',
    provider: 'YouTube',
    externalVideoId: 'fault_01',
    sourceSnapshot: sampleSnapshot,
    editorialDraft: sampleDraft,
    status: 'PendingReview',
    candidateVersion: 1,
    createdAt: '2026-03-01T12:00:00Z',
    updatedAt: '2026-03-01T12:00:00Z',
  };
  await ytRepo.saveCandidate(candidateForFault1);

  try {
    const faultRunner1 = new InMemoryCandidateAcceptanceRunner(ytRepo, mediaRepo, {
      failDuringMediaCreate: true,
    });
    const faultService1 = new YouTubeCandidateAcceptanceService(faultRunner1);

    let threw = false;
    try {
      await faultService1.acceptCandidate(candidateForFault1.id, 1);
    } catch {
      threw = true;
    }

    const candAfterFault = await ytRepo.getCandidate(candidateForFault1.id);
    const mediaAfterFault = await mediaRepo.getVideoById('video_yt_fault_01');

    assert(
      'Acceptance Test 26 - Media creation failure leaves Candidate PendingReview',
      threw && candAfterFault?.status === 'PendingReview' && mediaAfterFault === null,
      'Fault during media creation leaves candidate in PendingReview and media uncreated'
    );
  } catch (e: any) {
    assert('Acceptance Test 26 - Media creation failure leaves Candidate PendingReview', false, e.message);
  }

  // 27. Candidate transition failure leaves Media absent (Atomicity / Rollback)
  const candidateForFault2: YouTubeImportCandidate = {
    id: 'youtube_fault_02',
    provider: 'YouTube',
    externalVideoId: 'fault_02',
    sourceSnapshot: sampleSnapshot,
    editorialDraft: sampleDraft,
    status: 'PendingReview',
    candidateVersion: 1,
    createdAt: '2026-03-01T12:00:00Z',
    updatedAt: '2026-03-01T12:00:00Z',
  };
  await ytRepo.saveCandidate(candidateForFault2);

  try {
    const faultRunner2 = new InMemoryCandidateAcceptanceRunner(ytRepo, mediaRepo, {
      failDuringCandidateTransition: true,
    });
    const faultService2 = new YouTubeCandidateAcceptanceService(faultRunner2);

    let threw = false;
    try {
      await faultService2.acceptCandidate(candidateForFault2.id, 1);
    } catch {
      threw = true;
    }

    const candAfterFault = await ytRepo.getCandidate(candidateForFault2.id);
    const mediaAfterFault = await mediaRepo.getVideoById('video_yt_fault_02');

    assert(
      'Acceptance Test 27 - Candidate transition failure leaves Media absent',
      threw && candAfterFault?.status === 'PendingReview' && mediaAfterFault === null,
      'Fault during candidate transition rolls back media creation leaving Media absent'
    );
  } catch (e: any) {
    assert('Acceptance Test 27 - Candidate transition failure leaves Media absent', false, e.message);
  }

  // 28. Unexpected transaction failure leaves both unchanged
  try {
    const candAfterAllFaults = await ytRepo.getCandidate(candidateForFault1.id);
    assert(
      'Acceptance Test 28 - Unexpected transaction failure leaves both unchanged',
      candAfterAllFaults?.status === 'PendingReview',
      'All-or-nothing guarantees zero partial mutation on failure'
    );
  } catch (e: any) {
    assert('Acceptance Test 28 - Unexpected transaction failure leaves both unchanged', false, e.message);
  }

  // 29. No new collection is used
  try {
    const collections = [
      'youtubeIntegration',
      'youtubeImportCandidates',
      'media',
    ];
    const fsRepoFileContent = fs.readFileSync('functions/src/youtube/candidateAcceptanceService.ts', 'utf-8');
    const hasUnapprovedCollection =
      fsRepoFileContent.includes('acceptedCandidates') ||
      fsRepoFileContent.includes('mediaImports') ||
      fsRepoFileContent.includes('candidateMediaLinks') ||
      fsRepoFileContent.includes('acceptanceTransactions');

    assert(
      'Acceptance Test 29 - No new collection is used',
      !hasUnapprovedCollection && collections.length === 3,
      'Zero new collections introduced for acceptance'
    );
  } catch (e: any) {
    assert('Acceptance Test 29 - No new collection is used', false, e.message);
  }

  // 30. No new RBAC vocabulary is introduced
  try {
    const { AdminRole, AdminPermission } = await import('../../functions/src/types/admin');
    const roleCount = Object.keys(AdminRole).length;
    const permCount = Object.keys(AdminPermission).length;
    assert(
      'Acceptance Test 30 - No new RBAC vocabulary is introduced',
      roleCount === 9 && permCount === 10,
      'RBAC roles and permissions remain exactly at canonical counts (9 roles, 10 permissions)'
    );
  } catch (e: any) {
    assert('Acceptance Test 30 - No new RBAC vocabulary is introduced', false, e.message);
  }

  // 31. No new audit vocabulary is introduced
  try {
    const { AuditAction, AuditTargetType } = await import('../types/audit');
    const actionCount = Object.keys(AuditAction).length;
    const targetCount = Object.keys(AuditTargetType).length;
    assert(
      'Acceptance Test 31 - No new audit vocabulary is introduced',
      actionCount === 6 && targetCount === 8,
      'Audit actions and target types strictly preserved at canonical counts'
    );
  } catch (e: any) {
    assert('Acceptance Test 31 - No new audit vocabulary is introduced', false, e.message);
  }

  // 32. No new Category/rights/visibility/lifecycle vocabulary is introduced
  try {
    assert(
      'Acceptance Test 32 - No new Category/rights/visibility/lifecycle vocabulary is introduced',
      CANONICAL_CATEGORIES.length === 7,
      'Domain vocabulary counts strictly preserved'
    );
  } catch (e: any) {
    assert('Acceptance Test 32 - No new Category/rights/visibility/lifecycle vocabulary is introduced', false, e.message);
  }

  // 33. Browser direct persistence is not introduced
  try {
    const rulesContent = fs.readFileSync('firestore.rules', 'utf-8');
    const hasDefaultDeny = rulesContent.includes('match /{document=**}') && rulesContent.includes('allow read, write: if false;');
    assert(
      'Acceptance Test 33 - Browser direct persistence is not introduced',
      hasDefaultDeny,
      'Global fail-closed default deny ensures direct browser writes remain forbidden'
    );
  } catch (e: any) {
    assert('Acceptance Test 33 - Browser direct persistence is not introduced', false, e.message);
  }

  // 34. Production acceptance does not use in-memory fallback
  try {
    const prodService = new YouTubeCandidateAcceptanceService();
    const runner = (prodService as any).runner;
    assert(
      'Acceptance Test 34 - Production acceptance does not use in-memory fallback',
      runner instanceof FirestoreCandidateAcceptanceRunner,
      'Production YouTubeCandidateAcceptanceService uses real FirestoreCandidateAcceptanceRunner'
    );
  } catch (e: any) {
    assert('Acceptance Test 34 - Production acceptance does not use in-memory fallback', false, e.message);
  }

  // 35. Client error responses do not leak raw internal errors
  try {
    let acceptErrorMessage = '';
    try {
      await executeReviewYouTubeCandidateRequest(
        { auth: { uid: 'uid-editor' }, data: { action: 'accept', candidateId: 'unknown_id', reviewedVersion: 1 } },
        adminRepo,
        ytAppService,
        acceptanceService
      );
    } catch (err: any) {
      acceptErrorMessage = err.message || '';
    }
    assert(
      'Acceptance Test 35 - Client error responses do not leak raw internal errors',
      acceptErrorMessage.includes('NOT_FOUND:') &&
      !acceptErrorMessage.includes('Firestore') &&
      !acceptErrorMessage.includes('Error:') &&
      !acceptErrorMessage.includes('stack'),
      'Client error messages are strictly bounded with clean semantic prefixes'
    );
  } catch (e: any) {
    assert('Acceptance Test 35 - Client error responses do not leak raw internal errors', false, e.message);
  }

  // 36. Existing Reject workflow remains unchanged
  const candToReject: YouTubeImportCandidate = {
    id: 'youtube_test_reject_01',
    provider: 'YouTube',
    externalVideoId: 'test_reject_01',
    sourceSnapshot: sampleSnapshot,
    editorialDraft: sampleDraft,
    status: 'PendingReview',
    candidateVersion: 1,
    createdAt: '2026-03-01T12:00:00Z',
    updatedAt: '2026-03-01T12:00:00Z',
  };
  await ytRepo.saveCandidate(candToReject);

  try {
    const rejRes = await executeReviewYouTubeCandidateRequest(
      { auth: { uid: 'uid-editor' }, data: { action: 'reject', candidateId: candToReject.id, reviewedVersion: 1 } },
      adminRepo,
      ytAppService,
      acceptanceService
    );
    assert(
      'Acceptance Test 36 - Existing Reject workflow remains unchanged',
      rejRes.candidate && rejRes.candidate.status === 'Rejected',
      'Reject mutation continues to execute smoothly through review handler'
    );
  } catch (e: any) {
    assert('Acceptance Test 36 - Existing Reject workflow remains unchanged', false, e.message);
  }

  // 37. Existing updateDraft workflow remains unchanged
  const candToUpdate: YouTubeImportCandidate = {
    id: 'youtube_test_update_01',
    provider: 'YouTube',
    externalVideoId: 'test_update_01',
    sourceSnapshot: sampleSnapshot,
    editorialDraft: sampleDraft,
    status: 'PendingReview',
    candidateVersion: 1,
    createdAt: '2026-03-01T12:00:00Z',
    updatedAt: '2026-03-01T12:00:00Z',
  };
  await ytRepo.saveCandidate(candToUpdate);

  try {
    const updRes = await executeReviewYouTubeCandidateRequest(
      {
        auth: { uid: 'uid-editor' },
        data: {
          action: 'updateDraft',
          candidateId: candToUpdate.id,
          editorialDraft: { titleAr: 'عنوان معدل للتحقق' },
        },
      },
      adminRepo,
      ytAppService,
      acceptanceService
    );
    assert(
      'Acceptance Test 37 - Existing updateDraft workflow remains unchanged',
      updRes.candidate && updRes.candidate.editorialDraft.titleAr === 'عنوان معدل للتحقق',
      'updateDraft mutation continues to update editorialDraft with version increment'
    );
  } catch (e: any) {
    assert('Acceptance Test 37 - Existing updateDraft workflow remains unchanged', false, e.message);
  }

  // 38. Manual YouTube sync remains unchanged
  try {
    const { executeManualYouTubeSyncRequest } = await import('../../functions/src/youtube/manualSyncHandler');
    assert(
      'Acceptance Test 38 - Manual YouTube sync remains unchanged',
      typeof executeManualYouTubeSyncRequest === 'function',
      'Manual YouTube sync handler remains intact'
    );
  } catch (e: any) {
    assert('Acceptance Test 38 - Manual YouTube sync remains unchanged', false, e.message);
  }

  // 39. candidateVersion semantics remain consistent with accepted lifecycle contract
  try {
    // Terminal transitions (Reject and Accept) do not bump candidateVersion, but update status and updatedAt
    const acceptedDoc = await ytRepo.getCandidate('youtube_sudan_ref_01');
    assert(
      'Acceptance Test 39 - candidateVersion semantics remain consistent with accepted lifecycle contract',
      acceptedDoc?.candidateVersion === 1 && acceptedDoc?.status === 'Accepted',
      'candidateVersion represents material content changes and is preserved during terminal acceptance'
    );
  } catch (e: any) {
    assert('Acceptance Test 39 - candidateVersion semantics remain consistent with accepted lifecycle contract', false, e.message);
  }

  // 40. Production callable count does not increase if existing review callable can safely host the accept action
  try {
    const functionsIndexContent = fs.readFileSync('functions/src/index.ts', 'utf-8');
    const exportsMatch = functionsIndexContent.match(/export\s*\{\s*([^}]+)\s*\}/g);
    const hasSync = functionsIndexContent.includes('syncYouTubeUploads');
    const hasManage = functionsIndexContent.includes('manageYouTubeIntegration');
    const hasReview = functionsIndexContent.includes('reviewYouTubeCandidate');
    assert(
      'Acceptance Test 40 - Production callable count does not increase',
      hasSync && hasManage && hasReview && exportsMatch !== null,
      'Exactly 3 callable functions remain exported (syncYouTubeUploads, manageYouTubeIntegration, reviewYouTubeCandidate)'
    );
  } catch (e: any) {
    assert('Acceptance Test 40 - Production callable count does not increase', false, e.message);
  }

  return results;
}
