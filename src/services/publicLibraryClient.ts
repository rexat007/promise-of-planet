import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, isFirebaseConfigured } from './firebase';
import type { LibraryDocument } from '../types/library';
import { WorkflowState } from '../types/workflow';

export const PublicLibraryClient = {
  isBackendAvailable(): boolean {
    return isFirebaseConfigured && !!app;
  },

  async listPublishedDocuments(): Promise<LibraryDocument[]> {
    if (this.isBackendAvailable() && app) {
      try {
        const fns = getFunctions(app);
        const callable = httpsCallable<{}, { documents: LibraryDocument[] }>(fns, 'getPublicLibrary');
        const res = await callable({});
        const docs = res.data?.documents || [];
        // Server-enforced publication check
        return docs.filter(d => d.workflowState === WorkflowState.Published);
      } catch (err) {
        console.warn('Public library backend retrieval failed:', err);
        throw new Error('BACKEND_UNAVAILABLE: Public library service is currently unreachable.');
      }
    }
    // Return empty array when backend is not configured in preview environment (no mock fallback in production)
    return [];
  },
};
