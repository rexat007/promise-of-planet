import {
  type YouTubeImportCandidate,
  isCanonicalCategory,
} from '../types/youtube';
import type { Video, YouTubeSource } from '../types/media';

/**
 * Pure mapping function from an accepted YouTubeImportCandidate to a canonical Video domain model.
 *
 * Truthful Source Mapping & Segregation:
 * 1. SOURCE-OWNED DATA: Populates `youtubeSource` exclusively from `candidate.sourceSnapshot`
 *    and deterministic facts. Does NOT fabricate unknown channel details, durations,
 *    availability statuses, or pretend acceptance time is a sync time.
 * 2. HUMAN EDITORIAL DATA: Populates canonical editorial fields (`titleAr`, `titleEn`,
 *    `excerptAr`, `excerptEn`, `editorialDescriptionAr`, `editorialDescriptionEn`, `category`,
 *    `tags`) strictly from `candidate.editorialDraft`.
 * 3. ACCEPTING ACTOR: If an authenticated admin identity is provided, maps to `editor`.
 *    Never fabricates a literal "Editor" string.
 * 4. FAIL-CLOSED GOVERNANCE: Always initializes with `rightsStatus = 'NotStarted'` and
 *    `visibilityDecision = 'Hidden'`.
 */
export function mapCandidateToCanonicalVideo(
  candidate: YouTubeImportCandidate,
  nowIso: string = new Date().toISOString(),
  actorIdentity?: string
): Video {
  if (!candidate.editorialDraft.category || !isCanonicalCategory(candidate.editorialDraft.category)) {
    throw new Error('INVALID_CATEGORY: Candidate must have a valid canonical Category before mapping to Video');
  }

  const externalVideoId = candidate.externalVideoId;
  const canonicalId = `video_yt_${externalVideoId}`;

  // Source-owned data: strictly populated from candidate source snapshot without fabricated placeholders.
  const youtubeSource: YouTubeSource = {
    youtubeVideoId: externalVideoId,
    youtubeUrl: `https://youtube.com/watch?v=${externalVideoId}`,
    originalTitle: candidate.sourceSnapshot.sourceTitle,
    originalDescription: candidate.sourceSnapshot.sourceDescription,
    youtubePublishedAt: candidate.sourceSnapshot.youtubePublishedAt,
    thumbnails: {
      default: candidate.sourceSnapshot.sourceThumbnailUrl,
    },
  };

  const video: Video = {
    id: canonicalId,
    contentType: 'Video',
    status: 'Draft',
    category: candidate.editorialDraft.category,
    titleAr: candidate.editorialDraft.titleAr,
    titleEn: candidate.editorialDraft.titleEn || undefined,
    excerptAr: candidate.editorialDraft.excerptAr,
    excerptEn: candidate.editorialDraft.excerptEn || undefined,
    editorialDescriptionAr: candidate.editorialDraft.editorialDescriptionAr,
    editorialDescriptionEn: candidate.editorialDraft.editorialDescriptionEn || undefined,
    tags: [...candidate.editorialDraft.tags],
    approvalStatus: 'Pending',
    rightsStatus: 'NotStarted', // FAIL-CLOSED
    visibilityDecision: 'Hidden', // FAIL-CLOSED
    createdAt: nowIso,
    updatedAt: nowIso,
    youtubeSource,
    ...(actorIdentity && actorIdentity.trim() !== '' ? { editor: actorIdentity.trim() } : {}),
  };

  return video;
}
