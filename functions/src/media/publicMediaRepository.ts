import type { MediaRepository } from './mediaRepository';
import {
  type Video,
  type CanonicalPlaylist,
  type ImageObject,
  type ContentSource,
  type YouTubeSource,
  isCanonicalCategory,
} from '../types/media';

const PUBLIC_VISIBILITY_DECISIONS = new Set<Video['visibilityDecision']>([
  'Featured',
  'NewsEligible',
  'MediaHubOnly',
]);

function sanitizePublicHttpUrl(rawUrl?: unknown): string | undefined {
  if (typeof rawUrl !== 'string') return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || !parsed.hostname) {
      return undefined;
    }
    return trimmed;
  } catch {
    return undefined;
  }
}

function sanitizeImageObject(image?: ImageObject): ImageObject | undefined {
  if (!image || typeof image !== 'object') return undefined;
  const safeUrl = sanitizePublicHttpUrl(image.url);
  const altAr = typeof image.altAr === 'string' ? image.altAr.trim() : '';
  if (!safeUrl || !altAr) return undefined;

  const altEn = typeof image.altEn === 'string' && image.altEn.trim() ? image.altEn.trim() : undefined;
  const captionAr = typeof image.captionAr === 'string' && image.captionAr.trim() ? image.captionAr.trim() : undefined;
  const captionEn = typeof image.captionEn === 'string' && image.captionEn.trim() ? image.captionEn.trim() : undefined;
  const credit = typeof image.credit === 'string' && image.credit.trim() ? image.credit.trim() : undefined;
  const sourceUrl = sanitizePublicHttpUrl(image.sourceUrl);

  return {
    url: safeUrl,
    altAr,
    ...(altEn ? { altEn } : {}),
    ...(captionAr ? { captionAr } : {}),
    ...(captionEn ? { captionEn } : {}),
    ...(credit ? { credit } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
  };
}

function sanitizeThumbnails(thumbnails?: YouTubeSource['thumbnails']): YouTubeSource['thumbnails'] {
  if (!thumbnails || typeof thumbnails !== 'object') return {};
  const def = sanitizePublicHttpUrl(thumbnails.default);
  const med = sanitizePublicHttpUrl(thumbnails.medium);
  const high = sanitizePublicHttpUrl(thumbnails.high);
  const std = sanitizePublicHttpUrl(thumbnails.standard);
  const max = sanitizePublicHttpUrl(thumbnails.maxres);

  return {
    ...(def ? { default: def } : {}),
    ...(med ? { medium: med } : {}),
    ...(high ? { high: high } : {}),
    ...(std ? { standard: std } : {}),
    ...(max ? { maxres: max } : {}),
  };
}

function sanitizeContentSources(sources?: ContentSource[]): ContentSource[] | undefined {
  if (!Array.isArray(sources)) return undefined;
  const sanitized: ContentSource[] = [];
  for (const s of sources) {
    if (!s || typeof s !== 'object') continue;
    if (typeof s.id !== 'string' || !s.id.trim()) continue;
    if (typeof s.sourceName !== 'string' || !s.sourceName.trim()) continue;
    if (typeof s.sourceType !== 'string' || !s.sourceType.trim()) continue;

    const safeSourceUrl = sanitizePublicHttpUrl(s.sourceUrl);
    const accessedAt = typeof s.accessedAt === 'string' && s.accessedAt.trim() ? s.accessedAt.trim() : undefined;
    const reliabilityNotes =
      typeof s.reliabilityNotes === 'string' && s.reliabilityNotes.trim() ? s.reliabilityNotes.trim() : undefined;

    sanitized.push({
      id: s.id.trim(),
      sourceName: s.sourceName.trim(),
      sourceType: s.sourceType,
      ...(safeSourceUrl ? { sourceUrl: safeSourceUrl } : {}),
      ...(accessedAt ? { accessedAt } : {}),
      ...(reliabilityNotes ? { reliabilityNotes } : {}),
      ...(typeof s.isPrimarySource === 'boolean' ? { isPrimarySource: s.isPrimarySource } : {}),
    });
  }
  return sanitized;
}

export function isEligiblePublicVideo(video: unknown): video is Video {
  if (!video || typeof video !== 'object') return false;
  const v = video as Video;
  if (typeof v.id !== 'string' || !v.id.trim()) return false;
  if (v.status !== 'Published') return false;
  if (v.approvalStatus !== 'Approved') return false;
  if (v.rightsStatus !== 'Cleared') return false;
  if (!PUBLIC_VISIBILITY_DECISIONS.has(v.visibilityDecision)) return false;
  if (!isCanonicalCategory(v.category)) return false;
  if (typeof v.titleAr !== 'string' || !v.titleAr.trim()) return false;
  if (typeof v.excerptAr !== 'string' || !v.excerptAr.trim()) return false;
  if (typeof v.editorialDescriptionAr !== 'string' || !v.editorialDescriptionAr.trim()) return false;
  if (!v.youtubeSource || typeof v.youtubeSource !== 'object') return false;
  if (typeof v.youtubeSource.youtubeVideoId !== 'string' || !v.youtubeSource.youtubeVideoId.trim()) return false;
  if (
    v.youtubeSource.availabilityStatus !== 'Available' &&
    v.youtubeSource.availabilityStatus !== undefined
  ) {
    return false;
  }
  return true;
}

/**
 * Projects a canonical Video record onto an allowlisted public DTO.
 * Strictly strips internal/sensitive fields: rightsNotes, reviewNotes,
 * editor, author, translationStatus, _relations, playlistIds, and youtubeSource.lastSyncedAt.
 */
export function toPublicVideo(video: Video): Video {
  const youtubeVideoId = video.youtubeSource.youtubeVideoId.trim();
  const safeYoutubeUrl =
    sanitizePublicHttpUrl(video.youtubeSource.youtubeUrl) ||
    `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeVideoId)}`;
  const safeChannelUrl = sanitizePublicHttpUrl(video.youtubeSource.channelUrl);
  const channelId =
    typeof video.youtubeSource.channelId === 'string' && video.youtubeSource.channelId.trim()
      ? video.youtubeSource.channelId.trim()
      : undefined;
  const channelName =
    typeof video.youtubeSource.channelName === 'string' && video.youtubeSource.channelName.trim()
      ? video.youtubeSource.channelName.trim()
      : undefined;
  const duration =
    typeof video.youtubeSource.duration === 'string' && video.youtubeSource.duration.trim()
      ? video.youtubeSource.duration.trim()
      : undefined;
  const originalAudioLanguage =
    typeof video.youtubeSource.originalAudioLanguage === 'string' &&
    video.youtubeSource.originalAudioLanguage.trim()
      ? video.youtubeSource.originalAudioLanguage.trim()
      : undefined;

  const sanitizedYoutubeSource: YouTubeSource = {
    youtubeVideoId,
    youtubeUrl: safeYoutubeUrl,
    ...(channelId ? { channelId } : {}),
    ...(channelName ? { channelName } : {}),
    ...(safeChannelUrl ? { channelUrl: safeChannelUrl } : {}),
    originalTitle: typeof video.youtubeSource.originalTitle === 'string' ? video.youtubeSource.originalTitle : '',
    originalDescription:
      typeof video.youtubeSource.originalDescription === 'string' ? video.youtubeSource.originalDescription : '',
    youtubePublishedAt:
      typeof video.youtubeSource.youtubePublishedAt === 'string' ? video.youtubeSource.youtubePublishedAt : '',
    thumbnails: sanitizeThumbnails(video.youtubeSource.thumbnails),
    ...(duration ? { duration } : {}),
    ...(originalAudioLanguage ? { originalAudioLanguage } : {}),
    ...(typeof video.youtubeSource.hasCaptions === 'boolean' ? { hasCaptions: video.youtubeSource.hasCaptions } : {}),
    availabilityStatus: 'Available',
  };

  const titleEn = typeof video.titleEn === 'string' && video.titleEn.trim() ? video.titleEn.trim() : undefined;
  const excerptEn = typeof video.excerptEn === 'string' && video.excerptEn.trim() ? video.excerptEn.trim() : undefined;
  const editorialDescriptionEn =
    typeof video.editorialDescriptionEn === 'string' && video.editorialDescriptionEn.trim()
      ? video.editorialDescriptionEn.trim()
      : undefined;
  const editorialThumbnail = sanitizeImageObject(video.editorialThumbnail);
  const featuredImage = sanitizeImageObject(video.featuredImage);
  const producer = typeof video.producer === 'string' && video.producer.trim() ? video.producer.trim() : undefined;
  const publishedAt =
    typeof video.publishedAt === 'string' && video.publishedAt.trim() ? video.publishedAt.trim() : undefined;
  const sources = sanitizeContentSources(video.sources);
  const availableLanguages = Array.isArray(video.availableLanguages)
    ? video.availableLanguages.filter((l): l is 'ar' | 'en' => l === 'ar' || l === 'en')
    : undefined;

  return {
    id: video.id.trim(),
    contentType: 'Video',
    status: 'Published',
    approvalStatus: 'Approved',
    rightsStatus: 'Cleared',
    visibilityDecision: video.visibilityDecision,
    category: video.category,
    titleAr: video.titleAr.trim(),
    ...(titleEn ? { titleEn } : {}),
    excerptAr: video.excerptAr.trim(),
    ...(excerptEn ? { excerptEn } : {}),
    editorialDescriptionAr: video.editorialDescriptionAr.trim(),
    ...(editorialDescriptionEn ? { editorialDescriptionEn } : {}),
    ...(editorialThumbnail ? { editorialThumbnail } : {}),
    ...(featuredImage ? { featuredImage } : {}),
    tags: Array.isArray(video.tags) ? video.tags.filter((t): t is string => typeof t === 'string') : [],
    ...(video.originalLanguage === 'ar' || video.originalLanguage === 'en'
      ? { originalLanguage: video.originalLanguage }
      : {}),
    ...(availableLanguages ? { availableLanguages } : {}),
    ...(producer ? { producer } : {}),
    ...(sources ? { sources } : {}),
    youtubeSource: sanitizedYoutubeSource,
    createdAt: video.createdAt,
    updatedAt: video.updatedAt,
    ...(publishedAt ? { publishedAt } : {}),
  };
}

/**
 * Projects a CanonicalPlaylist onto an allowlisted public DTO containing only eligible public video IDs.
 */
export function toPublicPlaylist(
  playlist: CanonicalPlaylist,
  eligibleVideoIds: string[]
): CanonicalPlaylist {
  const externalPlaylistId =
    typeof playlist.externalPlaylistId === 'string' && playlist.externalPlaylistId.trim()
      ? playlist.externalPlaylistId.trim()
      : undefined;
  const titleEn =
    typeof playlist.titleEn === 'string' && playlist.titleEn.trim() ? playlist.titleEn.trim() : undefined;
  const descriptionEn =
    typeof playlist.descriptionEn === 'string' && playlist.descriptionEn.trim()
      ? playlist.descriptionEn.trim()
      : undefined;
  const safeThumbnailUrl = sanitizePublicHttpUrl(playlist.thumbnailUrl);

  return {
    id: playlist.id.trim(),
    ...(externalPlaylistId ? { externalPlaylistId } : {}),
    titleAr: playlist.titleAr.trim(),
    ...(titleEn ? { titleEn } : {}),
    descriptionAr: typeof playlist.descriptionAr === 'string' ? playlist.descriptionAr : '',
    ...(descriptionEn ? { descriptionEn } : {}),
    ...(safeThumbnailUrl ? { thumbnailUrl: safeThumbnailUrl } : {}),
    itemCount: eligibleVideoIds.length,
    status: 'Published',
    videoIds: [...eligibleVideoIds],
    createdAt: playlist.createdAt,
    updatedAt: playlist.updatedAt,
  };
}

export class PublicMediaRepository {
  private readonly mediaRepo?: MediaRepository;

  constructor(mediaRepo?: MediaRepository) {
    this.mediaRepo = mediaRepo;
  }

  private get db() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getFirestore } = require('firebase-admin/firestore') as typeof import('firebase-admin/firestore');
    return getFirestore();
  }

  /**
   * Retrieves canonically eligible, DTO-sanitized public videos.
   * Strictly enforces:
   * - status === 'Published'
   * - approvalStatus === 'Approved'
   * - rightsStatus === 'Cleared'
   * - visibilityDecision in ['Featured', 'NewsEligible', 'MediaHubOnly'] (non-Hidden)
   * - availabilityStatus === 'Available' (or undefined if not yet flagged unavailable)
   * - strips internal fields (rightsNotes, reviewNotes, editor, author, _relations, etc.)
   */
  async listPublicVideos(): Promise<Video[]> {
    let rawVideos: unknown[];
    if (this.mediaRepo) {
      rawVideos = await this.mediaRepo.listVideos();
    } else {
      const snapshot = await this.db
        .collection('media')
        .where('status', '==', 'Published')
        .where('rightsStatus', '==', 'Cleared')
        .get();
      rawVideos = snapshot.docs.map(doc => doc.data());
    }

    return rawVideos.filter(isEligiblePublicVideo).map(toPublicVideo);
  }

  /**
   * Retrieves canonical public playlists, filtered to Published playlists
   * and stripped of any non-public videoIds or un-allowlisted fields.
   */
  async listPublicPlaylists(eligibleVideoIds?: Iterable<string>): Promise<CanonicalPlaylist[]> {
    const allowedVideoIdSet = eligibleVideoIds
      ? new Set(eligibleVideoIds)
      : new Set((await this.listPublicVideos()).map(v => v.id));

    let rawPlaylists: CanonicalPlaylist[];
    if (this.mediaRepo) {
      rawPlaylists = await this.mediaRepo.listPlaylists();
    } else {
      const snapshot = await this.db
        .collection('playlists')
        .where('status', '==', 'Published')
        .get();
      rawPlaylists = snapshot.docs.map(doc => doc.data() as CanonicalPlaylist);
    }

    const sanitizedPlaylists: CanonicalPlaylist[] = [];
    for (const pl of rawPlaylists) {
      if (!pl || typeof pl !== 'object') continue;
      if (pl.status !== 'Published') continue;
      if (typeof pl.id !== 'string' || !pl.id.trim()) continue;
      if (typeof pl.titleAr !== 'string' || !pl.titleAr.trim()) continue;
      if (!Array.isArray(pl.videoIds)) continue;

      const publicVideoIds = pl.videoIds.filter(
        (vidId): vidId is string => typeof vidId === 'string' && allowedVideoIdSet.has(vidId)
      );
      if (publicVideoIds.length === 0) continue;

      sanitizedPlaylists.push(toPublicPlaylist(pl, publicVideoIds));
    }

    return sanitizedPlaylists;
  }
}


