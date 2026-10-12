import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth, isFirebaseConfigured } from './firebase';
import type { LibraryDocument, LibraryRightsStatus } from '../types/library';
import type { WorkflowState } from '../types/workflow';

function getFunctionsInstance() {
  if (!isFirebaseConfigured || !app) {
    throw new Error('BACKEND_UNCONFIGURED: Firebase backend is not configured in client environment.');
  }
  if (!auth?.currentUser) {
    throw new Error('UNAUTHENTICATED: Authentication required. Library management requires an authenticated Admin user session.');
  }
  return getFunctions(app);
}

export const LibraryAdminClient = {
  isBackendAvailable(): boolean {
    return isFirebaseConfigured && !!app;
  },

  isAuthenticated(): boolean {
    return !!(isFirebaseConfigured && auth?.currentUser);
  },

  async listAll(): Promise<LibraryDocument[]> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string }, { documents: LibraryDocument[] }>(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'listAll' });
    return res.data?.documents ?? [];
  },

  async getById(id: string): Promise<LibraryDocument | null> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string; id: string }, { document: LibraryDocument }>(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'getById', id });
    return res.data?.document ?? null;
  },

  async create(input: any): Promise<LibraryDocument> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string; input: any }, { document: LibraryDocument }>(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'create', input });
    return res.data.document;
  },

  async updateMetadata(id: string, updates: any): Promise<LibraryDocument> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string; id: string; updates: any }, { document: LibraryDocument }>(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'updateMetadata', id, updates });
    return res.data.document;
  },

  async updateRights(id: string, rightsStatus: LibraryRightsStatus, notesAr?: string, notesEn?: string): Promise<LibraryDocument> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<
      { action: string; id: string; rightsStatus: LibraryRightsStatus; notesAr?: string; notesEn?: string },
      { document: LibraryDocument }
    >(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'updateRights', id, rightsStatus, notesAr, notesEn });
    return res.data.document;
  },

  async transitionWorkflow(id: string, targetState: WorkflowState, comment?: string): Promise<LibraryDocument> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<
      { action: string; id: string; targetState: WorkflowState; comment?: string },
      { document: LibraryDocument }
    >(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'transitionWorkflow', id, targetState, comment });
    return res.data.document;
  },

  async addVersion(id: string, versionInput: any): Promise<LibraryDocument> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<
      { action: string; id: string; versionInput: any },
      { document: LibraryDocument }
    >(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'addVersion', id, versionInput });
    return res.data.document;
  },
};
