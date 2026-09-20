import {
  type YouTubeImportCandidate,
  isCanonicalCategory,
} from '../types/youtube';
import type { Video, YouTubeSource } from '../types/media';

/**
 * Pure mapping function from an accepted YouTubeImportCandidate to a canonical Video domain model.
 *
 * Source Segregation & Provenance:
 * 1. SOURCE-OWNED DATA: Populates `youtubeSource` exclusively from `candidate.sourceSnapshot`
 *    and deterministic identity.
 * 2. HUMAN EDITORIAL DATA: Populates canonical editorial fields (`titleAr`, `titleEn`,
 *    `excerptAr`, `excerptEn`, `editorialDescriptionAr`, `editorialDescriptionEn`, `category`,
 *    `tags`) strictly from `candidate.editorialDraft`.
 * 3. FAIL-CLOSED GOVERNANCE: Always initializes with `rightsStatus = 'NotStarted'` and
 *    `visibilityDecision = 'Hidden'`.
 *
 * Truthful Default Documentation:
 * - `status`: 'Draft' (Newly accepted video is in draft state pending full editorial workflow).
 * - `approvalStatus`: 'Pending' (Requires formal editorial sign-off).
 * - `originalLanguage`: 'ar' (Arabic is the primary platform language).
 * - `availableLanguages`: ['ar'] (Arabic primary; English translation optional).
 * - `translationStatus`: 'NotRequired' (Default translation lifecycle status).
 * - `author`: '' (YouTube ingestion has no explicit platform author).
 * - `producer`: '' (Blank until assigned by media team).
 * - `editor`: 'Editor' (Default editorial role handler).
 * - `sources`: [] (External journalistic sources empty initially).
 * - `rightsNotes`: '' (Legal review notes initialized empty).
 * - `editorialThumbnail`: undefined (Can be overridden by editors later).
 * - `youtubeSource.duration`: 'PT0M' (Playlist-level items default; details updated during fetch if present).
 * - `youtubeSource.availabilityStatus`: 'Available' (Active on YouTube at time of acceptance).
 * - `youtubeSource.channelUrl`: Derived from channelId or empty if not provided.
 */
export function mapCandidateToCanonicalVideo(
  candidate: YouTubeImportCandidate,
  nowIso: string = new Date().toISOString()
): Video {
  if (!candidate.editorialDraft.category || !isCanonicalCategory(candidate.editorialDraft.category)) {
    throw new Error('INVALID_CATEGORY: Candidate must have a valid canonical Category before mapping to Video');
  }

  const externalVideoId = candidate.externalVideoId;
  const canonicalId = `video_yt_${externalVideoId}`;

  const youtubeSource: YouTubeSource = {
    youtubeVideoId: externalVideoId,
    youtubeUrl: `https://youtube.com/watch?v=${externalVideoId}`,
    channelId: '',
    channelName: '',
    channelUrl: '',
    originalTitle: candidate.sourceSnapshot.sourceTitle,
    originalDescription: candidate.sourceSnapshot.sourceDescription,
    youtubePublishedAt: candidate.sourceSnapshot.youtubePublishedAt,
    thumbnails: {
      default: candidate.sourceSnapshot.sourceThumbnailUrl,
    },
    duration: 'PT0M',
    availabilityStatus: 'Available',
    lastSyncedAt: nowIso,
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
    originalLanguage: 'ar',
    availableLanguages: candidate.editorialDraft.titleEn ? ['ar', 'en'] : ['ar'],
    translationStatus: candidate.editorialDraft.titleEn ? 'Completed' : 'NotRequired',
    author: '',
    producer: '',
    editor: 'Editor',
    approvalStatus: 'Pending',
    rightsStatus: 'NotStarted', // FAIL-CLOSED
    visibilityDecision: 'Hidden', // FAIL-CLOSED
    sources: [],
    rightsNotes: '',
    createdAt: nowIso,
    updatedAt: nowIso,
    youtubeSource,
  };

  return video;
}
