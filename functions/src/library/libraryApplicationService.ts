import type { LibraryRepository } from './libraryRepository';
import type { 
  LibraryDocument, 
  LibraryDocumentVersion,
  LibraryOrganization,
  LibrarySource,
  RegisterOrganizationInput,
  RegisterSourceInput
} from '../shared/libraryContract';
import { LibraryDocumentType, LibraryRightsStatus } from '../shared/libraryContract';
import { WorkflowState, WorkflowAction, type WorkflowTransitionRecord } from '../shared/workflowContract';
import type { AdminUser } from '../types/admin';
import { AdminPermission } from '../types/admin';
import { AdminAuthorizationService } from '../admin/adminAuthorizationService';
import { LibraryValidator } from './libraryValidator';

export interface CreateLibraryDocumentInput {
  id?: string;
  titleAr: string;
  titleEn: string;
  originalTitle?: string;
  documentType: LibraryDocumentType;
  organizationId: string;
  sourceId: string;
  geographyAr: string;
  geographyEn: string;
  publicationDate: string;
  language: 'ar' | 'en' | 'bilingual' | 'other';
  summaryAr: string;
  summaryEn: string;
  topicsAr: string[];
  topicsEn: string[];
  environmentalDomains: string[];
  rightsStatus?: LibraryRightsStatus;
  rightsNotesAr?: string;
  rightsNotesEn?: string;
  legalStatusDescriptionAr: string;
  legalStatusDescriptionEn: string;
  authorMetadataAr?: string;
  authorMetadataEn?: string;
}

export interface UpdateLibraryMetadataInput {
  titleAr?: string;
  titleEn?: string;
  originalTitle?: string;
  documentType?: LibraryDocumentType;
  organizationId?: string;
  sourceId?: string;
  geographyAr?: string;
  geographyEn?: string;
  publicationDate?: string;
  language?: 'ar' | 'en' | 'bilingual' | 'other';
  summaryAr?: string;
  summaryEn?: string;
  topicsAr?: string[];
  topicsEn?: string[];
  environmentalDomains?: string[];
  legalStatusDescriptionAr?: string;
  legalStatusDescriptionEn?: string;
  authorMetadataAr?: string;
  authorMetadataEn?: string;
}

export class LibraryApplicationService {
  private repo: LibraryRepository;
  private inMemoryOrgs: Map<string, LibraryOrganization> = new Map();
  private inMemorySources: Map<string, LibrarySource> = new Map();

  constructor(repo: LibraryRepository) {
    this.repo = repo;
  }

  async listAll(): Promise<LibraryDocument[]> {
    return this.repo.listAll();
  }

  async getById(id: string): Promise<LibraryDocument | null> {
    if (!id || typeof id !== 'string' || id.trim() === '') {
      return null;
    }
    return this.repo.getById(id.trim());
  }

