export type SubmissionStatusBackend =
  | 'Received'
  | 'UnderReview'
  | 'AcceptedForEditorial'
  | 'Rejected';

export const CANONICAL_COMMUNITY_CATEGORIES_BACKEND = [
  'water',
  'climate',
  'desertification',
  'marine',
] as const;

export interface CitizenSubmissionAttachmentBackend {
  id: string;
  fileName: string;
  fileType: 'image' | 'video' | 'audio' | 'document';
  fileUrl: string;
  storagePath?: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface CitizenSubmissionBackend {
  id: string;
  submittedAt: string;
  submittedByUid: string;
  contributorName: string;
  contributorContact?: string;
  title: string;
  body: string;
  sourceLanguage: 'ar' | 'en';
  category: string;
  locationDescription?: string;
  status: SubmissionStatusBackend;
  attachments: CitizenSubmissionAttachmentBackend[];
  editorialReferenceId?: string;
  moderatorNotes?: string;
  reviewedByUid?: string;
  reviewedByName?: string;
  updatedAt: string;
}

export interface CommunityRepository {
  getById(id: string): Promise<CitizenSubmissionBackend | null>;
  save(submission: CitizenSubmissionBackend): Promise<void>;
  listAll(): Promise<CitizenSubmissionBackend[]>;
  listByContributorUid(uid: string): Promise<CitizenSubmissionBackend[]>;
}
