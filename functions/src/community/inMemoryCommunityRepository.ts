import type { CommunityRepository, CitizenSubmissionBackend } from './communityRepository';

export class InMemoryCommunityRepository implements CommunityRepository {
  private items = new Map<string, CitizenSubmissionBackend>();

  async getById(id: string): Promise<CitizenSubmissionBackend | null> {
    if (!id) return null;
    const found = this.items.get(id);
    return found ? { ...found, attachments: [...found.attachments] } : null;
  }

  async save(submission: CitizenSubmissionBackend): Promise<void> {
    this.items.set(submission.id, {
      ...submission,
      attachments: (submission.attachments || []).map(a => ({ ...a })),
    });
  }

  async listAll(): Promise<CitizenSubmissionBackend[]> {
    return Array.from(this.items.values())
      .map(item => ({ ...item, attachments: [...item.attachments] }))
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  }

  async listByContributorUid(uid: string): Promise<CitizenSubmissionBackend[]> {
    if (!uid) return [];
    return Array.from(this.items.values())
      .filter(item => item.submittedByUid === uid)
      .map(item => ({ ...item, attachments: [...item.attachments] }))
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  }

  clear(): void {
    this.items.clear();
  }
}
