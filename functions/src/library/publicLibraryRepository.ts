import type { LibraryRepository } from './libraryRepository';
import { WorkflowState } from '../shared/workflowContract';
import {
  LibraryRightsStatus,
  type PublicLibraryDocument,
} from '../shared/libraryContract';

function sanitizePublicReferenceUrl(rawUrl?: string): string | undefined {
  if (typeof rawUrl !== 'string') return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || !parsed.hostname) {
      return undefined;
    }
    return trimmed;
  } catch {
    return undefined;
  }
}

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

  async listPublicDocuments(): Promise<PublicLibraryDocument[]> {
    const all = await this.repo.listAll();
    // Server-enforced publication policy
    const published = all.filter(doc => doc.workflowState === WorkflowState.Published);
    return published.map((doc): PublicLibraryDocument => {
      const canExposeReferenceUrl =
        doc.rightsStatus === LibraryRightsStatus.OpenPubliclyAvailable ||
        doc.rightsStatus === LibraryRightsStatus.PermissionGranted;

      const originalTitle = doc.originalTitle?.trim();

      return {
        id: doc.id,
        titleAr: doc.titleAr,
        titleEn: doc.titleEn,
        ...(originalTitle ? { originalTitle } : {}),
        documentType: doc.documentType,
        organizationId: doc.organizationId,
        sourceId: doc.sourceId,
        geographyAr: doc.geographyAr,
        geographyEn: doc.geographyEn,
        publicationDate: doc.publicationDate,
        language: doc.language,
        summaryAr: doc.summaryAr,
        summaryEn: doc.summaryEn,
        topicsAr: [...(doc.topicsAr || [])],
        topicsEn: [...(doc.topicsEn || [])],
        environmentalDomains: [...(doc.environmentalDomains || [])],
        legalStatusDescriptionAr: doc.legalStatusDescriptionAr,
        legalStatusDescriptionEn: doc.legalStatusDescriptionEn,
        rightsStatus: doc.rightsStatus,
        versions: (doc.versions || []).map(v => {
          const safeUrl = canExposeReferenceUrl ? sanitizePublicReferenceUrl(v.referenceUrl) : undefined;
          return {
            id: v.id,
            documentId: v.documentId,
            versionNumber: v.versionNumber,
            publishedDate: v.publishedDate,
            changeDescriptionAr: v.changeDescriptionAr,
            changeDescriptionEn: v.changeDescriptionEn,
            ...(safeUrl ? { referenceUrl: safeUrl } : {}),
          };
        }),
        workflowState: doc.workflowState,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      };
    });
  }
}


