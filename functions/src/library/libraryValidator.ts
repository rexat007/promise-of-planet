import type { LibraryDocument, LibraryDocumentVersion } from '../shared/libraryContract';
import { LibraryDocumentType, LibraryRightsStatus } from '../shared/libraryContract';
import { WorkflowState, WorkflowAction, type WorkflowTransitionRecord } from '../shared/workflowContract';

export class LibraryValidator {
  public static validateDocument(doc: any): LibraryDocument {
    this.validateDocumentStructure(doc);
    return doc as LibraryDocument;
  }

  public static validatePersistedDocument(doc: any, expectedId: string): LibraryDocument {
    this.validateDocumentStructure(doc);
    if (doc.id !== expectedId) {
      throw new Error(`VALIDATION_ERROR: ID mismatch: ${doc.id} !== ${expectedId}`);
    }
    return doc as LibraryDocument;
  }

  public static validateDocumentStructure(doc: any): void {
    if (!doc || typeof doc !== 'object') throw new Error('VALIDATION_ERROR: Document object is required');

    const requiredFields = [
      'id', 'titleAr', 'titleEn', 'documentType', 'organizationId', 'sourceId',
      'geographyAr', 'geographyEn', 'publicationDate', 'language',
      'summaryAr', 'summaryEn', 'rightsStatus', 'workflowState',
      'legalStatusDescriptionAr', 'legalStatusDescriptionEn',
      'createdAt', 'updatedAt'
    ];
    for (const field of requiredFields) {
      if (doc[field] === undefined || doc[field] === null || (typeof doc[field] === 'string' && doc[field].trim() === '')) {
        throw new Error(`VALIDATION_ERROR: Field ${field} is required`);
      }
    }
    // Date validation
    if (isNaN(Date.parse(doc.publicationDate)) || isNaN(Date.parse(doc.createdAt)) || isNaN(Date.parse(doc.updatedAt))) {
        throw new Error('VALIDATION_ERROR: Invalid date format');
    }

    if (!Object.values(LibraryDocumentType).includes(doc.documentType)) throw new Error(`VALIDATION_ERROR: Invalid documentType: ${doc.documentType}`);
    if (!Object.values(LibraryRightsStatus).includes(doc.rightsStatus)) throw new Error(`VALIDATION_ERROR: Invalid rightsStatus: ${doc.rightsStatus}`);
    if (!Object.values(WorkflowState).includes(doc.workflowState)) throw new Error(`VALIDATION_ERROR: Invalid workflowState: ${doc.workflowState}`);
    if (!['ar', 'en', 'bilingual', 'other'].includes(doc.language)) throw new Error(`VALIDATION_ERROR: Invalid language: ${doc.language}`);
    
    if (!Array.isArray(doc.topicsAr) || !doc.topicsAr.every((t: any) => typeof t === 'string')) throw new Error('VALIDATION_ERROR: topicsAr must be string array');
    if (!Array.isArray(doc.topicsEn) || !doc.topicsEn.every((t: any) => typeof t === 'string')) throw new Error('VALIDATION_ERROR: topicsEn must be string array');
    if (!Array.isArray(doc.environmentalDomains) || !doc.environmentalDomains.every((d: any) => typeof d === 'string')) throw new Error('VALIDATION_ERROR: environmentalDomains must be string array');
    
    if (!Array.isArray(doc.workflowHistory) || !Array.isArray(doc.versions)) throw new Error('VALIDATION_ERROR: workflowHistory and versions must be arrays');

    for (const record of doc.workflowHistory as WorkflowTransitionRecord[]) { this.validateWorkflowRecord(record); }
    for (const version of doc.versions as LibraryDocumentVersion[]) { this.validateVersion(version, doc.id); }

    const allowedFields = [...requiredFields, 'originalTitle', 'rightsNotesAr', 'rightsNotesEn', 'authorMetadataAr', 'authorMetadataEn', 'topicsAr', 'topicsEn', 'environmentalDomains', 'workflowHistory', 'versions'];
    for (const key in doc) { if (!allowedFields.includes(key)) throw new Error(`VALIDATION_ERROR: Unexpected field: ${key}`); }
  }

  private static validateWorkflowRecord(record: WorkflowTransitionRecord): void {
    if (!record.id || !record.fromState || !record.toState || !record.action || !record.actorName || !record.actorRole || !record.timestamp ||
        !Object.values(WorkflowState).includes(record.fromState) || !Object.values(WorkflowState).includes(record.toState) || !Object.values(WorkflowAction).includes(record.action) ||
        typeof record.actorName !== 'string' || typeof record.actorRole !== 'string' || record.actorRole === '' || isNaN(Date.parse(record.timestamp))) {
      throw new Error('VALIDATION_ERROR: Malformed workflow history record');
    }
    if (record.comment !== undefined && typeof record.comment !== 'string') throw new Error('VALIDATION_ERROR: Malformed workflow comment');
  }

  private static validateVersion(version: LibraryDocumentVersion, parentId: string): void {
    if (!version.id || version.documentId !== parentId || !version.versionNumber || !version.publishedDate || !version.changeDescriptionAr || !version.changeDescriptionEn || isNaN(Date.parse(version.publishedDate))) {
      throw new Error('VALIDATION_ERROR: Malformed version record');
    }
    if (version.referenceUrl !== undefined && typeof version.referenceUrl !== 'string') throw new Error('VALIDATION_ERROR: Malformed version referenceUrl');
  }
}
