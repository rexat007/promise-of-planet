import {
  CANONICAL_COMMUNITY_CATEGORIES_BACKEND,
  type CitizenSubmissionAttachmentBackend,
  type SubmissionStatusBackend,
} from './communityRepository';

export const ALLOWED_EVIDENCE_MIME_TYPES: Record<string, 'image' | 'video' | 'audio' | 'document'> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/quicktime': 'video',
  'audio/mpeg': 'audio',
  'audio/wav': 'audio',
  'audio/ogg': 'audio',
  'application/pdf': 'document',
};

export const MAX_EVIDENCE_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_ATTACHMENTS_PER_SUBMISSION = 5;

export const VALID_SUBMISSION_STATUSES: SubmissionStatusBackend[] = [
  'Received',
  'UnderReview',
  'AcceptedForEditorial',
  'Rejected',
];

export class CommunityValidator {
  public static validateNewSubmissionInput(
    input: any,
    authenticatedUid: string,
    submissionId: string
  ): {
    contributorName: string;
    contributorContact?: string;
    title: string;
    body: string;
    sourceLanguage: 'ar' | 'en';
    category: string;
    locationDescription?: string;
    attachments: CitizenSubmissionAttachmentBackend[];
  } {
    if (!authenticatedUid || typeof authenticatedUid !== 'string' || !authenticatedUid.trim()) {
      throw new Error('UNAUTHENTICATED: Authenticated platform account UID is required to submit a report.');
    }

    if (!input || typeof input !== 'object') {
      throw new Error('VALIDATION_ERROR: Submission payload must be a valid object.');
    }

    const contributorName = typeof input.contributorName === 'string' ? input.contributorName.trim() : '';
    if (!contributorName || contributorName.length < 2 || contributorName.length > 150) {
      throw new Error('VALIDATION_ERROR: Contributor name is required (2–150 characters).');
    }

    const contributorContact =
      typeof input.contributorContact === 'string' && input.contributorContact.trim()
        ? input.contributorContact.trim()
        : undefined;
    if (contributorContact && contributorContact.length > 200) {
      throw new Error('VALIDATION_ERROR: Contributor contact exceeds maximum length (200 characters).');
    }

    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title || title.length < 5 || title.length > 300) {
      throw new Error('VALIDATION_ERROR: Report title is required (5–300 characters).');
    }

    const body = typeof input.body === 'string' ? input.body.trim() : '';
    if (!body || body.length < 15 || body.length > 10000) {
      throw new Error('VALIDATION_ERROR: Detailed report description is required (15–10000 characters).');
    }

    const sourceLanguage: 'ar' | 'en' = input.sourceLanguage === 'en' ? 'en' : 'ar';

    const category = typeof input.category === 'string' ? input.category.trim() : '';
    if (!CANONICAL_COMMUNITY_CATEGORIES_BACKEND.includes(category as any)) {
      throw new Error(
        `VALIDATION_ERROR: Category '${category}' is invalid. Allowed categories: ${CANONICAL_COMMUNITY_CATEGORIES_BACKEND.join(', ')}`
      );
    }

    const locationDescription =
      typeof input.locationDescription === 'string' && input.locationDescription.trim()
        ? input.locationDescription.trim()
        : undefined;
    if (locationDescription && locationDescription.length > 500) {
      throw new Error('VALIDATION_ERROR: Location description exceeds maximum length (500 characters).');
    }

    const rawAttachments = Array.isArray(input.attachments) ? input.attachments : [];
    if (rawAttachments.length > MAX_ATTACHMENTS_PER_SUBMISSION) {
      throw new Error(`VALIDATION_ERROR: Maximum ${MAX_ATTACHMENTS_PER_SUBMISSION} attachments allowed per submission.`);
    }

    const validatedAttachments: CitizenSubmissionAttachmentBackend[] = rawAttachments.map((att: any, idx: number) => {
      return this.validateAttachment(att, authenticatedUid, submissionId, idx);
    });

