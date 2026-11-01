import type { WorkflowState, WorkflowTransitionRecord } from './workflowContract';

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
  createdAt?: string;
  updatedAt?: string;
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
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Administrative Input DTOs for Registry Records
 */
export interface RegisterOrganizationInput {
  id?: string;
  nameAr: string;
  nameEn: string;
  type: 'Ministry' | 'InternationalBody' | 'ResearchCenter' | 'NGO' | 'Judicial';
  countryRegionAr: string;
  countryRegionEn: string;
  websiteUrl?: string;
}

export interface RegisterSourceInput {
  id?: string;
  organizationId: string;
  sourceNameAr: string;
  sourceNameEn: string;
  sourceUrl?: string;
  sourceType: 'OfficialGazette' | 'GovernmentPortal' | 'AcademicJournal' | 'InstitutionalArchive';
  verificationStatus?: 'Verified' | 'PendingVerification' | 'ThirdPartyIndex';
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
 * Sanitized Public Environmental Library Document DTO
 * Returned by PublicLibraryRepository and getPublicLibrary.
 * Strictly excludes internal workflowHistory, internal rightsNotesAr/rightsNotesEn,
 * and private authorMetadataAr/authorMetadataEn.
 */
export interface PublicLibraryDocument {
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
  summaryAr: string;
  summaryEn: string;
  topicsAr: string[];
  topicsEn: string[];
  environmentalDomains: string[];
  legalStatusDescriptionAr: string;
  legalStatusDescriptionEn: string;
  rightsStatus: LibraryRightsStatus;
  versions: LibraryDocumentVersion[];
  workflowState: WorkflowState;
  createdAt: string;
  updatedAt: string;
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

/**
 * Library Intake Inbox Status Model
 * Internal editorial tracking for incoming reference candidates.
 */
export const LibraryIntakeStatus = {
  PendingReview: 'PendingReview',     // قيد المراجعة الأولية
  InPreparation: 'InPreparation',     // قيد الإعداد والتوثيق
  Rejected: 'Rejected',               // مستبعد / غير مطابق
} as const;

export type LibraryIntakeStatus = typeof LibraryIntakeStatus[keyof typeof LibraryIntakeStatus];

/**
 * Input basis for AI Preparation Assistant on Library Intake records.
 * Strictly distinguishes metadata-only inference from analysis of an admin-supplied text excerpt.
 */
export const LibraryIntakeAIInputBasis = {
  MetadataOnly: 'MetadataOnly',
  SuppliedExcerptAndMetadata: 'SuppliedExcerptAndMetadata',
} as const;

export type LibraryIntakeAIInputBasis = typeof LibraryIntakeAIInputBasis[keyof typeof LibraryIntakeAIInputBasis];

/**
 * Advisory, non-canonical AI preparation suggestions attached to a LibraryIntakeRecord.
 * Must NEVER overwrite canonical organizationId, sourceId, status, or LibraryDocument fields.
 */
export interface LibraryIntakeAISuggestion {
  readonly isAdvisoryOnly: true;
  readonly verificationWarningAr: string;
  readonly verificationWarningEn: string;
  readonly modelId: string;
  readonly generatedAt: string;
  readonly generatedByAdminId: string;
  readonly generatedByAdminName: string;
  readonly inputBasis: LibraryIntakeAIInputBasis;
  readonly sourceIntakeUpdatedAt: string;
  readonly suggestedTitleAr: string;
  readonly suggestedTitleEn: string;
  readonly suggestedIssuingOrganization: string;
  readonly suggestedDocumentType: LibraryDocumentType;
  readonly suggestedEnvironmentalDomains: string[];
  readonly suggestedTopicsAr: string[];
  readonly suggestedTopicsEn: string[];
  readonly suggestedSummaryAr?: string | null;
  readonly suggestedSummaryEn?: string | null;
  readonly provenanceObservationsAr: string[];
  readonly provenanceObservationsEn: string[];
  readonly uncertaintyNoticesAr: string[];
  readonly uncertaintyNoticesEn: string[];
}

/**
 * Library Intake Record (Durable Candidate Reference)
 */
export interface LibraryIntakeRecord {
  id: string;
  url: string;
  normalizedUrl: string;
  title: string;
  organizationId?: string;
  sourceId?: string;
  language: 'ar' | 'en' | 'bilingual' | 'other';
  notes?: string;
  suppliedExcerpt?: string;
  aiSuggestion?: LibraryIntakeAISuggestion;
  status: LibraryIntakeStatus;
  submittedByAdminId: string;
  submittedByAdminName: string;
  reviewNotes?: string;
  reviewedByAdminId?: string;
  reviewedByAdminName?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Administrative Input DTOs for Intake
 */
export interface SubmitLibraryIntakeInput {
  url: string;
  title: string;
  organizationId?: string;
  sourceId?: string;
  language?: 'ar' | 'en' | 'bilingual' | 'other';
  notes?: string;
}

export interface UpdateLibraryIntakeStatusInput {
  intakeId: string;
  status: LibraryIntakeStatus;
  reviewNotes?: string;
}

export interface GenerateLibraryIntakeAISuggestionsInput {
  intakeId: string;
  suppliedExcerpt?: string;
}