  async create(input: CreateLibraryDocumentInput, actor: AdminUser): Promise<LibraryDocument> {
    this.validateCreateInput(input);

    const now = new Date().toISOString();
    const id = input.id && input.id.trim() !== '' ? input.id.trim() : `doc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const newDoc: LibraryDocument = {
      id,
      titleAr: input.titleAr.trim(),
      titleEn: input.titleEn.trim(),
      originalTitle: input.originalTitle?.trim(),
      documentType: input.documentType,
      organizationId: input.organizationId.trim(),
      sourceId: input.sourceId.trim(),
      geographyAr: input.geographyAr.trim(),
      geographyEn: input.geographyEn.trim(),
      publicationDate: input.publicationDate.trim(),
      language: input.language,
      summaryAr: input.summaryAr.trim(),
      summaryEn: input.summaryEn.trim(),
      topicsAr: Array.isArray(input.topicsAr) ? input.topicsAr.map(t => t.trim()) : [],
      topicsEn: Array.isArray(input.topicsEn) ? input.topicsEn.map(t => t.trim()) : [],
      environmentalDomains: Array.isArray(input.environmentalDomains) ? input.environmentalDomains.map(d => d.trim()) : [],
      rightsStatus: input.rightsStatus || LibraryRightsStatus.Unknown,
      rightsNotesAr: input.rightsNotesAr?.trim(),
      rightsNotesEn: input.rightsNotesEn?.trim(),
      workflowState: WorkflowState.Draft,
      workflowHistory: [],
      legalStatusDescriptionAr: input.legalStatusDescriptionAr.trim(),
      legalStatusDescriptionEn: input.legalStatusDescriptionEn.trim(),
      authorMetadataAr: input.authorMetadataAr?.trim(),
      authorMetadataEn: input.authorMetadataEn?.trim(),
      createdAt: now,
      updatedAt: now,
      versions: [
        {
          id: `ver-${id}-1`,
          documentId: id,
          versionNumber: '1.0',
          publishedDate: input.publicationDate.trim(),
          changeDescriptionAr: 'إنشاء مسودة السجل المعرفي الأولية',
          changeDescriptionEn: 'Initial draft knowledge record created',
        },
      ],
    };

    LibraryValidator.validateDocument(newDoc);
    return this.repo.create(newDoc);
  }

  async updateMetadata(id: string, updates: UpdateLibraryMetadataInput, actor: AdminUser): Promise<LibraryDocument> {
    const doc = await this.getById(id);
    if (!doc) {
      throw new Error(`NOT_FOUND: Document ${id} not found`);
    }

    const updated: LibraryDocument = {
      ...doc,
      ...(updates.titleAr !== undefined && { titleAr: updates.titleAr.trim() }),
      ...(updates.titleEn !== undefined && { titleEn: updates.titleEn.trim() }),
      ...(updates.originalTitle !== undefined && { originalTitle: updates.originalTitle.trim() }),
      ...(updates.documentType !== undefined && { documentType: updates.documentType }),
      ...(updates.organizationId !== undefined && { organizationId: updates.organizationId.trim() }),
      ...(updates.sourceId !== undefined && { sourceId: updates.sourceId.trim() }),
      ...(updates.geographyAr !== undefined && { geographyAr: updates.geographyAr.trim() }),
      ...(updates.geographyEn !== undefined && { geographyEn: updates.geographyEn.trim() }),
      ...(updates.publicationDate !== undefined && { publicationDate: updates.publicationDate.trim() }),
      ...(updates.language !== undefined && { language: updates.language }),
      ...(updates.summaryAr !== undefined && { summaryAr: updates.summaryAr.trim() }),
      ...(updates.summaryEn !== undefined && { summaryEn: updates.summaryEn.trim() }),
      ...(updates.topicsAr !== undefined && { topicsAr: updates.topicsAr.map(t => t.trim()) }),
      ...(updates.topicsEn !== undefined && { topicsEn: updates.topicsEn.map(t => t.trim()) }),
      ...(updates.environmentalDomains !== undefined && { environmentalDomains: updates.environmentalDomains.map(d => d.trim()) }),
      ...(updates.legalStatusDescriptionAr !== undefined && { legalStatusDescriptionAr: updates.legalStatusDescriptionAr.trim() }),
      ...(updates.legalStatusDescriptionEn !== undefined && { legalStatusDescriptionEn: updates.legalStatusDescriptionEn.trim() }),
      ...(updates.authorMetadataAr !== undefined && { authorMetadataAr: updates.authorMetadataAr.trim() }),
      ...(updates.authorMetadataEn !== undefined && { authorMetadataEn: updates.authorMetadataEn.trim() }),
      updatedAt: new Date().toISOString(),
    };

    // Ensure metadata update cannot mutate rights or workflow fields
    updated.rightsStatus = doc.rightsStatus;
    updated.rightsNotesAr = doc.rightsNotesAr;
    updated.rightsNotesEn = doc.rightsNotesEn;
    updated.workflowState = doc.workflowState;
    updated.workflowHistory = doc.workflowHistory;
    updated.versions = doc.versions;

    LibraryValidator.validateDocument(updated);
    return this.repo.update(updated);
  }

  async updateRights(id: string, rightsStatus: LibraryRightsStatus, notesAr?: string, notesEn?: string, actor?: AdminUser): Promise<LibraryDocument> {
    if (!Object.values(LibraryRightsStatus).includes(rightsStatus)) {
      throw new Error(`INVALID_ARGUMENT: Invalid rights status: ${rightsStatus}`);
    }

    const doc = await this.getById(id);
    if (!doc) {
      throw new Error(`NOT_FOUND: Document ${id} not found`);
    }

    const updated: LibraryDocument = {
      ...doc,
      rightsStatus,
      ...(notesAr !== undefined && { rightsNotesAr: notesAr.trim() }),
      ...(notesEn !== undefined && { rightsNotesEn: notesEn.trim() }),
      updatedAt: new Date().toISOString(),
    };

    // Ensure rights update cannot mutate workflow state/history or metadata
    updated.workflowState = doc.workflowState;
    updated.workflowHistory = doc.workflowHistory;

    LibraryValidator.validateDocument(updated);
    return this.repo.update(updated);
  }

  async transitionWorkflow(id: string, targetState: WorkflowState, comment: string | undefined, actor: AdminUser): Promise<LibraryDocument> {
    if (!Object.values(WorkflowState).includes(targetState)) {
      throw new Error(`INVALID_ARGUMENT: Invalid target workflow state: ${targetState}`);
    }

    const doc = await this.getById(id);
    if (!doc) {
      throw new Error(`NOT_FOUND: Document ${id} not found`);
    }

    const currentState = doc.workflowState;
    const action = this.determineWorkflowAction(currentState, targetState);
    if (!action) {
      throw new Error(`INVALID_TRANSITION: Transition from ${currentState} to ${targetState} is not permitted.`);
    }

    const requiredPermission = this.getRequiredPermissionForAction(action);
    const hasPerm = this.checkPermission(actor, requiredPermission, action);
    if (!hasPerm) {
      throw new Error(`PERMISSION_DENIED: Admin lacks required permission [${requiredPermission}] for action ${action}`);
    }

    const now = new Date().toISOString();
    const transitionRecord: WorkflowTransitionRecord = {
      id: `tr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      fromState: currentState,
      toState: targetState,
      action,
      actorName: actor.name || 'Admin',
      actorRole: actor.role || 'Editor',
      timestamp: now,
      comment: comment?.trim() || undefined,
    };

