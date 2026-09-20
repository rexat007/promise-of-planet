import { getFirestore } from 'firebase-admin/firestore';
import type { YouTubeImportCandidate } from '../types/youtube';
import type { Video } from '../types/media';
import { isCanonicalCategory } from '../types/youtube';
import { mapCandidateToCanonicalVideo } from './candidateVideoMapper';
import type { InMemoryYouTubeRepository } from './inMemoryYouTubeRepository';
import type { InMemoryMediaRepository } from '../media/inMemoryMediaRepository';

export interface AcceptCandidateResult {
  candidate: YouTubeImportCandidate;
  video: Video;
}

export interface YouTubeCandidateAcceptanceTransactionRunner {
  acceptCandidateAtomic(
    candidateId: string,
    reviewedVersion: number,
    actorIdentity?: string
  ): Promise<AcceptCandidateResult>;
}

/**
 * Production Firestore Transaction Implementation.
 * Runs ONE atomic Firestore transaction across:
 * - youtubeImportCandidates/{candidateId}
 * - media/{canonicalMediaId}
 *
 * Enforces all 10 atomicity steps:
 * 1. Read candidate doc
 * 2. Verify exists
 * 3. Verify status === 'PendingReview'
 * 4. Verify reviewedVersion === candidateVersion
 * 5. Validate category is valid canonical Category
 * 6. Derive canonical Media document using pure mapper
 * 7. Read media doc and verify it does NOT exist (DUPLICATE_MEDIA check)
 * 8. Set canonical Media document
 * 9. Set Candidate document with status='Accepted' (preserving existing candidateVersion and schema)
 * 10. Commit both writes together atomically
 */
export class FirestoreCandidateAcceptanceRunner implements YouTubeCandidateAcceptanceTransactionRunner {
  private get db() {
    return getFirestore();
  }

  async acceptCandidateAtomic(
    candidateId: string,
    reviewedVersion: number,
    actorIdentity?: string
  ): Promise<AcceptCandidateResult> {
    const candidateRef = this.db.collection('youtubeImportCandidates').doc(candidateId);

    return this.db.runTransaction(async transaction => {
      // 1. Read candidate doc
      const candidateSnap = await transaction.get(candidateRef);

      // 2. Verify existence
      if (!candidateSnap.exists) {
        throw new Error(`NOT_FOUND: Candidate with ID ${candidateId} was not found`);
      }

      const candidate = candidateSnap.data() as YouTubeImportCandidate;

      // 3. Verify status === 'PendingReview'
      if (candidate.status !== 'PendingReview') {
        throw new Error(`INVALID_TRANSITION: Candidate is already in terminal state '${candidate.status}'`);
      }

      // 4. Verify reviewedVersion === candidateVersion (Stale review protection)
      if (candidate.candidateVersion !== reviewedVersion) {
        throw new Error('STALE_REVIEW: Candidate material was updated since review began');
      }

      // 5. Validate acceptance prerequisites (Canonical Category required)
      if (!candidate.editorialDraft.category || !isCanonicalCategory(candidate.editorialDraft.category)) {
        throw new Error('INVALID_CATEGORY: Canonical Category must be assigned by a human editor before acceptance');
      }

      // 6. Derive canonical Media document
      const nowIso = new Date().toISOString();
      const video = mapCandidateToCanonicalVideo(candidate, nowIso, actorIdentity);

      // 7. Check deterministic Media document does not already exist
      const mediaRef = this.db.collection('media').doc(video.id);
      const mediaSnap = await transaction.get(mediaRef);
      if (mediaSnap.exists) {
        throw new Error(`DUPLICATE_MEDIA: Video with ID ${video.id} already exists`);
      }

      // 8. Create canonical Media write
      transaction.set(mediaRef, video);

      // 9. Transition Candidate to Accepted write
      const updatedCandidate: YouTubeImportCandidate = {
        ...candidate,
        status: 'Accepted',
        updatedAt: nowIso,
      };
      transaction.set(candidateRef, updatedCandidate);

      return {
        candidate: updatedCandidate,
        video,
      };
    });
  }
}

/**
 * Isolated In-Memory Acceptance Transaction Double for Test Execution.
 * Guarantees all-or-nothing transactional semantics across in-memory candidate and media repositories.
 * Supports optional fault injection to mathematically verify rollback / no partial commits.
 */
