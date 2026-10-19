import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, isFirebaseConfigured } from './firebase';
import type {
  Video,
  CanonicalPlaylist,
  Language,
  ImageObject,
  ContentSource,
  YouTubeSource,
  YouTubeThumbnails,
} from '../types';
import { isVideoVisibleInMediaHub } from './contentVisibility';

export interface PublicMultimediaData {
  videos: Video[];
  playlists: CanonicalPlaylist[];
}

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

function sanitizeThumbnails(thumbnails?: YouTubeThumbnails): YouTubeThumbnails {
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

export function sanitizePublicMultimediaPayload(
  data: { videos?: unknown; playlists?: unknown } | null | undefined,
  currentLanguage?: Language
): PublicMultimediaData {
  const rawVideos = Array.isArray(data?.videos) ? (data!.videos as Video[]) : [];
  const rawPlaylists = Array.isArray(data?.playlists) ? (data!.playlists as CanonicalPlaylist[]) : [];

  const eligibleVideos = rawVideos
    .filter(video => {
      const check = isVideoVisibleInMediaHub(video, currentLanguage);
      return check.visible;
    })
    .map(toPublicVideo);

  const eligibleVideoIds = new Set(eligibleVideos.map(v => v.id));
  const eligiblePlaylists: CanonicalPlaylist[] = [];

  for (const pl of rawPlaylists) {
    if (!pl || typeof pl !== 'object') continue;
    if (pl.status !== 'Published') continue;
    if (typeof pl.id !== 'string' || !pl.id.trim()) continue;
    if (typeof pl.titleAr !== 'string' || !pl.titleAr.trim()) continue;
    if (!Array.isArray(pl.videoIds)) continue;

    const filteredVideoIds = pl.videoIds.filter(
      (id): id is string => typeof id === 'string' && eligibleVideoIds.has(id)
    );
    if (filteredVideoIds.length === 0) continue;

    eligiblePlaylists.push(toPublicPlaylist(pl, filteredVideoIds));
  }

  return {
    videos: eligibleVideos,
    playlists: eligiblePlaylists,
  };
}

export class PublicMediaClient {
  /**
   * Retrieves canonically eligible public multimedia items and playlists via
   * the secure server-side Firebase v2 HTTPS callable function `getPublicMultimedia`.
   * Enforces fail-closed behavior on failure or unconfigured environments.
   */
  public static async fetchPublicMultimedia(currentLanguage?: Language): Promise<PublicMultimediaData> {
    if (!isFirebaseConfigured || !app) {
      throw new Error('BACKEND_UNCONFIGURED: Firebase backend is not configured. Public multimedia requires active backend connectivity.');
    }

    try {
      const fns = getFunctions(app);
      const callable = httpsCallable<void, { videos: Video[]; playlists: CanonicalPlaylist[] }>(
        fns,
        'getPublicMultimedia'
      );
      const res = await callable();
      return sanitizePublicMultimediaPayload(res.data, currentLanguage);
    } catch (err: any) {
      console.error('PublicMediaClient: Failed to fetch public multimedia from server function:', err);
      throw err; // Fail-closed: Never fallback to local mock fixtures
    }
  }
}


