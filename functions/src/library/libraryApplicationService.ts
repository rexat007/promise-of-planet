import type { LibraryRepository } from './libraryRepository';
import type { 
  LibraryDocument, 
  LibraryDocumentVersion,
  LibraryOrganization,
  LibrarySource,
  RegisterOrganizationInput,
  RegisterSourceInput,
  LibraryIntakeRecord,
  SubmitLibraryIntakeInput,
  LibraryIntakeAISuggestion,
  GenerateLibraryIntakeAISuggestionsInput
} from '../shared/libraryContract';
import {
  LibraryDocumentType,
  LibraryRightsStatus,
  LibraryIntakeStatus,
  LibraryIntakeAIInputBasis
} from '../shared/libraryContract';
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
  private inMemoryIntake: Map<string, LibraryIntakeRecord> = new Map();

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

  // --- Intake Inbox Operations ---

  async listIntake(): Promise<LibraryIntakeRecord[]> {
    if (typeof (this.repo as any).listIntake === 'function') {
      return (this.repo as any).listIntake();
    }
    const records = Array.from(this.inMemoryIntake.values());
    return records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getIntakeById(id: string): Promise<LibraryIntakeRecord | null> {
    if (!id || typeof id !== 'string' || id.trim() === '') return null;
    const cleanId = id.trim();
    if (typeof (this.repo as any).getIntakeById === 'function') {
      return (this.repo as any).getIntakeById(cleanId);
    }
    return this.inMemoryIntake.get(cleanId) || null;
  }

  async submitIntake(input: SubmitLibraryIntakeInput, actor: AdminUser): Promise<LibraryIntakeRecord> {
    if (!actor.isActive) {
      throw new Error('PERMISSION_DENIED: Inactive admin user');
    }
    const canSubmit = AdminAuthorizationService.hasPermission(actor, AdminPermission.Create) ||
                      AdminAuthorizationService.hasPermission(actor, AdminPermission.Edit);
    if (!canSubmit) {
      throw new Error('PERMISSION_DENIED: Submitting intake references requires Create or Edit permission');
    }

    if (!input || typeof input !== 'object') {
      throw new Error('VALIDATION_ERROR: Intake input object is required');
    }
    if (!input.title || typeof input.title !== 'string' || input.title.trim() === '') {
      throw new Error('VALIDATION_ERROR: Document title is required for intake');
    }

    const { originalUrl, normalizedUrl } = normalizeIntakeUrl(input.url);

    if (input.organizationId && input.organizationId.trim() !== '') {
      const org = await this.getOrganizationById(input.organizationId.trim());
      if (!org) {
        throw new Error(`VALIDATION_ERROR: Referenced organization does not exist: ${input.organizationId}`);
      }
    }

    if (input.sourceId && input.sourceId.trim() !== '') {
      const src = await this.getSourceById(input.sourceId.trim());
      if (!src) {
        throw new Error(`VALIDATION_ERROR: Referenced source does not exist: ${input.sourceId}`);
      }
    }

    const allowedLanguages = ['ar', 'en', 'bilingual', 'other'];
    const language = input.language && allowedLanguages.includes(input.language) ? input.language : 'ar';

    const now = new Date().toISOString();
    const id = `intake-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const newRecord: LibraryIntakeRecord = {
      id,
      url: originalUrl,
      normalizedUrl,
      title: input.title.trim(),
      organizationId: input.organizationId?.trim() || undefined,
      sourceId: input.sourceId?.trim() || undefined,
      language,
      notes: input.notes?.trim() || undefined,
      status: LibraryIntakeStatus.PendingReview,
      submittedByAdminId: (actor as any).uid || actor.id,
      submittedByAdminName: (actor as any).displayName || actor.name || actor.email,
      createdAt: now,
      updatedAt: now,
    };

    if (typeof (this.repo as any).createIntake === 'function') {
      return (this.repo as any).createIntake(newRecord);
    }

    // In-memory duplicate check
    for (const existing of this.inMemoryIntake.values()) {
      if (existing.normalizedUrl === normalizedUrl) {
        throw new Error(`DUPLICATE_INTAKE: Reference URL already exists in intake queue: ${normalizedUrl}`);
      }
    }

    this.inMemoryIntake.set(id, newRecord);
    return newRecord;
  }

  async updateIntakeStatus(
    intakeId: string, 
    status: LibraryIntakeStatus, 
    reviewNotes: string | undefined, 
    actor: AdminUser
  ): Promise<LibraryIntakeRecord> {
    if (!actor.isActive) {
      throw new Error('PERMISSION_DENIED: Inactive admin user');
    }
    const canReview = AdminAuthorizationService.hasPermission(actor, AdminPermission.Review) ||
                      AdminAuthorizationService.hasPermission(actor, AdminPermission.Approve) ||
                      AdminAuthorizationService.hasPermission(actor, AdminPermission.ManageRights);
    if (!canReview) {
      throw new Error('PERMISSION_DENIED: Reviewing or changing intake status requires Review, Approve, or ManageRights permission');
    }

    const allowedStatuses: LibraryIntakeStatus[] = [
      LibraryIntakeStatus.PendingReview,
      LibraryIntakeStatus.InPreparation,
      LibraryIntakeStatus.Rejected,
    ];
    if (!allowedStatuses.includes(status)) {
      throw new Error(`INVALID_ARGUMENT: Invalid intake status: ${status}`);
    }

    const record = await this.getIntakeById(intakeId);
    if (!record) {
      throw new Error(`NOT_FOUND: Intake record with ID ${intakeId} not found`);
    }

    const now = new Date().toISOString();
    const updated: LibraryIntakeRecord = {
      ...record,
      status,
      reviewNotes: reviewNotes !== undefined && reviewNotes !== null ? reviewNotes.trim() : record.reviewNotes,
      reviewedByAdminId: (actor as any).uid || actor.id,
      reviewedByAdminName: (actor as any).displayName || actor.name || actor.email,
      reviewedAt: now,
      updatedAt: now,
    };

    if (typeof (this.repo as any).updateIntake === 'function') {
      return (this.repo as any).updateIntake(updated);
    }

    this.inMemoryIntake.set(intakeId, updated);
    return updated;
  }

  // --- Human-Triggered AI Preparation Assistant for Intake Records ---

  async generateIntakeAISuggestions(
    input: GenerateLibraryIntakeAISuggestionsInput,
    actor: AdminUser,
    options?: {
      apiKey?: string;
      fetchImpl?: typeof fetch;
      timeoutMs?: number;
    }
  ): Promise<LibraryIntakeRecord> {
    if (!actor || !actor.isActive) {
      throw new Error('PERMISSION_DENIED: Inactive or unauthenticated admin user');
    }

    const canPrepare =
      AdminAuthorizationService.hasPermission(actor, AdminPermission.Create) ||
      AdminAuthorizationService.hasPermission(actor, AdminPermission.Edit) ||
      AdminAuthorizationService.hasPermission(actor, AdminPermission.Review) ||
      AdminAuthorizationService.hasPermission(actor, AdminPermission.Approve) ||
      AdminAuthorizationService.hasPermission(actor, AdminPermission.ManageRights);

    if (!canPrepare) {
      throw new Error(
        'PERMISSION_DENIED: Generating AI preparation suggestions requires editorial or curation permission'
      );
    }

    if (!input || typeof input !== 'object' || !input.intakeId || typeof input.intakeId !== 'string' || input.intakeId.trim() === '') {
      throw new Error('VALIDATION_ERROR: A valid intakeId is required to generate AI preparation suggestions');
    }

    const intakeId = input.intakeId.trim();
    const record = await this.getIntakeById(intakeId);
    if (!record) {
      throw new Error(`NOT_FOUND: Intake record with ID ${intakeId} not found`);
    }

    let cleanExcerpt: string | undefined = undefined;
    if (input.suppliedExcerpt !== undefined && input.suppliedExcerpt !== null) {
      if (typeof input.suppliedExcerpt !== 'string') {
        throw new Error('VALIDATION_ERROR: suppliedExcerpt must be a string when provided');
      }
      const trimmed = input.suppliedExcerpt.trim();
      if (trimmed.length > 12000) {
        throw new Error('VALIDATION_ERROR: suppliedExcerpt exceeds maximum allowed length of 12000 characters');
      }
      if (trimmed.length > 0) {
        cleanExcerpt = trimmed;
      }
    }

    const inputBasis = cleanExcerpt
      ? LibraryIntakeAIInputBasis.SuppliedExcerptAndMetadata
      : LibraryIntakeAIInputBasis.MetadataOnly;

    const resolvedApiKey = (options?.apiKey ?? process.env.GEMINI_API_KEY ?? '').trim();
    if (!resolvedApiKey) {
      throw new Error(
        'CONFIG_ERROR: GEMINI_API_KEY is not configured on the server. AI preparation assistant is unavailable until the secret is provisioned.'
      );
    }

    const expectedUpdatedAt = record.updatedAt;

    // Load linked canonical registry context if available
    const linkedOrg = record.organizationId ? await this.getOrganizationById(record.organizationId) : null;
    const linkedSource = record.sourceId ? await this.getSourceById(record.sourceId) : null;

    const modelId = 'gemini-3.5-flash-lite';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
    const fetchFn = options?.fetchImpl || globalThis.fetch;
    if (typeof fetchFn !== 'function') {
      throw new Error('CONFIG_ERROR: Server runtime does not provide a global fetch implementation');
    }

    const promptPayload = buildGeminiIntakePreparationPrompt(record, linkedOrg, linkedSource, cleanExcerpt, inputBasis);
    const timeoutMs = options?.timeoutMs ?? 25000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let rawResponseText = '';
    try {
      const response = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': resolvedApiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: promptPayload }],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`AI_PROVIDER_ERROR: Gemini API request failed with HTTP status ${response.status}`);
      }

      rawResponseText = await response.text();
      if (rawResponseText.length > 65536) {
        throw new Error('AI_PROVIDER_ERROR: Gemini API response exceeded maximum allowed payload size');
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new Error(`AI_PROVIDER_ERROR: Gemini API request timed out after ${timeoutMs}ms`);
      }
      if (err?.message?.startsWith('AI_PROVIDER_ERROR:') || err?.message?.startsWith('VALIDATION_ERROR:')) {
        throw err;
      }
      throw new Error('AI_PROVIDER_ERROR: Failed to communicate with Gemini API provider');
    } finally {
      clearTimeout(timer);
    }

    const parsedCandidate = parseAndValidateGeminiSuggestion(rawResponseText, inputBasis);
    const now = new Date().toISOString();

    const aiSuggestion: LibraryIntakeAISuggestion = {
      isAdvisoryOnly: true,
      verificationWarningAr:
        'مقترحات آلية غير موثقة — استرشادية فقط وتتطلب مراجعة واعتماداً بشرياً قبل أي تسجيل رسمي في المكتبة.',
      verificationWarningEn:
        'Unverified machine-generated recommendations — advisory only and require human editorial verification before canonical library registration.',
      modelId,
      generatedAt: now,
      generatedByAdminId: (actor as any).uid || actor.id,
      generatedByAdminName: (actor as any).displayName || actor.name || actor.email,
      inputBasis,
      sourceIntakeUpdatedAt: expectedUpdatedAt,
      suggestedTitleAr: parsedCandidate.suggestedTitleAr,
      suggestedTitleEn: parsedCandidate.suggestedTitleEn,
      suggestedIssuingOrganization: parsedCandidate.suggestedIssuingOrganization,
      suggestedDocumentType: parsedCandidate.suggestedDocumentType,
      suggestedEnvironmentalDomains: parsedCandidate.suggestedEnvironmentalDomains,
      suggestedTopicsAr: parsedCandidate.suggestedTopicsAr,
      suggestedTopicsEn: parsedCandidate.suggestedTopicsEn,
      suggestedSummaryAr: parsedCandidate.suggestedSummaryAr,
      suggestedSummaryEn: parsedCandidate.suggestedSummaryEn,
      provenanceObservationsAr: parsedCandidate.provenanceObservationsAr,
      provenanceObservationsEn: parsedCandidate.provenanceObservationsEn,
      uncertaintyNoticesAr: parsedCandidate.uncertaintyNoticesAr,
      uncertaintyNoticesEn: parsedCandidate.uncertaintyNoticesEn,
    };

    if (typeof (this.repo as any).saveIntakeAISuggestion === 'function') {
      return (this.repo as any).saveIntakeAISuggestion(
        record.id,
        expectedUpdatedAt,
        cleanExcerpt,
        aiSuggestion,
        now
      );
    }

    // In-memory repository path with optimistic concurrency protection
    const latestInMemory = this.inMemoryIntake.get(record.id);
    if (!latestInMemory) {
      throw new Error(`NOT_FOUND: Intake record with ID ${record.id} not found`);
    }
    if (latestInMemory.updatedAt !== expectedUpdatedAt) {
      throw new Error(
        `CONFLICT: Intake record ${record.id} was modified by a newer editorial action while AI preparation was in flight.`
      );
    }

    const updatedRecord: LibraryIntakeRecord = {
      ...latestInMemory,
      ...(cleanExcerpt !== undefined ? { suppliedExcerpt: cleanExcerpt } : {}),
      aiSuggestion,
      updatedAt: now,
    };

    this.inMemoryIntake.set(record.id, updatedRecord);
    return updatedRecord;
  }
}

function buildGeminiIntakePreparationPrompt(
  record: LibraryIntakeRecord,
  linkedOrg: LibraryOrganization | null,
  linkedSource: LibrarySource | null,
  suppliedExcerpt: string | undefined,
  inputBasis: LibraryIntakeAIInputBasis
): string {
  const allowedDocTypes = Object.values(LibraryDocumentType).join(', ');
  const contextObj = {
    intakeId: record.id,
    title: record.title,
    normalizedHttpsUrl: record.normalizedUrl,
    originalLanguage: record.language,
    intakeNotes: record.notes || null,
    linkedOrganization: linkedOrg
      ? { id: linkedOrg.id, nameAr: linkedOrg.nameAr, nameEn: linkedOrg.nameEn, type: linkedOrg.type }
      : null,
    linkedSource: linkedSource
      ? {
          id: linkedSource.id,
          sourceNameAr: linkedSource.sourceNameAr,
          sourceNameEn: linkedSource.sourceNameEn,
          sourceType: linkedSource.sourceType,
          verificationStatus: linkedSource.verificationStatus,
        }
      : null,
    inputBasis,
    suppliedDocumentExcerpt: suppliedExcerpt || null,
  };

  return [
    'You are an internal editorial preparation assistant for the Promise of Planet Environmental Library.',
    'Analyze ONLY the provided canonical LibraryIntakeRecord metadata and optional admin-supplied document excerpt.',
    'STRICT TRUTHFULNESS RULES:',
    '1. You have NOT fetched or read the external URL or any remote PDF file.',
    '2. If inputBasis is "MetadataOnly" (suppliedDocumentExcerpt is null), you MUST set suggestedSummaryAr and suggestedSummaryEn to null, and include explicit uncertainty notices stating that the remote document body was not read.',
    '3. If inputBasis is "SuppliedExcerptAndMetadata", summarize ONLY what is substantiated by suppliedDocumentExcerpt without inventing legal articles or provisions.',
    `4. suggestedDocumentType MUST be one of: [${allowedDocTypes}].`,
    '5. Return ONLY a valid JSON object matching this exact structure:',
    JSON.stringify({
      suggestedTitleAr: 'string',
      suggestedTitleEn: 'string',
      suggestedIssuingOrganization: 'string',
      suggestedDocumentType: 'Law | ExecutiveRegulation | Decision | InstitutionalReport | PolicyPaper | ResearchStudy | InternationalAgreement',
      suggestedEnvironmentalDomains: ['string'],
      suggestedTopicsAr: ['string'],
      suggestedTopicsEn: ['string'],
      suggestedSummaryAr: inputBasis === LibraryIntakeAIInputBasis.SuppliedExcerptAndMetadata ? 'string' : null,
      suggestedSummaryEn: inputBasis === LibraryIntakeAIInputBasis.SuppliedExcerptAndMetadata ? 'string' : null,
      provenanceObservationsAr: ['string'],
      provenanceObservationsEn: ['string'],
      uncertaintyNoticesAr: ['string'],
      uncertaintyNoticesEn: ['string'],
    }),
    'CANONICAL INTAKE CONTEXT:',
    JSON.stringify(contextObj),
  ].join('\n');
}

function sanitizeStringArray(arr: unknown, fieldName: string, maxItems = 10, maxItemLength = 300): string[] {
  if (!Array.isArray(arr)) {
    throw new Error(`AI_PROVIDER_ERROR: Invalid AI response schema: ${fieldName} must be an array`);
  }
  const cleaned = arr
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => item.trim().slice(0, maxItemLength))
    .slice(0, maxItems);

  if (cleaned.length === 0) {
    throw new Error(`AI_PROVIDER_ERROR: Invalid AI response schema: ${fieldName} must contain at least one non-empty string`);
  }
  return cleaned;
}

function parseAndValidateGeminiSuggestion(
  rawResponseText: string,
  inputBasis: LibraryIntakeAIInputBasis
): {
  suggestedTitleAr: string;
  suggestedTitleEn: string;
  suggestedIssuingOrganization: string;
  suggestedDocumentType: LibraryDocumentType;
  suggestedEnvironmentalDomains: string[];
  suggestedTopicsAr: string[];
  suggestedTopicsEn: string[];
  suggestedSummaryAr: string | null;
  suggestedSummaryEn: string | null;
  provenanceObservationsAr: string[];
  provenanceObservationsEn: string[];
  uncertaintyNoticesAr: string[];
  uncertaintyNoticesEn: string[];
} {
  let envelope: any;
  try {
    envelope = JSON.parse(rawResponseText);
  } catch {
    throw new Error('AI_PROVIDER_ERROR: Gemini API returned non-JSON HTTP payload');
  }

  const candidateText = envelope?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!candidateText || typeof candidateText !== 'string') {
    throw new Error('AI_PROVIDER_ERROR: Gemini API response missing candidate text content');
  }

  const strippedJson = candidateText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(strippedJson);
  } catch {
    throw new Error('AI_PROVIDER_ERROR: Model candidate output is not valid JSON');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AI_PROVIDER_ERROR: Model candidate JSON must be an object');
  }

  if (typeof parsed.suggestedTitleAr !== 'string' || parsed.suggestedTitleAr.trim() === '') {
    throw new Error('AI_PROVIDER_ERROR: Invalid AI response schema: suggestedTitleAr is required');
  }
  if (typeof parsed.suggestedTitleEn !== 'string' || parsed.suggestedTitleEn.trim() === '') {
    throw new Error('AI_PROVIDER_ERROR: Invalid AI response schema: suggestedTitleEn is required');
  }
  if (typeof parsed.suggestedIssuingOrganization !== 'string' || parsed.suggestedIssuingOrganization.trim() === '') {
    throw new Error('AI_PROVIDER_ERROR: Invalid AI response schema: suggestedIssuingOrganization is required');
  }

  const allowedDocTypes = Object.values(LibraryDocumentType) as string[];
  if (typeof parsed.suggestedDocumentType !== 'string' || !allowedDocTypes.includes(parsed.suggestedDocumentType)) {
    throw new Error(`AI_PROVIDER_ERROR: Invalid AI response schema: unsupported suggestedDocumentType "${String(parsed.suggestedDocumentType)}"`);
  }

  const suggestedEnvironmentalDomains = sanitizeStringArray(parsed.suggestedEnvironmentalDomains, 'suggestedEnvironmentalDomains', 8, 120);
  const suggestedTopicsAr = sanitizeStringArray(parsed.suggestedTopicsAr, 'suggestedTopicsAr', 10, 120);
  const suggestedTopicsEn = sanitizeStringArray(parsed.suggestedTopicsEn, 'suggestedTopicsEn', 10, 120);
  const provenanceObservationsAr = sanitizeStringArray(parsed.provenanceObservationsAr, 'provenanceObservationsAr', 6, 400);
  const provenanceObservationsEn = sanitizeStringArray(parsed.provenanceObservationsEn, 'provenanceObservationsEn', 6, 400);
  const uncertaintyNoticesAr = sanitizeStringArray(parsed.uncertaintyNoticesAr, 'uncertaintyNoticesAr', 6, 400);
  const uncertaintyNoticesEn = sanitizeStringArray(parsed.uncertaintyNoticesEn, 'uncertaintyNoticesEn', 6, 400);

  let suggestedSummaryAr: string | null = null;
  let suggestedSummaryEn: string | null = null;

  if (inputBasis === LibraryIntakeAIInputBasis.MetadataOnly) {
    // Strictly enforce truthfulness: never output a document summary when no document excerpt was provided
    suggestedSummaryAr = null;
    suggestedSummaryEn = null;

    const mandatoryNoticeAr = 'تم توليد هذه المقترحات بناءً على البيانات الوصفية فقط دون قراءة نص الوثيقة أو ملف PDF الخارجي.';
    const mandatoryNoticeEn = 'Generated from intake metadata only; the external document body/PDF was not fetched or read.';
    if (!uncertaintyNoticesAr.some(n => n.includes('البيانات الوصفية') || n.includes('PDF'))) {
      uncertaintyNoticesAr.unshift(mandatoryNoticeAr);
    }
    if (!uncertaintyNoticesEn.some(n => n.toLowerCase().includes('metadata only') || n.toLowerCase().includes('not fetched'))) {
      uncertaintyNoticesEn.unshift(mandatoryNoticeEn);
    }
  } else {
    if (typeof parsed.suggestedSummaryAr !== 'string' || parsed.suggestedSummaryAr.trim() === '') {
      throw new Error('AI_PROVIDER_ERROR: Invalid AI response schema: suggestedSummaryAr is required when excerpt is supplied');
    }
    if (typeof parsed.suggestedSummaryEn !== 'string' || parsed.suggestedSummaryEn.trim() === '') {
      throw new Error('AI_PROVIDER_ERROR: Invalid AI response schema: suggestedSummaryEn is required when excerpt is supplied');
    }
    suggestedSummaryAr = parsed.suggestedSummaryAr.trim().slice(0, 2000);
    suggestedSummaryEn = parsed.suggestedSummaryEn.trim().slice(0, 2000);
  }

  return {
    suggestedTitleAr: parsed.suggestedTitleAr.trim().slice(0, 300),
    suggestedTitleEn: parsed.suggestedTitleEn.trim().slice(0, 300),
    suggestedIssuingOrganization: parsed.suggestedIssuingOrganization.trim().slice(0, 250),
    suggestedDocumentType: parsed.suggestedDocumentType as LibraryDocumentType,
    suggestedEnvironmentalDomains,
    suggestedTopicsAr,
    suggestedTopicsEn,
    suggestedSummaryAr,
    suggestedSummaryEn,
    provenanceObservationsAr,
    provenanceObservationsEn,
    uncertaintyNoticesAr,
    uncertaintyNoticesEn,
  };
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().trim();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') {
    return true;
  }
  if (host === 'metadata.google.internal' || host === 'metadata.internal' || host === '169.254.169.254') {
    return true;
  }
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) {
    return true;
  }
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const oct1 = parseInt(ipv4Match[1], 10);
    const oct2 = parseInt(ipv4Match[2], 10);
    if (oct1 === 10) return true;
    if (oct1 === 127) return true;
    if (oct1 === 169 && oct2 === 254) return true;
    if (oct1 === 172 && oct2 >= 16 && oct2 <= 31) return true;
    if (oct1 === 192 && oct2 === 168) return true;
    if (oct1 === 0) return true;
  }
  return false;
}

function normalizeIntakeUrl(rawUrl: string): { originalUrl: string; normalizedUrl: string } {
  if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new Error('VALIDATION_ERROR: Reference URL is required');
  }
  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('VALIDATION_ERROR: Invalid reference URL format');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('VALIDATION_ERROR: Only secure HTTPS URLs are permitted for library intake references');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (isPrivateOrLocalHost(hostname)) {
    throw new Error('VALIDATION_ERROR: Reference URL cannot point to localhost, internal metadata, or private network addresses');
  }

  // Strip fragment / hash
  parsed.hash = '';

  // Filter out marketing tracking parameters
  const trackingPrefixes = ['utm_', 'fbclid', 'gclid', 'msclkid', 'mc_cid', 'mc_eid'];
  const paramsToKeep: [string, string][] = [];
  parsed.searchParams.forEach((val, key) => {
    const lowerKey = key.toLowerCase();
    if (!trackingPrefixes.some(prefix => lowerKey.startsWith(prefix)) && lowerKey !== 'ref') {
      paramsToKeep.push([key, val]);
    }
  });

  // Re-build normalized query string sorted
  paramsToKeep.sort((a, b) => a[0].localeCompare(b[0]));
  parsed.search = '';
  for (const [k, v] of paramsToKeep) {
    parsed.searchParams.append(k, v);
  }

  // Normalize pathname: remove trailing slash if length > 1
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  const normalizedUrl = parsed.toString().toLowerCase();
  return { originalUrl: trimmed, normalizedUrl };
}
