import type { LibraryDocument, LibraryDocumentVersion } from '../../../src/types/library';
import { LibraryDocumentType, LibraryRightsStatus } from '../../../src/types/library';
import { WorkflowState, type WorkflowTransitionRecord } from '../../../src/types/workflow';

export class LibraryValidator {
  public static validateDocument(doc: any): LibraryDocument {
    if (!doc || typeof doc !== 'object') {
      throw new Error('VALIDATION_ERROR: Document object is required');
    }

    // Required fields check
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

    // Enum validation
    if (!Object.values(LibraryDocumentType).includes(doc.documentType)) {
      throw new Error(`VALIDATION_ERROR: Invalid documentType: ${doc.documentType}`);
    }
    if (!Object.values(LibraryRightsStatus).includes(doc.rightsStatus)) {
      throw new Error(`VALIDATION_ERROR: Invalid rightsStatus: ${doc.rightsStatus}`);
    }
    if (!Object.values(WorkflowState).includes(doc.workflowState)) {
      throw new Error(`VALIDATION_ERROR: Invalid workflowState: ${doc.workflowState}`);
    }
    if (!['ar', 'en', 'bilingual', 'other'].includes(doc.language)) {
      throw new Error(`VALIDATION_ERROR: Invalid language: ${doc.language}`);
    }

    // Array validation
    if (!Array.isArray(doc.topicsAr) || !Array.isArray(doc.topicsEn) || !Array.isArray(doc.environmentalDomains)) {
      throw new Error('VALIDATION_ERROR: Topics and domains must be arrays');
    }
    if (!Array.isArray(doc.workflowHistory) || !Array.isArray(doc.versions)) {
      throw new Error('VALIDATION_ERROR: workflowHistory and versions must be arrays');
    }

    // Validate workflow history
    for (const record of doc.workflowHistory as WorkflowTransitionRecord[]) {
      this.validateWorkflowRecord(record);
    }

    // Validate versions
    for (const version of doc.versions as LibraryDocumentVersion[]) {
      this.validateVersion(version, doc.id);
    }

    // Unexpected fields check
    const allowedFields = [...requiredFields, 'originalTitle', 'rightsNotesAr', 'rightsNotesEn', 
      'authorMetadataAr', 'authorMetadataEn', 'topicsAr', 'topicsEn', 'environmentalDomains', 
      'workflowHistory', 'versions'];
    
    for (const key in doc) {
      if (!allowedFields.includes(key)) {
        throw new Error(`VALIDATION_ERROR: Unexpected field: ${key}`);
      }
    }

    return doc as LibraryDocument;
  }

  private static validateWorkflowRecord(record: WorkflowTransitionRecord): void {
    if (!record.id || !record.fromState || !record.toState || !record.action || !record.actorName || !record.actorRole || !record.timestamp) {
      throw new Error('VALIDATION_ERROR: Malformed workflow history record');
    }
    if (isNaN(Date.parse(record.timestamp))) {
      throw new Error('VALIDATION_ERROR: Malformed workflow timestamp');
    }
  }

  private static validateVersion(version: LibraryDocumentVersion, parentId: string): void {
    if (!version.id || version.documentId !== parentId || !version.versionNumber || !version.publishedDate || !version.changeDescriptionAr || !version.changeDescriptionEn) {
      throw new Error('VALIDATION_ERROR: Malformed version record');
    }
    if (isNaN(Date.parse(version.publishedDate))) {
      throw new Error('VALIDATION_ERROR: Malformed version publishedDate');
    }
  }
}
