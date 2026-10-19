import type { NewsItem } from '../types/news';
import type { 
  News, 
  Category, 
  ContentStatus, 
  ApprovalStatus, 
  ContentSource, 
  ImageObject,
  UrgencyLevel 
} from '../types';
import { WorkflowState } from '../types/workflow';

/**
 * Maps category labels or keys to canonical categories.
 */
export function normalizeCategory(cat: string): Category {
  const lower = (cat || '').toLowerCase().trim();
  if (lower.includes('ماء') || lower.includes('نيل') || lower.includes('water')) return 'Water';
  if (lower.includes('مناخ') || lower.includes('طقس') || lower.includes('climate')) return 'Climate';
  if (lower.includes('نبات') || lower.includes('تصحر') || lower.includes('حيوي') || lower.includes('biodiversity')) return 'Biodiversity';
  if (lower.includes('تلوث') || lower.includes('pollution')) return 'Pollution';
  if (lower.includes('طاقة') || lower.includes('energy')) return 'Energy';
  if (lower.includes('زراع') || lower.includes('agri')) return 'Agriculture';
  if (lower.includes('سياس') || lower.includes('قانون') || lower.includes('policy')) return 'EnvironmentalPolicy';
  return 'Climate';
}

/**
 * Converts a workflow NewsItem into the canonical public News domain model.
 */
export function toCanonicalNews(item: NewsItem): News {
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
    excerptAr: item.summaryAr,
    excerptEn: item.summaryEn || undefined,
    contentAr: item.bodyAr,
    contentEn: item.bodyEn || undefined,
    category: normalizeCategory(item.category),
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
  summaryAr: string;
  summaryEn?: string;
  bodyAr: string;
  bodyEn?: string;
  author: string;
  category: Category;
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
  // Only published items can be exposed publicly
  if (item.workflowState !== WorkflowState.Published) {
    return null;
  }

  return {
    id: item.id,
    titleAr: item.titleAr,
    titleEn: item.titleEn || undefined,
    summaryAr: item.summaryAr,
    summaryEn: item.summaryEn || undefined,
    bodyAr: item.bodyAr,
    bodyEn: item.bodyEn || undefined,
    author: item.author,
    category: normalizeCategory(item.category),
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
    excerptAr: dto.summaryAr,
    excerptEn: dto.summaryEn || undefined,
    contentAr: dto.bodyAr,
    contentEn: dto.bodyEn || undefined,
    category: normalizeCategory(dto.category),
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
