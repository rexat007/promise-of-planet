export type WorkflowStateBackend = 
  | 'Draft' 
  | 'InReview' 
  | 'ChangesRequested' 
  | 'Approved' 
  | 'Published';

export type WorkflowActionBackend = 
  | 'submit_for_review'
  | 'request_changes'
  | 'approve'
  | 'revise_draft'
  | 'publish';

export interface WorkflowTransitionRecordBackend {
  id: string;
  fromState: WorkflowStateBackend;
  toState: WorkflowStateBackend;
  action: WorkflowActionBackend;
  actorName: string;
  actorRole: string;
  timestamp: string;
  comment?: string;
}

export interface NewsItemBackend {
  id: string;
  titleAr: string;
  titleEn?: string;
  summaryAr: string;
  summaryEn?: string;
  bodyAr: string;
  bodyEn?: string;
  richBodyAr?: any;
  richBodyEn?: any;
  author: string;
  category: string;
  tags: string[];
  sources: string[];
  featuredImage?: string;
  workflowState: WorkflowStateBackend;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  history: WorkflowTransitionRecordBackend[];
  location?: string;
  urgencyLevel?: 'Standard' | 'Urgent' | 'Breaking';
  relatedVideoIds?: string[];
}

export interface SanitizedPublicNewsDTO {
  id: string;
  titleAr: string;
  titleEn?: string;
  summaryAr: string;
  summaryEn?: string;
  bodyAr: string;
  bodyEn?: string;
  richBodyAr?: any;
  richBodyEn?: any;
  author: string;
  category: string;
  tags: string[];
  sources: string[];
  featuredImage?: string;
  location: string;
  urgencyLevel: string;
  publishedAt: string;
  createdAt: string;
  relatedVideoIds?: string[];
}

export interface NewsRepository {
  getById(id: string): Promise<NewsItemBackend | null>;
  save(item: NewsItemBackend): Promise<void>;
  listAll(): Promise<NewsItemBackend[]>;
  listPublished(language?: 'ar' | 'en'): Promise<NewsItemBackend[]>;
  delete(id: string): Promise<void>;
}
