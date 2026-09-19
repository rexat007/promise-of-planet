import { WorkflowState } from './workflow';
import type { WorkflowTransitionRecord } from './workflow';

export interface NewsItem {
  id: string;
  titleAr: string;
  titleEn: string;
  summaryAr: string;
  summaryEn: string;
  bodyAr: string;
  bodyEn: string;
  author: string;
  category: string;
  tags: string[];
  sources: string[];
  featuredImage?: string;
  workflowState: WorkflowState;
  createdAt: string;
  updatedAt: string;
  history: WorkflowTransitionRecord[];
}

export const NEWS_CATEGORIES = [
  { id: 'water', labelAr: 'الموارد المائية والنيل', labelEn: 'Water Resources & Nile' },
  { id: 'climate', labelAr: 'المناخ والطقس', labelEn: 'Climate & Weather' },
  { id: 'reforestation', labelAr: 'التصحر والغطاء النباتي', labelEn: 'Desertification & Vegetation' },
  { id: 'marine', labelAr: 'البيئة البحرية والتنوع الحيوي', labelEn: 'Marine & Biodiversity' },
  { id: 'emergency', labelAr: 'الاستجابة والطوارئ البيئية', labelEn: 'Emergency Response & Alerts' },
] as const;
