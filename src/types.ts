export type LocalizedText = {
  ar: string;
  en: string;
};

export type Language = 'ar' | 'en';

// ============================================================================
// 1. Content & Lifecycle Enums / String Literal Unions
// ============================================================================

/**
 * Types of content items in the newsroom and media hub.
 */
export type ContentType = 'News' | 'Report' | 'Video';

/**
 * General lifecycle status of a content item.
 * NOTE: 'Approved' is strictly decoupled and managed via ApprovalStatus.
 */
export type ContentStatus =
  | 'Draft'
  | 'PendingReview'
  | 'InReview'
  | 'Published'
  | 'Archived'
  | 'Rejected';

/**
 * Editorial approval status representing human editorial decisions.
 */
export type ApprovalStatus =
  | 'Draft'
  | 'Pending'
  | 'InReview'
  | 'Approved'
  | 'ChangesRequested'
  | 'Rejected';

/**
 * Intellectual property and media rights status.
 */
export type RightsStatus =
  | 'NotStarted'
  | 'InReview'
  | 'Cleared'
  | 'NeedsChanges'
  | 'Rejected';

/**
 * Physical availability of the video on YouTube source platform.
 */
export type AvailabilityStatus =
  | 'Available'
  | 'Private'
  | 'Deleted'
  | 'Unavailable';

/**
 * Technical status of YouTube Data API synchronization attempts.
 */
export type SyncStatus =
  | 'Healthy'
  | 'SyncPending'
  | 'SyncError';

/**
 * Editorial translation workflow status.
 */
export type TranslationStatus =
  | 'NotRequired'
  | 'PendingTranslation'
  | 'InTranslation'
  | 'Completed';

/**
 * Editorial visibility scope decisions for videos.
 */
export type VisibilityDecision =
  | 'Hidden'
  | 'MediaHubOnly'
  | 'NewsEligible'
  | 'Featured';

/**
 * Approved core environmental categories for Promise of Planet.
 */
export type Category =
  | 'Climate'
  | 'Water'
  | 'Biodiversity'
  | 'Pollution'
  | 'Energy'
  | 'Agriculture'
  | 'EnvironmentalPolicy';

/**
 * Editorial topic tag.
 */
export type Tag = string;

/**
 * Urgency level for news items.
 */
export type UrgencyLevel = 'Standard' | 'Urgent' | 'Breaking';

/**
 * Journalistic coverage type for news.
 */
export type CoverageType =
  | 'FieldCoverage'
  | 'OfficialStatement'
  | 'AgencyReport'
  | 'Investigative';

/**
 * Editorial nature of the video relation to a news/report article.
 */
export type RelationType =
  | 'Embedded'
  | 'RelatedCoverage'
  | 'SupportingMaterial';

/**
 * Visual placement of the video inside the article layout.
 */
export type Placement =
  | 'Top'
  | 'Inline'
  | 'Bottom'
  | 'Sidebar';

/**
 * Source classification types.
 */
export type SourceType =
  | 'OfficialGovernment'
  | 'UNReport'
  | 'AcademicStudy'
  | 'FieldWitness'
  | 'IndependentMedia'
  | 'NGOReport';

/**
 * Legal rights basis for media assets.
 */
export type RightsBasis =
  | 'OriginalProduction'
  | 'Licensed'
  | 'FairUse'
  | 'PublicDomain'
  | 'AuthorizedContributor';

export type MusicStatus =
  | 'OriginalTrack'
  | 'LicensedMusic'
  | 'RoyaltyFree'
  | 'NeedsAudit';

export type ArchiveFootageStatus =
  | 'OwnFootage'
  | 'LicensedArchive'
  | 'FairUseExempt'
  | 'NeedsReplacement';

export type PeopleConsentStatus =
  | 'ConsentObtained'
  | 'NotRequired'
  | 'PendingConsent';

export type ApprovalDecision =
  | 'Approved'
  | 'ChangesRequested'
  | 'Rejected'
  | 'Revoked';

// ============================================================================
// 2. Auxiliary Structured Types
// ============================================================================

export interface ImageObject {
  url: string;
  altAr: string;
  altEn?: string;
  captionAr?: string;
  captionEn?: string;
  credit?: string;
  sourceUrl?: string;
}

export interface YouTubeThumbnails {
  default?: string;
  medium?: string;
  high?: string;
  standard?: string;
  maxres?: string;
}

export interface ReportSection {
  id: string;
  titleAr: string;
  titleEn?: string;
  bodyAr: string;
  bodyEn?: string;
  order: number;
}

export interface DataPoint {
  id: string;
  labelAr: string;
  labelEn?: string;
  value: string;
  contextAr?: string;
  contextEn?: string;
}

export interface FieldInterview {
  id: string;
  intervieweeName: string;
  roleOrTitleAr: string;
  roleOrTitleEn?: string;
  quoteAr: string;
  quoteEn?: string;
  location?: string;
}