    const updated: LibraryDocument = {
      ...doc,
      workflowState: targetState,
      workflowHistory: [transitionRecord, ...doc.workflowHistory],
      updatedAt: now,
    };

    LibraryValidator.validateDocument(updated);
    return this.repo.update(updated);
  }

  async addVersion(id: string, versionInput: Omit<LibraryDocumentVersion, 'id' | 'documentId'>, actor: AdminUser): Promise<LibraryDocument> {
    const doc = await this.getById(id);
    if (!doc) {
      throw new Error(`NOT_FOUND: Document ${id} not found`);
    }

    if (!versionInput.versionNumber || versionInput.versionNumber.trim() === '') {
      throw new Error('VALIDATION_ERROR: versionNumber is required');
    }

    const newVersion: LibraryDocumentVersion = {
      id: `ver-${id}-${Date.now()}`,
      documentId: id,
      versionNumber: versionInput.versionNumber.trim(),
      publishedDate: versionInput.publishedDate?.trim() || new Date().toISOString().split('T')[0],
      changeDescriptionAr: versionInput.changeDescriptionAr?.trim() || '',
      changeDescriptionEn: versionInput.changeDescriptionEn?.trim() || '',
      referenceUrl: versionInput.referenceUrl?.trim(),
    };

    const updated: LibraryDocument = {
      ...doc,
      versions: [newVersion, ...doc.versions],
      updatedAt: new Date().toISOString(),
    };

    LibraryValidator.validateDocument(updated);
    return this.repo.update(updated);
  }

  private determineWorkflowAction(from: WorkflowState, to: WorkflowState): WorkflowAction | null {
    if (from === WorkflowState.Draft && to === WorkflowState.InReview) return WorkflowAction.SubmitForReview;
    if (from === WorkflowState.InReview && to === WorkflowState.ChangesRequested) return WorkflowAction.RequestChanges;
    if (from === WorkflowState.InReview && to === WorkflowState.Approved) return WorkflowAction.Approve;
    if (from === WorkflowState.ChangesRequested && to === WorkflowState.Draft) return WorkflowAction.ReviseDraft;
    if (from === WorkflowState.Approved && to === WorkflowState.Published) return WorkflowAction.Publish;
    return null;
  }

  private getRequiredPermissionForAction(action: WorkflowAction): AdminPermission {
    switch (action) {
      case WorkflowAction.SubmitForReview:
        return AdminPermission.Create;
      case WorkflowAction.RequestChanges:
        return AdminPermission.Review;
      case WorkflowAction.Approve:
        return AdminPermission.Approve;
      case WorkflowAction.ReviseDraft:
        return AdminPermission.Edit;
      case WorkflowAction.Publish:
        return AdminPermission.Publish;
      default:
        return AdminPermission.Edit;
    }
  }

  private checkPermission(actor: AdminUser, perm: AdminPermission, action: WorkflowAction): boolean {
    if (!actor.isActive) return false;
    if (AdminAuthorizationService.hasPermission(actor, perm)) {
      return true;
    }
    if (action === WorkflowAction.SubmitForReview && AdminAuthorizationService.hasPermission(actor, AdminPermission.Edit)) return true;
    if (action === WorkflowAction.ReviseDraft && AdminAuthorizationService.hasPermission(actor, AdminPermission.Create)) return true;
    return false;
  }

  private validateCreateInput(input: any): void {
    if (!input || typeof input !== 'object') throw new Error('VALIDATION_ERROR: Input object is required');

    const allowedFields = [
      'id', 'titleAr', 'titleEn', 'originalTitle', 'documentType', 'organizationId', 'sourceId',
      'geographyAr', 'geographyEn', 'publicationDate', 'language',
      'summaryAr', 'summaryEn', 'topicsAr', 'topicsEn', 'environmentalDomains',
      'rightsStatus', 'rightsNotesAr', 'rightsNotesEn', 'legalStatusDescriptionAr',
      'legalStatusDescriptionEn', 'authorMetadataAr', 'authorMetadataEn'
    ];

    for (const key in input) {
      if (!allowedFields.includes(key)) throw new Error(`VALIDATION_ERROR: Unexpected field in create input: ${key}`);
    }

    if (!input.titleAr || typeof input.titleAr !== 'string' || input.titleAr.trim() === '') throw new Error('VALIDATION_ERROR: titleAr is required');
    if (!input.titleEn || typeof input.titleEn !== 'string' || input.titleEn.trim() === '') throw new Error('VALIDATION_ERROR: titleEn is required');
    if (!input.documentType || !Object.values(LibraryDocumentType).includes(input.documentType)) throw new Error('VALIDATION_ERROR: Invalid documentType');
    if (!input.publicationDate || isNaN(Date.parse(input.publicationDate))) throw new Error('VALIDATION_ERROR: Invalid publicationDate');
    if (!['ar', 'en', 'bilingual', 'other'].includes(input.language)) throw new Error('VALIDATION_ERROR: Invalid language');
    
    if (!Array.isArray(input.topicsAr) || !input.topicsAr.every((t: any) => typeof t === 'string')) throw new Error('VALIDATION_ERROR: topicsAr must be string array');
    if (!Array.isArray(input.topicsEn) || !input.topicsEn.every((t: any) => typeof t === 'string')) throw new Error('VALIDATION_ERROR: topicsEn must be string array');
    if (!Array.isArray(input.environmentalDomains) || !input.environmentalDomains.every((d: any) => typeof d === 'string')) throw new Error('VALIDATION_ERROR: environmentalDomains must be string array');
    
    if (input.rightsStatus !== undefined && !Object.values(LibraryRightsStatus).includes(input.rightsStatus)) throw new Error('VALIDATION_ERROR: Invalid rightsStatus');
    if ((input.rightsNotesAr !== undefined && typeof input.rightsNotesAr !== 'string') || (input.rightsNotesEn !== undefined && typeof input.rightsNotesEn !== 'string')) throw new Error('VALIDATION_ERROR: Malformed rights notes');
  }

  // --- Organization Registry Operations ---

  async listOrganizations(): Promise<LibraryOrganization[]> {
    if (typeof (this.repo as any).listOrganizations === 'function') {
      return (this.repo as any).listOrganizations();
    }
    return Array.from(this.inMemoryOrgs.values());
  }

  async getOrganizationById(id: string): Promise<LibraryOrganization | null> {
    if (!id || typeof id !== 'string' || id.trim() === '') return null;
    const cleanId = id.trim();
    if (typeof (this.repo as any).getOrganizationById === 'function') {
      return (this.repo as any).getOrganizationById(cleanId);
    }
    return this.inMemoryOrgs.get(cleanId) || null;
  }

  async registerOrganization(input: RegisterOrganizationInput, actor: AdminUser): Promise<LibraryOrganization> {
    if (!actor.isActive) {
      throw new Error('PERMISSION_DENIED: Inactive admin user');
    }
    const canRegister = AdminAuthorizationService.hasPermission(actor, AdminPermission.Create) ||
                        AdminAuthorizationService.hasPermission(actor, AdminPermission.ManageRights);
    if (!canRegister) {
      throw new Error('PERMISSION_DENIED: Admin lacks required permission to register organizations');
    }

    this.validateOrganizationInput(input);

    const now = new Date().toISOString();
    const id = input.id && input.id.trim() !== ''
      ? input.id.trim()
      : `org-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const newOrg: LibraryOrganization = {
      id,
      nameAr: input.nameAr.trim(),
      nameEn: input.nameEn.trim(),
      type: input.type,
      countryRegionAr: input.countryRegionAr.trim(),
      countryRegionEn: input.countryRegionEn.trim(),
      websiteUrl: input.websiteUrl?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };

    if (typeof (this.repo as any).createOrganization === 'function') {
      return (this.repo as any).createOrganization(newOrg);
    }
    if (this.inMemoryOrgs.has(id)) {
      throw new Error(`DUPLICATE_ORGANIZATION: Organization with ID ${id} already exists`);
    }
    this.inMemoryOrgs.set(id, newOrg);
    return newOrg;
  }

  // --- Source Registry Operations ---

  async listSources(): Promise<LibrarySource[]> {
    if (typeof (this.repo as any).listSources === 'function') {
      return (this.repo as any).listSources();
    }
    return Array.from(this.inMemorySources.values());
  }

  async getSourceById(id: string): Promise<LibrarySource | null> {
    if (!id || typeof id !== 'string' || id.trim() === '') return null;
    const cleanId = id.trim();
    if (typeof (this.repo as any).getSourceById === 'function') {
      return (this.repo as any).getSourceById(cleanId);
    }
    return this.inMemorySources.get(cleanId) || null;
  }

  async registerSource(input: RegisterSourceInput, actor: AdminUser): Promise<LibrarySource> {
    if (!actor.isActive) {
      throw new Error('PERMISSION_DENIED: Inactive admin user');
    }
    const canRegister = AdminAuthorizationService.hasPermission(actor, AdminPermission.Create) ||
                        AdminAuthorizationService.hasPermission(actor, AdminPermission.ManageRights);
    if (!canRegister) {
      throw new Error('PERMISSION_DENIED: Admin lacks required permission to register sources');
    }

    this.validateSourceInput(input);

    // Enforce: "A source cannot reference a nonexistent organization."
    const org = await this.getOrganizationById(input.organizationId.trim());
    if (!org) {
      throw new Error(`VALIDATION_ERROR: Referenced organization does not exist: ${input.organizationId}`);
    }

    // Enforce: "Never automatically assign Verified to a newly registered source without an authorized verification decision."
    let verificationStatus: 'Verified' | 'PendingVerification' | 'ThirdPartyIndex' = 'PendingVerification';
    if (input.verificationStatus === 'Verified') {
      const hasRightsPerm = AdminAuthorizationService.hasPermission(actor, AdminPermission.ManageRights);
      if (!hasRightsPerm) {
        throw new Error('PERMISSION_DENIED: Only administrators with ManageRights permission can assign Verified status');
      }
      verificationStatus = 'Verified';
    } else if (input.verificationStatus === 'ThirdPartyIndex') {
      verificationStatus = 'ThirdPartyIndex';
    } else {
      verificationStatus = 'PendingVerification';
    }

    const now = new Date().toISOString();
    const id = input.id && input.id.trim() !== ''
      ? input.id.trim()
      : `src-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const newSource: LibrarySource = {
      id,
      organizationId: input.organizationId.trim(),
      sourceNameAr: input.sourceNameAr.trim(),
      sourceNameEn: input.sourceNameEn.trim(),
      sourceUrl: input.sourceUrl?.trim() || undefined,
      sourceType: input.sourceType,
      verificationStatus,
      createdAt: now,
      updatedAt: now,
    };

    if (typeof (this.repo as any).createSource === 'function') {
      return (this.repo as any).createSource(newSource);
    }
    if (this.inMemorySources.has(id)) {
      throw new Error(`DUPLICATE_SOURCE: Source with ID ${id} already exists`);
    }
    this.inMemorySources.set(id, newSource);
    return newSource;
  }

  async verifySource(sourceId: string, status: 'Verified' | 'PendingVerification' | 'ThirdPartyIndex', actor: AdminUser): Promise<LibrarySource> {
    if (!actor.isActive) {
      throw new Error('PERMISSION_DENIED: Inactive admin user');
    }
    if (!AdminAuthorizationService.hasPermission(actor, AdminPermission.ManageRights)) {
      throw new Error('PERMISSION_DENIED: Verifying sources requires ManageRights permission');
    }
    const validStatuses = ['Verified', 'PendingVerification', 'ThirdPartyIndex'];
    if (!validStatuses.includes(status)) {
      throw new Error(`INVALID_ARGUMENT: Invalid verification status: ${status}`);
    }

    const source = await this.getSourceById(sourceId);
    if (!source) {
      throw new Error(`NOT_FOUND: Source with ID ${sourceId} not found`);
    }

    const updated: LibrarySource = {
      ...source,
      verificationStatus: status,
      updatedAt: new Date().toISOString(),
    };

    if (typeof (this.repo as any).updateSource === 'function') {
      return (this.repo as any).updateSource(updated);
    }
    this.inMemorySources.set(sourceId, updated);
    return updated;
  }

  private validateOrganizationInput(input: any): void {
    if (!input || typeof input !== 'object') {
      throw new Error('VALIDATION_ERROR: Organization input object is required');
    }
    if (!input.nameAr || typeof input.nameAr !== 'string' || input.nameAr.trim() === '') {
      throw new Error('VALIDATION_ERROR: nameAr is required');
    }
    if (!input.nameEn || typeof input.nameEn !== 'string' || input.nameEn.trim() === '') {
      throw new Error('VALIDATION_ERROR: nameEn is required');
    }
    const allowedTypes = ['Ministry', 'InternationalBody', 'ResearchCenter', 'NGO', 'Judicial'];
    if (!input.type || !allowedTypes.includes(input.type)) {
      throw new Error(`VALIDATION_ERROR: Invalid organization type: ${input.type}`);
    }
    if (!input.countryRegionAr || typeof input.countryRegionAr !== 'string' || input.countryRegionAr.trim() === '') {
      throw new Error('VALIDATION_ERROR: countryRegionAr is required');
    }
    if (!input.countryRegionEn || typeof input.countryRegionEn !== 'string' || input.countryRegionEn.trim() === '') {
      throw new Error('VALIDATION_ERROR: countryRegionEn is required');
    }
    if (input.websiteUrl !== undefined && input.websiteUrl !== null && input.websiteUrl.trim() !== '') {
      const urlStr = input.websiteUrl.trim();
      try {
        const parsed = new URL(urlStr);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          throw new Error('Invalid protocol');
        }
      } catch {
        throw new Error('VALIDATION_ERROR: Invalid websiteUrl format');
      }
    }
  }

  private validateSourceInput(input: any): void {
    if (!input || typeof input !== 'object') {
      throw new Error('VALIDATION_ERROR: Source input object is required');
    }
    if (!input.sourceNameAr || typeof input.sourceNameAr !== 'string' || input.sourceNameAr.trim() === '') {
      throw new Error('VALIDATION_ERROR: sourceNameAr is required');
    }
    if (!input.sourceNameEn || typeof input.sourceNameEn !== 'string' || input.sourceNameEn.trim() === '') {
      throw new Error('VALIDATION_ERROR: sourceNameEn is required');
    }
    if (!input.organizationId || typeof input.organizationId !== 'string' || input.organizationId.trim() === '') {
      throw new Error('VALIDATION_ERROR: organizationId is required');
    }
    const allowedSourceTypes = ['OfficialGazette', 'GovernmentPortal', 'AcademicJournal', 'InstitutionalArchive'];
    if (!input.sourceType || !allowedSourceTypes.includes(input.sourceType)) {
      throw new Error(`VALIDATION_ERROR: Invalid sourceType: ${input.sourceType}`);
    }
    if (input.sourceUrl !== undefined && input.sourceUrl !== null && input.sourceUrl.trim() !== '') {
      const urlStr = input.sourceUrl.trim();
      try {
        const parsed = new URL(urlStr);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          throw new Error('Invalid protocol');
        }
      } catch {
        throw new Error('VALIDATION_ERROR: Invalid sourceUrl format');
      }
    }
  }
}
