import type { JournalisticType, News } from '../types';
import type { RichNewsDocument } from './richNewsDocument';
import { WorkflowState } from './workflow';
import type { WorkflowTransitionRecord } from './workflow';

export type PublicEditorialImageVariantKey =
  | 'thumbnail'
  | 'card'
  | 'article_inline'
  | 'article_cover';

export const PUBLIC_EDITORIAL_IMAGE_VARIANT_KEYS: readonly PublicEditorialImageVariantKey[] =
  ['thumbnail', 'card', 'article_inline', 'article_cover'] as const;

export type PublicArticleCoverSource = 'explicit' | 'derived_first_inline';

export interface PublicEditorialCoverMetadata {
  readonly assetId?: string;
  readonly url?: string;
  readonly source: PublicArticleCoverSource;
  readonly sourceLocale?: 'ar' | 'en';
  readonly altAr: string;
  readonly altEn?: string;
  readonly captionAr?: string;
  readonly captionEn?: string;
  readonly variants?: {
    readonly thumbnail?: string;
    readonly card?: string;
    readonly article_inline?: string;
    readonly article_cover?: string;
  };
}

export interface PublicNewsArticle extends News {
  readonly richBodyAr?: RichNewsDocument;
  readonly richBodyEn?: RichNewsDocument;
  readonly coverImage?: PublicEditorialCoverMetadata;
}

export interface NewsItem {
  id: string;
  titleAr: string;
  titleEn: string;
  kickerAr?: string;
  kickerEn?: string;
  journalisticType?: JournalisticType;
  summaryAr: string;
  summaryEn: string;
  bodyAr: string;
  bodyEn: string;
  richBodyAr?: RichNewsDocument;
  richBodyEn?: RichNewsDocument;
  author: string;
  category: string;
  tags: string[];
  sources: string[];
  featuredImage?: string;
  workflowState: WorkflowState;
  createdAt: string;
  updatedAt: string;
  history: WorkflowTransitionRecord[];
  location?: string;
  urgencyLevel?: 'Standard' | 'Urgent' | 'Breaking';
  publishedAt?: string;
  relatedVideoIds?: string[];
}