export class InMemoryCandidateAcceptanceRunner implements YouTubeCandidateAcceptanceTransactionRunner {
  private ytRepo: InMemoryYouTubeRepository;
  private mediaRepo: InMemoryMediaRepository;
  private faultInjection?: {
    failDuringMediaCreate?: boolean;
    failDuringCandidateTransition?: boolean;
  };

  constructor(
    ytRepo: InMemoryYouTubeRepository,
    mediaRepo: InMemoryMediaRepository,
    faultInjection?: {
      failDuringMediaCreate?: boolean;
      failDuringCandidateTransition?: boolean;
    }
  ) {
    this.ytRepo = ytRepo;
    this.mediaRepo = mediaRepo;
    this.faultInjection = faultInjection;
  }

  async acceptCandidateAtomic(
    candidateId: string,
    reviewedVersion: number,
    actorIdentity?: string
  ): Promise<AcceptCandidateResult> {
    // 1. Read candidate
    const candidate = await this.ytRepo.getCandidate(candidateId);

    // 2. Verify existence
    if (!candidate) {
      throw new Error(`NOT_FOUND: Candidate with ID ${candidateId} was not found`);
    }

    // 3. Verify status === 'PendingReview'
    if (candidate.status !== 'PendingReview') {
      throw new Error(`INVALID_TRANSITION: Candidate is already in terminal state '${candidate.status}'`);
    }

    // 4. Verify reviewedVersion === candidateVersion
    if (candidate.candidateVersion !== reviewedVersion) {
      throw new Error('STALE_REVIEW: Candidate material was updated since review began');
    }

    // 5. Validate canonical Category
    if (!candidate.editorialDraft.category || !isCanonicalCategory(candidate.editorialDraft.category)) {
      throw new Error('INVALID_CATEGORY: Canonical Category must be assigned by a human editor before acceptance');
    }

    // 6. Derive canonical Media
    const nowIso = new Date().toISOString();
    const video = mapCandidateToCanonicalVideo(candidate, nowIso, actorIdentity);

    // 7. Check existing Media
    const existingVideo = await this.mediaRepo.getVideoById(video.id);
    if (existingVideo) {
      throw new Error(`DUPLICATE_MEDIA: Video with ID ${video.id} already exists`);
    }

    // Take clean type-safe snapshots for atomic rollback
    const mediaSnapshot = this.mediaRepo.takeSnapshot();
    const ytSnapshot = this.ytRepo.takeSnapshot();

    try {
      // 8. Create media
      if (this.faultInjection?.failDuringMediaCreate) {
        throw new Error('FAULT_INJECTION: Simulated Media creation failure');
      }
      await this.mediaRepo.createVideo(video);

      // 9. Transition candidate
      if (this.faultInjection?.failDuringCandidateTransition) {
        throw new Error('FAULT_INJECTION: Simulated Candidate transition failure');
      }
      const updatedCandidate: YouTubeImportCandidate = {
        ...candidate,
        status: 'Accepted',
        updatedAt: nowIso,
      };
      await this.ytRepo.saveCandidate(updatedCandidate);

      return {
        candidate: updatedCandidate,
        video,
      };
    } catch (err) {
      // Clean, encapsulated rollback without touching private fields
      this.mediaRepo.restoreSnapshot(mediaSnapshot);
      this.ytRepo.restoreSnapshot(ytSnapshot);
      throw err;
    }
  }
}

/**
 * Service boundary for YouTube candidate acceptance.
 * Reuses the injected transaction runner (defaults to Firestore in production).
 */
export class YouTubeCandidateAcceptanceService {
  private runner: YouTubeCandidateAcceptanceTransactionRunner;

  constructor(runner?: YouTubeCandidateAcceptanceTransactionRunner) {
    this.runner = runner || new FirestoreCandidateAcceptanceRunner();
  }

  public async acceptCandidate(
    candidateId: string,
    reviewedVersion: number,
    actorIdentity?: string
  ): Promise<AcceptCandidateResult> {
    if (!candidateId || typeof candidateId !== 'string' || candidateId.trim() === '') {
      throw new Error('INVALID_ARGUMENT: candidateId is required');
    }
    if (typeof reviewedVersion !== 'number') {
      throw new Error('INVALID_ARGUMENT: reviewedVersion must be a number');
    }

    return this.runner.acceptCandidateAtomic(candidateId.trim(), reviewedVersion, actorIdentity);
  }
}
