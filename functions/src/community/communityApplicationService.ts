import type {
  CommunityRepository,
  CitizenSubmissionBackend,
  CitizenSubmissionAttachmentBackend,
} from './communityRepository';
import { FirestoreCommunityRepository } from './firestoreCommunityRepository';
import { CommunityValidator } from './communityValidator';

export interface SubmitCitizenReportInput {
  id?: string;
  contributorName: string;
  contributorContact?: string;
  title: string;
  body: string;
  sourceLanguage: 'ar' | 'en';
  category: string;
  locationDescription?: string;
  attachments?: CitizenSubmissionAttachmentBackend[];
}

export interface AdminModeratorActor {
  uid: string;
  name: string;
  role: string;
}

export class CommunityApplicationService {
  private repo: CommunityRepository;

  constructor(repo?: CommunityRepository) {
    this.repo = repo || new FirestoreCommunityRepository();
  }

  /**
   * Creates a new canonical CitizenSubmission record.
   * - Authoritative ownership is strictly bound to authenticatedUid.
   * - Initial status is strictly 'Received' (client-supplied status or moderation fields are ignored).
   * - Never creates or publishes a public News article.
   */
  async submitReport(
    input: SubmitCitizenReportInput,
    authenticatedUid: string
  ): Promise<CitizenSubmissionBackend> {
    if (!authenticatedUid || !authenticatedUid.trim()) {
      throw new Error('UNAUTHENTICATED: Authenticated UID is required.');
    }

    const uid = authenticatedUid.trim();
    const now = new Date().toISOString();

    const requestedId =
      typeof input?.id === 'string' && /^sub-[a-zA-Z0-9_-]{6,64}$/.test(input.id.trim())
        ? input.id.trim()
        : `sub-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    const existing = await this.repo.getById(requestedId);
    if (existing) {
      throw new Error(`SUBMISSION_EXISTS: A submission with ID '${requestedId}' already exists.`);
    }

    const validated = CommunityValidator.validateNewSubmissionInput(input, uid, requestedId);

    const record: CitizenSubmissionBackend = {
      id: requestedId,
      submittedAt: now,
      submittedByUid: uid,
      contributorName: validated.contributorName,
      contributorContact: validated.contributorContact,
      title: validated.title,
      body: validated.body,
      sourceLanguage: validated.sourceLanguage,
      category: validated.category,
      locationDescription: validated.locationDescription,
      status: 'Received',
      attachments: validated.attachments,
      updatedAt: now,
    };

    await this.repo.save(record);
    return record;
  }

  async listAllForAdmin(): Promise<CitizenSubmissionBackend[]> {
    return this.repo.listAll();
  }

  async getByIdForAdmin(id: string): Promise<CitizenSubmissionBackend | null> {
    if (!id || typeof id !== 'string') return null;
    return this.repo.getById(id.trim());
  }

  async listByContributor(authenticatedUid: string): Promise<CitizenSubmissionBackend[]> {
    if (!authenticatedUid || !authenticatedUid.trim()) {
      throw new Error('UNAUTHENTICATED: Authenticated UID is required.');
    }
    return this.repo.listByContributorUid(authenticatedUid.trim());
  }

  /**
   * Updates moderation status and notes on an existing submission.
   * - Preserves original contributor identity, submittedByUid, and submittedAt.
   * - AcceptedForEditorial strictly marks editorial intake status and NEVER publishes a public News item.
   */
  async moderateSubmission(
    id: string,
    moderationInput: any,
    actor: AdminModeratorActor
  ): Promise<CitizenSubmissionBackend> {
    if (!id || typeof id !== 'string') {
      throw new Error('VALIDATION_ERROR: Submission ID is required.');
    }

    const existing = await this.repo.getById(id.trim());
    if (!existing) {
      throw new Error(`NOT_FOUND: Citizen submission '${id}' does not exist.`);
    }

    const validated = CommunityValidator.validateModerationUpdate(moderationInput);
    const now = new Date().toISOString();

    const updated: CitizenSubmissionBackend = {
      ...existing,
      id: existing.id,
      submittedAt: existing.submittedAt,
      submittedByUid: existing.submittedByUid,
      status: validated.status,
      moderatorNotes: validated.moderatorNotes,
      editorialReferenceId:
        validated.editorialReferenceId !== undefined
          ? validated.editorialReferenceId
          : existing.editorialReferenceId,
      reviewedByUid: actor.uid,
      reviewedByName: actor.name,
      updatedAt: now,
    };

    await this.repo.save(updated);
    return updated;
  }
}
