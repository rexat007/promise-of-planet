export const SubmissionStatus = {
  Received: 'Received',
  UnderReview: 'UnderReview',
  AcceptedForEditorial: 'AcceptedForEditorial',
  Rejected: 'Rejected',
} as const;

export type SubmissionStatus = typeof SubmissionStatus[keyof typeof SubmissionStatus];

export interface CitizenSubmissionAttachment {
  id: string;
  fileName: string;
  fileType: 'image' | 'video' | 'audio' | 'document';
  fileUrl: string;
}

export interface CitizenSubmission {
  id: string;
  submittedAt: string;
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
  updatedAt: string;
}
