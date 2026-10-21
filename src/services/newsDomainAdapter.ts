import type { NewsItem } from '../types/news';
import { 
  type News, 
  type Category, 
  isCanonicalCategory,
  type ContentStatus, 
  type ApprovalStatus, 
  type ContentSource, 
  type ImageObject,
  type UrgencyLevel,
  type JournalisticType
} from '../types';
import { WorkflowState } from '../types/workflow';

/**
 * Strictly maps category string to canonical Category if valid, otherwise returns null.
 * Zero heuristic guessing, zero keyword inference, zero Climate fallback.
 */
export function normalizeCategory(cat: unknown): Category | null {
  if (isCanonicalCategory(cat)) {
    return cat;
  }
  return null;
}

/**
 * Converts a workflow NewsItem into the canonical public News domain model.
 */
export function toCanonicalNews(item: NewsItem): News {
  if (!isCanonicalCategory(item.category)) {
    throw new Error(`CATEGORY_INTEGRITY_ERROR: Non-canonical category '${item.category}' cannot be converted to canonical News domain model`);
  }

  // Determine lifecycle and approval status from workflow state
  let status: ContentStatus = 'Draft';
  let approvalStatus: ApprovalStatus = 'Draft';

  switch (item.workflowState) {
    case WorkflowState.Draft:
      status = 'Draft';
      approvalStatus = 'Draft';
      break;
    case WorkflowState.InReview:
      status = 'InReview';
      approvalStatus = 'InReview';
      break;
    case WorkflowState.ChangesRequested:
      status = 'Draft';
      approvalStatus = 'ChangesRequested';
      break;
    case WorkflowState.Approved:
      status = 'Draft';
      approvalStatus = 'Approved';
      break;
    case WorkflowState.Published:
      status = 'Published';
      approvalStatus = 'Approved';
      break;
  }

  const sources: ContentSource[] = (item.sources || []).map((s, idx) => ({
    id: `src-${idx + 1}`,
    sourceName: s,
    sourceType: 'IndependentMedia',
    isPrimarySource: idx === 0,
  }));

  const featuredImage: ImageObject | undefined = item.featuredImage ? {
    url: item.featuredImage,
    altAr: item.titleAr,
    altEn: item.titleEn || item.titleAr,
    captionAr: item.summaryAr,
    captionEn: item.summaryEn,
  } : undefined;

  const hasArabic = Boolean(item.titleAr && item.bodyAr);
  const hasEnglish = Boolean(item.titleEn && item.bodyEn);
  const availableLanguages: ('ar' | 'en')[] = [];
  if (hasArabic) availableLanguages.push('ar');
  if (hasEnglish) availableLanguages.push('en');

  return {
    id: item.id,
    contentType: 'News',
    titleAr: item.titleAr,
    titleEn: item.titleEn || undefined,
    kickerAr: item.kickerAr,
    kickerEn: item.kickerEn,
    journalisticType: item.journalisticType,
    excerptAr: item.summaryAr,
    excerptEn: item.summaryEn || undefined,
    contentAr: item.bodyAr,
    contentEn: item.bodyEn || undefined,
    category: item.category,
    tags: item.tags || [],
    originalLanguage: 'ar',
    availableLanguages,
    featuredImage,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    publishedAt: item.publishedAt || (item.workflowState === WorkflowState.Published ? item.updatedAt : undefined),
    author: item.author,
    status,
    approvalStatus,
    rightsStatus: 'Cleared',
    location: item.location || 'Sudan / السودان',
    urgencyLevel: (item.urgencyLevel as UrgencyLevel) || 'Standard',
    sources,
  };
}

/**
 * Converts a canonical News entity back into a NewsItem for editorial administration.
 */
export function toWorkflowNewsItem(news: News): NewsItem {
  let workflowState: WorkflowState = WorkflowState.Draft;
  if (news.status === 'Published') {
    workflowState = WorkflowState.Published;
  } else if (news.approvalStatus === 'Approved') {
    workflowState = WorkflowState.Approved;
  } else if (news.approvalStatus === 'InReview') {
    workflowState = WorkflowState.InReview;
  } else if (news.approvalStatus === 'ChangesRequested') {
    workflowState = WorkflowState.ChangesRequested;
  }

  return {
    id: news.id,
    titleAr: news.titleAr,
    titleEn: news.titleEn || '',
    kickerAr: news.kickerAr,
    kickerEn: news.kickerEn,
    journalisticType: news.journalisticType,
    summaryAr: news.excerptAr,
    summaryEn: news.excerptEn || '',
    bodyAr: news.contentAr,
    bodyEn: news.contentEn || '',
    author: news.author || 'وعد الكوكب',
    category: news.category,
    tags: news.tags || [],
    sources: (news.sources || []).map(s => s.sourceName),
    featuredImage: news.featuredImage?.url,
    workflowState,
    createdAt: news.createdAt,
    updatedAt: news.updatedAt,
    history: [],
    location: news.location,
    urgencyLevel: news.urgencyLevel,
    publishedAt: news.publishedAt,
  };
}

