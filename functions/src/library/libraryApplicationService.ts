import type { LibraryRepository } from './libraryRepository';
import type { LibraryDocument, LibraryDocumentVersion } from '../../../src/types/library';
import { LibraryDocumentType, LibraryRightsStatus } from '../../../src/types/library';
import { WorkflowState, WorkflowAction, type WorkflowTransitionRecord } from '../../../src/types/workflow';
import type { AdminUser } from '../../../src/types/admin';
import { AdminPermission } from '../../../src/types/admin';
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
}
