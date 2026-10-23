import type { JournalisticType } from '../types';
import type { RichNewsDocument } from './richNewsDocument';
import { WorkflowState } from './workflow';
import type { WorkflowTransitionRecord } from './workflow';

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