// ============================================================================
// 3. Source & YouTube Metadata Models
// ============================================================================

/**
 * Documented journalistic or scientific source.
 * Independent for articles and videos.
 */
export interface ContentSource {
  id: string;
  sourceName: string;
  sourceType: SourceType;
  sourceUrl?: string;
  accessedAt?: string;
  reliabilityNotes?: string;
  isPrimarySource?: boolean;
}

/**
 * Raw source data fetched from YouTube Data API.
 * Protected from manual editorial override and segregated from editorial fields.
 */
export interface YouTubeSource {
  youtubeVideoId: string;
  youtubeUrl: string;
  channelId: string;
  channelName: string;
  channelUrl: string;
  originalTitle: string;
  originalDescription: string;
  youtubePublishedAt: string;
  thumbnails: YouTubeThumbnails;
  duration: string;
  originalAudioLanguage?: string;
  hasCaptions?: boolean;
  availabilityStatus: AvailabilityStatus;
  lastSyncedAt?: string; // Timestamp of the last SUCCESSFUL sync only
}

// ============================================================================
// 4. Core Content Items (News, Report, Video)
// ============================================================================

/**
 * Base abstract interface for all editorial content items.
 */
export interface ContentItem {
  id: string;
  contentType: ContentType;
  titleAr: string;
  titleEn?: string;
  excerptAr: string;
  excerptEn?: string;
  category: Category;
  tags: Tag[];
  originalLanguage: Language;
  availableLanguages: Language[];
  translationStatus: TranslationStatus;
  featuredImage?: ImageObject;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  author?: string;
  producer?: string;
  editor: string;
  status: ContentStatus;
  approvalStatus: ApprovalStatus;
  rightsStatus?: RightsStatus;
  reviewNotes?: string;
}

/**
 * News item model for time-sensitive environmental coverage.
 */
export interface News extends ContentItem {
  contentType: 'News';
  contentAr: string;
  contentEn?: string;
  eventDate?: string;
  location: string;
  urgencyLevel: UrgencyLevel;
  coverageType?: CoverageType;
  sources: ContentSource[];
}

/**
 * In-depth analytical or investigative report model.
 */
export interface Report extends ContentItem {
  contentType: 'Report';
  contentAr: string;
  contentEn?: string;
  featuredImage: ImageObject; // Mandatory for Report
  sections?: ReportSection[];
  keyFindings?: string[];
  dataPoints?: DataPoint[];
  fieldInterviews?: FieldInterview[];
  readTimeEstimate?: number;
  sources: ContentSource[];
}

/**
 * Editorial video model with strict separation of editorial data and YouTube source data.
 */
export interface Video extends ContentItem {
  contentType: 'Video';
  editorialDescriptionAr: string;
  editorialDescriptionEn?: string;
  editorialThumbnail?: ImageObject;
  visibilityDecision: VisibilityDecision;
  rightsStatus: RightsStatus; // Mandatory for Video
  sources?: ContentSource[];
  rightsNotes?: string;
  youtubeSource: YouTubeSource;
}

// ============================================================================
// 5. Relations, Governance, and Sync Models
// ============================================================================

/**
 * Many-to-Many relation model connecting articles (News/Report) to Videos.
 */
export interface ContentVideoRelation {
  id: string;
  contentId: string;
  videoId: string;
  relationType: RelationType;
  placement: Placement;
  displayOrder: number;
  isPrimary: boolean; // Indicates this video is the primary video for the article
  caption?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Editorial approval record documenting human editorial decisions.
 */
export interface ContentApprovalRecord {
  id: string;
  contentId: string;
  decision: ApprovalDecision;
  decidedBy: string; // Authorized decision-maker ID/Name
  decidedAt: string;
  targetVersion?: string;
  reviewNotes?: string;
  actionItems?: string[];
}

/**
 * Intellectual property, music, and media rights audit record.
 */
export interface RightsReview {
  id: string;
  targetType: 'Video' | 'MediaAsset';
  targetId: string;
  reviewStatus: RightsStatus;
  reviewer: string;
  reviewedAt: string;
  rightsBasis: RightsBasis;
  permissionSource?: string;
  musicStatus?: MusicStatus;
  archiveFootageStatus?: ArchiveFootageStatus;
  peopleConsentStatus?: PeopleConsentStatus;
  notes?: string;
  requiresFollowUp?: boolean;
}

/**
 * Diagnostics and history log for YouTube Data API synchronization runs.
 */
export interface YouTubeSyncLog {
  id: string;
  startedAt: string;
  completedAt: string;
  status: 'Success' | 'PartialSuccess' | 'Failed';
  syncStatus: SyncStatus;
  requestedChannelId: string;
  targetVideoId?: string;
  fetchedCount: number;
  createdCount: number;
  updatedSourceCount: number;
  skippedCount: number;
  errorCount: number;
  errorCode?: string;
  errorMessage?: string;
  diagnostics?: Record<string, unknown>;
}


