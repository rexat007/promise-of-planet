import { WorkflowState, type WorkflowTransitionRecord } from './workflow';

/**
 * Environmental Library Document Types
 */
export const LibraryDocumentType = {
  Law: 'Law',                         // قانون بيئي
  ExecutiveRegulation: 'ExecutiveRegulation', // لائحة تنفيذية
  Decision: 'Decision',               // قرار وزاري/حكومي
  InstitutionalReport: 'InstitutionalReport', // تقرير مؤسسي
  PolicyPaper: 'PolicyPaper',         // ورقة سياسات
  ResearchStudy: 'ResearchStudy',     // دراسة بحثية/أكاديمية
  InternationalAgreement: 'InternationalAgreement', // اتفاقية دولية
} as const;

export type LibraryDocumentType = typeof LibraryDocumentType[keyof typeof LibraryDocumentType];

/**
 * Independent Rights Status Model
 * Editorial Workflow approval does NOT automatically confer Rights Clearance.
 */
export const LibraryRightsStatus = {
  Unknown: 'Unknown',                             // غير محدد / قيد التحقق
  ReviewRequired: 'ReviewRequired',               // يتطلب مراجعة حقوقية
  PermissionRequired: 'PermissionRequired',       // يتطلب إذن إعادة نشر
  PermissionGranted: 'PermissionGranted',         // تم الحصول على إذن
  OpenPubliclyAvailable: 'OpenPubliclyAvailable', // متاح للعامة للمعاينة
  Restricted: 'Restricted',                       // مقيد / للاستخدام الداخلي
  NotRedistributable: 'NotRedistributable',       // غير قابل للترويج/إعادة التوزيع
} as const;

export type LibraryRightsStatus = typeof LibraryRightsStatus[keyof typeof LibraryRightsStatus];

/**
 * Responsible Organization / Institution
 */
export interface LibraryOrganization {
  id: string;
  nameAr: string;
  nameEn: string;
  type: 'Ministry' | 'InternationalBody' | 'ResearchCenter' | 'NGO' | 'Judicial';
  countryRegionAr: string;
  countryRegionEn: string;
  websiteUrl?: string;
}

/**
 * Source & Origin Metadata
 */
export interface LibrarySource {
  id: string;
  organizationId: string;
  sourceNameAr: string;
  sourceNameEn: string;
  sourceUrl?: string;
  sourceType: 'OfficialGazette' | 'GovernmentPortal' | 'AcademicJournal' | 'InstitutionalArchive';
  verificationStatus: 'Verified' | 'PendingVerification' | 'ThirdPartyIndex';
}

/**
 * Version History Record
 */
export interface LibraryDocumentVersion {
  id: string;
  documentId: string;
  versionNumber: string;
  publishedDate: string;
  changeDescriptionAr: string;
  changeDescriptionEn: string;
  referenceUrl?: string;
}

/**
 * Foundational Environmental Library Document
 */
export interface LibraryDocument {
  id: string;
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
  
  // Summaries & Content Metadata
  summaryAr: string;
  summaryEn: string;
  topicsAr: string[];
  topicsEn: string[];
  environmentalDomains: string[]; // e.g., 'Climate', 'Biodiversity', 'WasteManagement', 'Water'
  
  // Rights & Workflow (strictly decoupled)
  rightsStatus: LibraryRightsStatus;
  rightsNotesAr?: string;
  rightsNotesEn?: string;
  workflowState: WorkflowState;
  workflowHistory: WorkflowTransitionRecord[];
  
  // Descriptive Legal Status (Non-automated descriptive metadata only)
  legalStatusDescriptionAr: string;
  legalStatusDescriptionEn: string;

  // Metadata
  authorMetadataAr?: string;
  authorMetadataEn?: string;
  createdAt: string;
  updatedAt: string;
  versions: LibraryDocumentVersion[];
}

/**
 * Multi-dimensional Classification Filter
 */
export interface LibraryClassification {
  documentType?: LibraryDocumentType;
  rightsStatus?: LibraryRightsStatus;
  workflowState?: WorkflowState;
  environmentalDomain?: string;
  geography?: string;
  searchQuery?: string;
}
