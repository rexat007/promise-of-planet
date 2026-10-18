import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, isFirebaseConfigured } from './firebase';
import { LibraryRightsStatus, type PublicLibraryDocument } from '../types/library';
import { WorkflowState } from '../types/workflow';

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

function toPublicLibraryDocument(doc: PublicLibraryDocument): PublicLibraryDocument {
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
    topicsAr: Array.isArray(doc.topicsAr) ? [...doc.topicsAr] : [],
    topicsEn: Array.isArray(doc.topicsEn) ? [...doc.topicsEn] : [],
    environmentalDomains: Array.isArray(doc.environmentalDomains) ? [...doc.environmentalDomains] : [],
    legalStatusDescriptionAr: doc.legalStatusDescriptionAr,
    legalStatusDescriptionEn: doc.legalStatusDescriptionEn,
    rightsStatus: doc.rightsStatus,
    versions: Array.isArray(doc.versions)
      ? doc.versions.map(v => {
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
        })
      : [],
    workflowState: doc.workflowState,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export const PublicLibraryClient = {
  isBackendAvailable(): boolean {
    return isFirebaseConfigured && !!app;
  },

  async listPublishedDocuments(): Promise<PublicLibraryDocument[]> {
    if (this.isBackendAvailable() && app) {
      try {
        const fns = getFunctions(app);
        const callable = httpsCallable<{}, { documents: PublicLibraryDocument[] }>(fns, 'getPublicLibrary');
        const res = await callable({});
        const docs = res.data?.documents || [];
        // Server-enforced publication check and DTO sanitization
        return docs
          .filter(d => d.workflowState === WorkflowState.Published)
          .map(toPublicLibraryDocument);
      } catch (err) {
        console.warn('Public library backend retrieval failed:', err);
        throw new Error('BACKEND_UNAVAILABLE: Public library service is currently unreachable.');
      }
    }
    // Return empty array when backend is not configured in preview environment (no mock fallback in production)
    return [];
  },
};