    return {
      contributorName,
      contributorContact,
      title,
      body,
      sourceLanguage,
      category,
      locationDescription,
      attachments: validatedAttachments,
    };
  }

  public static validateAttachment(
    att: any,
    authenticatedUid: string,
    submissionId: string,
    index: number
  ): CitizenSubmissionAttachmentBackend {
    if (!att || typeof att !== 'object') {
      throw new Error(`ATTACHMENT_INVALID: Attachment at index ${index} is invalid.`);
    }

    const id = typeof att.id === 'string' ? att.id.trim() : '';
    const fileName = typeof att.fileName === 'string' ? att.fileName.trim() : '';
    const storagePath = typeof att.storagePath === 'string' ? att.storagePath.trim() : '';
    const mimeType = typeof att.mimeType === 'string' ? att.mimeType.trim().toLowerCase() : '';
    const sizeBytes = typeof att.sizeBytes === 'number' ? att.sizeBytes : NaN;
    const fileUrl = typeof att.fileUrl === 'string' ? att.fileUrl.trim() : '';

    if (!id || !fileName) {
      throw new Error(`ATTACHMENT_INVALID: Attachment id and fileName are required.`);
    }

    const expectedFileType = ALLOWED_EVIDENCE_MIME_TYPES[mimeType];
    if (!expectedFileType) {
      throw new Error(`ATTACHMENT_INVALID: Unsupported MIME type '${mimeType}'.`);
    }

    if (att.fileType !== expectedFileType) {
      throw new Error(`ATTACHMENT_INVALID: Attachment fileType '${att.fileType}' does not match MIME type '${mimeType}'.`);
    }

    if (isNaN(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_EVIDENCE_FILE_SIZE_BYTES) {
      throw new Error(`ATTACHMENT_INVALID: Attachment size (${sizeBytes}) is invalid or exceeds 15 MB limit.`);
    }

    const requiredPrefix = `citizen_submissions/${authenticatedUid}/${submissionId}/`;
    if (
      !storagePath.startsWith(requiredPrefix) ||
      storagePath.includes('..') ||
      storagePath.includes('\\')
    ) {
      throw new Error(
        `ATTACHMENT_INVALID: Attachment storagePath must be bound to '${requiredPrefix}'.`
      );
    }

    // Prevent fake external fileUrls: fileUrl must either be the canonical internal storage:// URI
    // or an official Firebase Storage URL for this exact encoded storagePath.
    const encodedPath = encodeURIComponent(storagePath);
    const isCanonicalStorageUri = fileUrl === `storage://${storagePath}`;
    const isFirebaseStorageUrl =
      fileUrl.startsWith('https://firebasestorage.googleapis.com/') && fileUrl.includes(encodedPath);

    if (!isCanonicalStorageUri && !isFirebaseStorageUrl) {
      throw new Error('ATTACHMENT_INVALID: Unverified or fake external attachment fileUrl is forbidden.');
    }

    return {
      id,
      fileName,
      fileType: expectedFileType,
      fileUrl,
      storagePath,
      mimeType,
      sizeBytes,
    };
  }

  public static validateModerationUpdate(input: any): {
    status: SubmissionStatusBackend;
    moderatorNotes?: string;
    editorialReferenceId?: string;
  } {
    if (!input || typeof input !== 'object') {
      throw new Error('VALIDATION_ERROR: Moderation update payload must be an object.');
    }

    const status = input.status as SubmissionStatusBackend;
    if (!VALID_SUBMISSION_STATUSES.includes(status)) {
      throw new Error(`VALIDATION_ERROR: Invalid moderation status '${input.status}'.`);
    }

    const moderatorNotes =
      typeof input.moderatorNotes === 'string' && input.moderatorNotes.trim()
        ? input.moderatorNotes.trim()
        : undefined;

    const editorialReferenceId =
      typeof input.editorialReferenceId === 'string' && input.editorialReferenceId.trim()
        ? input.editorialReferenceId.trim()
        : undefined;

    return {
      status,
      moderatorNotes,
      editorialReferenceId,
    };
  }
}
