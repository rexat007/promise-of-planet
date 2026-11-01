import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth, isFirebaseConfigured } from './firebase';
import type { 
  LibraryDocument, 
  LibraryRightsStatus,
  LibraryOrganization,
  LibrarySource
} from '../types/library';
import type {
  LibraryIntakeRecord,
  LibraryIntakeStatus,
  SubmitLibraryIntakeInput
} from '../../functions/src/shared/libraryContract';
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

  async listSources(): Promise<LibrarySource[]> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string }, { sources: LibrarySource[] }>(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'listSources' });
    return res.data?.sources ?? [];
  },

  async listOrganizations(): Promise<LibraryOrganization[]> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string }, { organizations: LibraryOrganization[] }>(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'listOrganizations' });
    return res.data?.organizations ?? [];
  },

  async registerSource(input: any): Promise<LibrarySource> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string; input: any }, { source: LibrarySource }>(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'registerSource', input });
    return res.data.source;
  },

  async registerOrganization(input: any): Promise<LibraryOrganization> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string; input: any }, { organization: LibraryOrganization }>(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'registerOrganization', input });
    return res.data.organization;
  },

  async verifySource(sourceId: string, status: 'Verified' | 'PendingVerification' | 'ThirdPartyIndex'): Promise<LibrarySource> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<
      { action: string; sourceId: string; status: string },
      { source: LibrarySource }
    >(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'verifySource', sourceId, status });
    return res.data.source;
  },

  async listIntake(): Promise<LibraryIntakeRecord[]> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string }, { intakeRecords?: LibraryIntakeRecord[]; intake?: LibraryIntakeRecord[] }>(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'listIntake' });
    return res.data?.intakeRecords ?? res.data?.intake ?? [];
  },

  async getIntakeById(id: string): Promise<LibraryIntakeRecord | null> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string; id: string }, { intakeRecord: LibraryIntakeRecord }>(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'getIntakeById', id });
    return res.data?.intakeRecord ?? null;
  },

  async submitIntake(input: SubmitLibraryIntakeInput): Promise<LibraryIntakeRecord> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<{ action: string; input: SubmitLibraryIntakeInput }, { intakeRecord: LibraryIntakeRecord }>(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'submitIntake', input });
    return res.data.intakeRecord;
  },

  async updateIntakeStatus(intakeId: string, status: LibraryIntakeStatus, reviewNotes?: string): Promise<LibraryIntakeRecord> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<
      { action: string; intakeId: string; status: LibraryIntakeStatus; reviewNotes?: string },
      { intakeRecord: LibraryIntakeRecord }
    >(fns, 'manageLibraryDocuments');
    const res = await callable({ action: 'updateIntakeStatus', intakeId, status, reviewNotes });
    return res.data.intakeRecord;
  },

  async generateIntakeAISuggestions(intakeId: string, suppliedExcerpt?: string): Promise<LibraryIntakeRecord> {
    const fns = getFunctionsInstance();
    const callable = httpsCallable<
      { action: string; intakeId: string; suppliedExcerpt?: string },
      { intakeRecord: LibraryIntakeRecord }
    >(fns, 'manageLibraryDocuments');
    const res = await callable({
      action: 'generateIntakeAISuggestions',
      intakeId,
      suppliedExcerpt: suppliedExcerpt && suppliedExcerpt.trim() !== '' ? suppliedExcerpt.trim() : undefined,
    });
    return res.data.intakeRecord;
  },
};

