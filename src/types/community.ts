export const SubmissionStatus = {
  Received: 'Received',
  UnderReview: 'UnderReview',
  AcceptedForEditorial: 'AcceptedForEditorial',
  Rejected: 'Rejected',
} as const;

export type SubmissionStatus = typeof SubmissionStatus[keyof typeof SubmissionStatus];

export const CANONICAL_COMMUNITY_CATEGORIES = [
  'water',
  'climate',
  'desertification',
  'marine',
] as const;

export type CommunityCategoryKey = typeof CANONICAL_COMMUNITY_CATEGORIES[number];

export interface CitizenSubmissionAttachment {
  id: string;
  fileName: string;
  fileType: 'image' | 'video' | 'audio' | 'document';
  fileUrl: string;
  storagePath?: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface CitizenSubmission {
  id: string;
  submittedAt: string;
  submittedByUid?: string;
  contributorName: string;
  contributorContact?: string;
  title: string;
  body: string;
  sourceLanguage: 'ar' | 'en';
  category: string;
  locationDescription?: string;
  status: SubmissionStatus;
  attachments: CitizenSubmissionAttachment[];
  editorialReferenceId?: string;
  moderatorNotes?: string;
  reviewedByUid?: string;
  reviewedByName?: string;
  updatedAt: string;
}

