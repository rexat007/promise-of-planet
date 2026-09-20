import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth, isFirebaseConfigured } from './firebase';
import type { Video, ContentVideoRelation, RightsStatus, VisibilityDecision, RelationType, Placement } from '../types';

function getFunctionsInstance() {
  if (!isFirebaseConfigured || !app) {
    throw new Error('BACKEND_UNCONFIGURED: Firebase backend is not configured in client environment.');
  }
  if (!auth?.currentUser) {
    throw new Error('UNAUTHENTICATED: Authentication required. Live Media management requires an authenticated Admin user session.');
  }
  return getFunctions(app);
}

export const MediaAdminClient = {
  isBackendAvailable(): boolean {
    return isFirebaseConfigured && !!app;
  },

  isAuthenticated(): boolean {
    return !!(isFirebaseConfigured && auth?.currentUser);
  },

  async listAll(): Promise<Video[]> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string }, { videos: Video[] }>(fns, 'manageMedia');
    const res = await callable({ action: 'listAll' });
    return res.data?.videos ?? [];
  },

  async getById(id: string): Promise<Video | null> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string; id: string }, { video: Video }>(fns, 'manageMedia');
    const res = await callable({ action: 'getById', id });
    return res.data?.video ?? null;
  },

  async getRelationsForVideo(videoId: string): Promise<ContentVideoRelation[]> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string; videoId: string }, { relations: ContentVideoRelation[] }>(fns, 'manageMedia');
    const res = await callable({ action: 'getRelationsForVideo', videoId });
    return res.data?.relations ?? [];
  },

  async register(input: any): Promise<Video> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string; input: any }, { video: Video }>(fns, 'manageMedia');
    const res = await callable({ action: 'register', input });
    return res.data.video;
  },

  async updateMetadata(id: string, updates: any): Promise<Video> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string; id: string; updates: any }, { video: Video }>(fns, 'manageMedia');
    const res = await callable({ action: 'updateMetadata', id, updates });
    return res.data.video;
  },

  async updateRightsStatus(id: string, rightsStatus: RightsStatus, notes?: string): Promise<Video> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string; id: string; rightsStatus: RightsStatus; notes?: string }, { video: Video }>(fns, 'manageMedia');
    const res = await callable({ action: 'updateRightsStatus', id, rightsStatus, notes });
    return res.data.video;
  },

  async updateVisibilityDecision(id: string, visibilityDecision: VisibilityDecision): Promise<Video> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string; id: string; visibilityDecision: VisibilityDecision }, { video: Video }>(fns, 'manageMedia');
    const res = await callable({ action: 'updateVisibilityDecision', id, visibilityDecision });
    return res.data.video;
  },

  async linkVideoToContent(
    videoId: string,
    contentId: string,
    relationType: RelationType,
    placement: Placement,
    options?: { isPrimary?: boolean; caption?: string; displayOrder?: number }
  ): Promise<ContentVideoRelation> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<
      { action: string; videoId: string; contentId: string; relationType: RelationType; placement: Placement; options?: any },
      { relation: ContentVideoRelation }
    >(fns, 'manageMedia');
    const res = await callable({ action: 'linkVideoToContent', videoId, contentId, relationType, placement, options });
    return res.data.relation;
  },

  async unlinkVideoFromContent(videoId: string, contentId: string): Promise<boolean> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string; videoId: string; contentId: string }, { success: boolean }>(fns, 'manageMedia');
    const res = await callable({ action: 'unlinkVideoFromContent', videoId, contentId });
    return res.data.success;
  },
};
