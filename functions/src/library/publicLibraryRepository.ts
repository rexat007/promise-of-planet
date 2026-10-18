import type { LibraryRepository } from './libraryRepository';
import { WorkflowState } from '../shared/workflowContract';
import type { LibraryDocument } from '../shared/libraryContract';

export class PublicLibraryRepository {
  private repo: LibraryRepository;

  constructor(repo?: LibraryRepository) {
    if (repo) {
      this.repo = repo;
    } else {
      const { FirestoreLibraryRepository } = require('./firestoreLibraryRepository');
      this.repo = new FirestoreLibraryRepository();
    }
  }

  async listPublicDocuments(): Promise<LibraryDocument[]> {
    const all = await this.repo.listAll();
    // Server-enforced publication policy
    const published = all.filter(doc => doc.workflowState === WorkflowState.Published);
    return published.map(doc => ({
      id: doc.id,
      titleAr: doc.titleAr,
      titleEn: doc.titleEn,
      documentType: doc.documentType,
      organizationId: doc.organizationId,
      sourceId: doc.sourceId,
      geographyAr: doc.geographyAr,
      geographyEn: doc.geographyEn,
      publicationDate: doc.publicationDate,
      language: doc.language,
      summaryAr: doc.summaryAr,
      summaryEn: doc.summaryEn,
      topicsAr: doc.topicsAr || [],
      topicsEn: doc.topicsEn || [],
      environmentalDomains: doc.environmentalDomains || [],
      legalStatusDescriptionAr: doc.legalStatusDescriptionAr,
      legalStatusDescriptionEn: doc.legalStatusDescriptionEn,
      rightsStatus: doc.rightsStatus,
      versions: doc.versions || [],
      workflowState: doc.workflowState,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }));
  }
}
