import { AdminPermission } from './admin';

export const WorkflowState = {
  Draft: 'Draft',
  InReview: 'InReview',
  ChangesRequested: 'ChangesRequested',
  Approved: 'Approved',
  Published: 'Published',
} as const;

export type WorkflowState = typeof WorkflowState[keyof typeof WorkflowState];

export const WorkflowAction = {
  SubmitForReview: 'submit_for_review',
  RequestChanges: 'request_changes',
  Approve: 'approve',
  ReviseDraft: 'revise_draft',
  Publish: 'publish',
} as const;

export type WorkflowAction = typeof WorkflowAction[keyof typeof WorkflowAction];

export interface WorkflowTransitionConfig {
  action: WorkflowAction;
  fromState: WorkflowState;
  toState: WorkflowState;
  requiredPermission: AdminPermission;
  labelAr: string;
  labelEn: string;
  requiresComment?: boolean;
}

export interface WorkflowTransitionRecord {
  id: string;
  fromState: WorkflowState;
  toState: WorkflowState;
  action: WorkflowAction;
  actorName: string;
  actorRole: string;
  timestamp: string;
  comment?: string;
}

export interface ContentWorkflowItem {
  id: string;
  titleAr: string;
  titleEn: string;
  contentType: 'News' | 'Report' | 'LibraryItem' | 'Course' | 'Video';
  currentState: WorkflowState;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  category: string;
  history: WorkflowTransitionRecord[];
}