/**
 * Public Sanitized DTO: strips out internal administrative data, notes, and unapproved history.
 */
export interface SanitizedPublicNewsDTO {
  id: string;
  titleAr: string;
  titleEn?: string;
  kickerAr?: string;
  kickerEn?: string;
  journalisticType?: JournalisticType;
  summaryAr: string;
  summaryEn?: string;
  bodyAr: string;
  bodyEn?: string;
  author: string;
  category: string;
  tags: string[];
  sources: string[];
  featuredImage?: string;
  location: string;
  urgencyLevel: UrgencyLevel;
  publishedAt: string;
  createdAt: string;
  relatedVideoIds?: string[];
}

export function sanitizeForPublic(item: NewsItem): SanitizedPublicNewsDTO | null {
  // Only published items with canonical categories can be exposed publicly
  if (item.workflowState !== WorkflowState.Published || !isCanonicalCategory(item.category)) {
    return null;
  }

  return {
    id: item.id,
    titleAr: item.titleAr,
    titleEn: item.titleEn || undefined,
    kickerAr: item.kickerAr,
    kickerEn: item.kickerEn,
    journalisticType: item.journalisticType,
    summaryAr: item.summaryAr,
    summaryEn: item.summaryEn || undefined,
    bodyAr: item.bodyAr,
    bodyEn: item.bodyEn || undefined,
    author: item.author,
    category: item.category,
    tags: item.tags || [],
    sources: item.sources || [],
    featuredImage: item.featuredImage,
    location: item.location || 'Sudan / السودان',
    urgencyLevel: item.urgencyLevel || 'Standard',
    publishedAt: item.publishedAt || item.updatedAt || item.createdAt,
    createdAt: item.createdAt,
    relatedVideoIds: item.relatedVideoIds || [],
  };
}

/**
 * Converts a sanitized public news DTO returned from the server into the public News domain model.
 * Does NOT fabricate approval records or editorial history.
 */
export function publicDtoToCanonicalNews(dto: SanitizedPublicNewsDTO): News {
  if (!isCanonicalCategory(dto.category)) {
    throw new Error(`CATEGORY_INTEGRITY_ERROR: Non-canonical public DTO category '${dto.category}' cannot be converted to canonical News domain model`);
  }

  const sources: ContentSource[] = (dto.sources || []).map((s, idx) => ({
    id: `src-${idx + 1}`,
    sourceName: s,
    sourceType: 'IndependentMedia',
    isPrimarySource: idx === 0,
  }));

  const featuredImage: ImageObject | undefined = dto.featuredImage
    ? {
        url: dto.featuredImage,
        altAr: dto.titleAr,
        altEn: dto.titleEn || dto.titleAr,
        captionAr: dto.summaryAr,
        captionEn: dto.summaryEn,
      }
    : undefined;

  const hasArabic = Boolean(dto.titleAr && dto.bodyAr);
  const hasEnglish = Boolean(dto.titleEn && dto.bodyEn);
  const availableLanguages: ('ar' | 'en')[] = [];
  if (hasArabic) availableLanguages.push('ar');
  if (hasEnglish) availableLanguages.push('en');

  return {
    id: dto.id,
    contentType: 'News',
    titleAr: dto.titleAr,
    titleEn: dto.titleEn || undefined,
    kickerAr: dto.kickerAr,
    kickerEn: dto.kickerEn,
    journalisticType: dto.journalisticType,
    excerptAr: dto.summaryAr,
    excerptEn: dto.summaryEn || undefined,
    contentAr: dto.bodyAr,
    contentEn: dto.bodyEn || undefined,
    category: dto.category,
    tags: dto.tags || [],
    originalLanguage: 'ar',
    availableLanguages,
    featuredImage,
    createdAt: dto.createdAt,
    updatedAt: dto.publishedAt || dto.createdAt,
    publishedAt: dto.publishedAt,
    author: dto.author,
    status: 'Published',
    approvalStatus: 'Approved',
    rightsStatus: 'Cleared',
    location: dto.location || 'Sudan / السودان',
    urgencyLevel: (dto.urgencyLevel as UrgencyLevel) || 'Standard',
    sources,
  };
}
