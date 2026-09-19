import type { Category, Language } from '../types';
import { WorkflowState, type WorkflowTransitionRecord } from './workflow';

export type TrainingLevel = 'Beginner' | 'Intermediate' | 'Advanced';

export type DeliveryMode = 'OnlineSelfPaced' | 'LiveWorkshop' | 'FieldCohort';

/**
 * Canonical Training Course Entity for Promise of Planet Admin & Public Platform.
 * Reuses WorkflowState and WorkflowTransitionRecord from the Content Workflow Foundation.
 */
export interface TrainingCourse {
  id: string;
  titleAr: string;
  titleEn: string;
  summaryAr: string;
  summaryEn: string;
  descriptionAr?: string;
  descriptionEn?: string;
  category: Category;
  level: TrainingLevel;
  durationHours: number;
  deliveryMode: DeliveryMode;
  targetAudienceAr: string;
  targetAudienceEn: string;
  instructorNameAr?: string;
  instructorNameEn?: string;
  instructorBioAr?: string;
  instructorBioEn?: string;
  workflowState: WorkflowState;
  workflowHistory: WorkflowTransitionRecord[];
  createdAt: string;
  updatedAt: string;
  author: string;
  language: Language;
}

export interface TrainingClassification {
  category?: Category;
  level?: TrainingLevel;
  deliveryMode?: DeliveryMode;
  workflowState?: WorkflowState;
  searchQuery?: string;
}
